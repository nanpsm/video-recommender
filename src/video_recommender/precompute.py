"""Precompute top-K recommendations for all users and store them in Supabase.

Uses a hybrid scoring model: normalised ALS predicted rating + genre-match
score. This combines collaborative filtering (what similar users liked) with
content-based filtering (whether the film's genres match the user's taste).

Scoring:
  hybrid = ALS_WEIGHT * als_norm + GENRE_WEIGHT * genre_score

  als_norm:    ALS predicted rating normalised to [0,1] per user
  genre_score: average user_genre_vec[g] for each genre g in the film

Run:  uv run python -m video_recommender.precompute
"""
import os
from collections import defaultdict

import pandas as pd
from pyspark.ml.recommendation import ALSModel
from pyspark.sql import functions as F
from supabase import create_client

from video_recommender.explore import get_spark, load_data
from video_recommender.train_als import LIKED_THRESHOLD, MIN_MOVIE_RATINGS, SEED

# Supabase connection.
# SUPABASE_SERVICE_KEY must be set as an environment variable — never commit it.
# The anon key is safe to hardcode (public read-only access).
# The service key bypasses RLS and is used only for writes in this script.
SUPABASE_URL = "https://spmtgrmedfilavekoije.supabase.co"
SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNwbXRncm1lZGZpbGF2ZWtvaWplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3OTQxNjEsImV4cCI6MjA5NzM3MDE2MX0.Xof9SJonn7J7ok-Fqec4U0bHWGsprKsX2Mhn0PxIJAQ"
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")
if not SUPABASE_SERVICE_KEY:
    raise EnvironmentError(
        "SUPABASE_SERVICE_KEY not set. Run:\n"
        "  export SUPABASE_SERVICE_KEY='your-service-role-key'"
    )

MODEL_DIR = "models/als"
K = 10
BATCH_SIZE = 500

# Hybrid weights (must sum to 1.0 for scores to stay in [0,1])
ALS_WEIGHT   = 0.6
GENRE_WEIGHT = 0.4


def _build_genre_vecs(ratings_pd: pd.DataFrame, movie_genres: dict) -> dict:
    """Unit-normalised genre preference vector for each user from liked films."""
    liked = ratings_pd[ratings_pd.rating >= LIKED_THRESHOLD]
    vecs: dict[int, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for row in liked.itertuples():
        for g in movie_genres.get(row.movieId, []):
            vecs[row.userId][g] += row.rating
    for uid, vec in vecs.items():
        mag = sum(v * v for v in vec.values()) ** 0.5
        if mag > 0:
            for g in vec:
                vec[g] /= mag
    return vecs


def main():
    spark = get_spark("precompute")
    spark.sparkContext.setLogLevel("WARN")

    print(f"Loading ALS model from {MODEL_DIR}...")
    model = ALSModel.load(MODEL_DIR)

    ratings_raw, movies = load_data(spark)
    ratings = ratings_raw.drop("timestamp")
    train_spark, _ = ratings.randomSplit([0.8, 0.2], seed=SEED)

    # Same cold-movie filter used during training
    movie_counts = train_spark.groupBy("movieId").agg(F.count("*").alias("count"))
    warm = movie_counts.filter(F.col("count") >= MIN_MOVIE_RATINGS).select("movieId")
    train_spark = train_spark.join(warm, "movieId")

    # Score every (user, movie) pair — ALS handles the cartesian product in Spark
    print("Scoring all user-movie pairs with ALS...")
    users_df  = train_spark.select("userId").distinct()
    movies_df = train_spark.select("movieId").distinct()
    all_pairs = users_df.crossJoin(movies_df)
    als_preds = (model.transform(all_pairs)
                 .filter(F.col("prediction").isNotNull()))

    # Collect to pandas — ~5.9M rows; takes ~30s but keeps the hybrid logic clean
    print("Collecting ALS predictions to pandas (this takes ~30s)...")
    als_pd     = als_preds.toPandas()
    train_pd   = train_spark.toPandas()
    movies_pd  = movies.toPandas()
    print(f"ALS scored {len(als_pd):,} pairs across {als_pd.userId.nunique()} users")

    # Build lookup structures
    movie_genres = {
        r.movieId: r.genres.split("|")
        for r in movies_pd.itertuples()
        if r.genres != "(no genres listed)"
    }
    movie_meta = {r.movieId: (r.title, r.genres) for r in movies_pd.itertuples()}
    seen_by_user = train_pd.groupby("userId")["movieId"].apply(set).to_dict()

    # Genre preference vectors
    user_vecs = _build_genre_vecs(train_pd, movie_genres)

    # Per-user normalise ALS scores to [0, 1]
    stats  = als_pd.groupby("userId")["prediction"].agg(["min", "max"]).reset_index()
    als_pd = als_pd.merge(stats, on="userId")
    als_pd["als_norm"] = (
        (als_pd["prediction"] - als_pd["min"])
        / (als_pd["max"] - als_pd["min"] + 1e-9)
    )

    # Compute hybrid score and take top-K unseen films per user
    print("Computing hybrid scores and selecting top-K per user...")
    records = []
    for uid, group in als_pd.groupby("userId"):
        vec  = user_vecs.get(uid, {})
        seen = seen_by_user.get(uid, set())
        unseen = group[~group.movieId.isin(seen)].copy()

        def genre_score(movie_id: int) -> float:
            genres = movie_genres.get(movie_id, [])
            if not genres or not vec:
                return 0.0
            return sum(vec.get(g, 0) for g in genres) / len(genres)

        unseen = unseen.copy()
        unseen["genre_s"] = unseen["movieId"].map(genre_score)
        unseen["hybrid"]  = ALS_WEIGHT * unseen["als_norm"] + GENRE_WEIGHT * unseen["genre_s"]

        top_k = unseen.nlargest(K, "hybrid").reset_index(drop=True)
        for rank, row in enumerate(top_k.itertuples(), start=1):
            title, genres = movie_meta.get(row.movieId, ("Unknown", ""))
            records.append({
                "user_id":  uid,
                "rank":     rank,
                "movie_id": row.movieId,
                "title":    title,
                "genres":   genres,
            })

    print(f"Total recommendations: {len(records):,}")

    # Write to Supabase
    print("Inserting into Supabase...")
    supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    supabase.table("recommendations").delete().neq("user_id", -1).execute()

    for i in range(0, len(records), BATCH_SIZE):
        batch = records[i: i + BATCH_SIZE]
        supabase.table("recommendations").insert(batch).execute()
        print(f"  Inserted {min(i + BATCH_SIZE, len(records)):,} / {len(records):,}")

    print("Done. Hybrid recommendations stored in Supabase.")
    spark.stop()


if __name__ == "__main__":
    main()
