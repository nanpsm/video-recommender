"""Offline evaluation of FilmTwin recommendation baselines.

Splits each user's ratings 80/20, generates Top-10 recommendations from each
baseline using only the training 80%, then measures quality against the hidden
20% test set.

Metrics (all at K=10):
  Precision@K  — fraction of recommended films the user actually liked
  Recall@K     — fraction of liked test films that appeared in the top-10
  NDCG@K       — ranking quality (hits ranked higher count more)
  Hit Rate@K   — did at least one recommended film land in the user's liked set?

Baselines:
  Random            — random unseen films
  Popularity        — globally most-rated unseen films
  Genre similarity  — FilmTwin current: nearest user by genre vector → their liked films
  ALS               — collaborative filtering only (current pre-computed recs)
  Hybrid            — ALS score + genre-match score (item #2 improvement)

Run:
  uv run python -m video_recommender.evaluate
"""
import math
from collections import defaultdict

import pandas as pd
from pyspark.ml.recommendation import ALSModel
from pyspark.sql import functions as F

from video_recommender.explore import get_spark, load_data
from video_recommender.train_als import K, LIKED_THRESHOLD, MIN_MOVIE_RATINGS, SEED

# Hybrid weights — tune these using the evaluation results
ALS_WEIGHT   = 0.6
GENRE_WEIGHT = 0.4


# ── Metrics ───────────────────────────────────────────────────────────────────

def ranking_metrics(recs_pd: pd.DataFrame, test_pd: pd.DataFrame,
                    k: int = K, liked_threshold: float = LIKED_THRESHOLD) -> dict:
    """Return Precision@K, Recall@K, NDCG@K, Hit Rate@K averaged across users.

    Only users with at least one liked test film are included — users with
    zero liked test films can never produce a hit regardless of the model.
    """
    liked = (test_pd[test_pd.rating >= liked_threshold]
             .groupby("userId")["movieId"].apply(set).to_dict())
    recs_by_user = (recs_pd.groupby("userId")["movieId"].apply(list).to_dict())

    precision_list, recall_list, ndcg_list, hit_list = [], [], [], []

    for uid, liked_set in liked.items():
        rec_list = recs_by_user.get(uid, [])[:k]
        if not rec_list:
            continue

        hits = [1 if m in liked_set else 0 for m in rec_list]
        n_hits = sum(hits)

        precision_list.append(n_hits / k)
        recall_list.append(n_hits / len(liked_set))

        dcg   = sum(h / math.log2(i + 2) for i, h in enumerate(hits))
        ideal = sum(1 / math.log2(i + 2) for i in range(min(len(liked_set), k)))
        ndcg_list.append(dcg / ideal if ideal > 0 else 0.0)

        hit_list.append(1.0 if n_hits > 0 else 0.0)

    n = len(precision_list)
    if n == 0:
        return {"Precision@K": 0, "Recall@K": 0, "NDCG@K": 0, "Hit Rate@K": 0, "N": 0}

    return {
        "Precision@K": sum(precision_list) / n,
        "Recall@K":    sum(recall_list)    / n,
        "NDCG@K":      sum(ndcg_list)      / n,
        "Hit Rate@K":  sum(hit_list)       / n,
        "N":           n,
    }


# ── Baselines ─────────────────────────────────────────────────────────────────

def random_recs(train_pd: pd.DataFrame, all_movie_ids: list,
                k: int = K, seed: int = SEED) -> pd.DataFrame:
    """Randomly select K unseen films per user."""
    import random
    rng = random.Random(seed)
    seen_by_user = train_pd.groupby("userId")["movieId"].apply(set).to_dict()
    rows = []
    for uid, seen in seen_by_user.items():
        pool = [m for m in all_movie_ids if m not in seen]
        picks = rng.sample(pool, min(k, len(pool)))
        rows.extend({"userId": uid, "movieId": m} for m in picks)
    return pd.DataFrame(rows)


def popularity_recs(train_pd: pd.DataFrame, k: int = K) -> pd.DataFrame:
    """Top-K globally most-rated unseen films per user."""
    seen_by_user = train_pd.groupby("userId")["movieId"].apply(set).to_dict()
    pop_order = (train_pd.groupby("movieId").size()
                 .sort_values(ascending=False).index.tolist())
    rows = []
    for uid, seen in seen_by_user.items():
        picks = [m for m in pop_order if m not in seen][:k]
        rows.extend({"userId": uid, "movieId": m} for m in picks)
    return pd.DataFrame(rows)


def _build_genre_vecs(train_pd: pd.DataFrame, movie_genres: dict,
                      liked_threshold: float = LIKED_THRESHOLD) -> dict:
    """Build unit-normalised genre preference vectors for each user."""
    liked = train_pd[train_pd.rating >= liked_threshold]
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


def genre_sim_recs(train_pd: pd.DataFrame, movie_genres: dict,
                   als_preds_pd: pd.DataFrame, k: int = K) -> pd.DataFrame:
    """FilmTwin current approach: nearest user by genre vector → their ALS top-K.

    This is the approach FilmTwin uses in production. We evaluate it as a
    baseline to see how much the hybrid improves things.
    """
    vecs = _build_genre_vecs(train_pd, movie_genres)
    seen_by_user = train_pd.groupby("userId")["movieId"].apply(set).to_dict()
    all_users = sorted(vecs.keys())

    # Find nearest other user for each user
    def cosine(a: dict, b: dict) -> float:
        return sum(a.get(g, 0) * v for g, v in b.items())

    rows = []
    for uid in all_users:
        vec = vecs[uid]
        if not vec:
            continue
        best_sim, best_uid = -1.0, None
        for other in all_users:
            if other == uid:
                continue
            sim = cosine(vec, vecs[other])
            if sim > best_sim:
                best_sim, best_uid = sim, other
        if best_uid is None:
            continue
        # Return the twin's ALS top-K, filtered to movies unseen by this user
        seen = seen_by_user.get(uid, set())
        twin_recs = (als_preds_pd[als_preds_pd.userId == best_uid]
                     .sort_values("prediction", ascending=False))
        picks = [r.movieId for r in twin_recs.itertuples() if r.movieId not in seen][:k]
        rows.extend({"userId": uid, "movieId": m} for m in picks)

    return pd.DataFrame(rows)


def als_recs(als_preds_pd: pd.DataFrame, train_pd: pd.DataFrame,
             k: int = K) -> pd.DataFrame:
    """Standard ALS: top-K predicted-rating films, excluding seen ones."""
    seen_by_user = train_pd.groupby("userId")["movieId"].apply(set).to_dict()
    rows = []
    for uid, group in als_preds_pd.groupby("userId"):
        seen = seen_by_user.get(uid, set())
        picks = (group[~group.movieId.isin(seen)]
                 .nlargest(k, "prediction").movieId.tolist())
        rows.extend({"userId": uid, "movieId": m} for m in picks)
    return pd.DataFrame(rows)


def hybrid_recs(als_preds_pd: pd.DataFrame, train_pd: pd.DataFrame,
                movie_genres: dict, k: int = K,
                als_w: float = ALS_WEIGHT, genre_w: float = GENRE_WEIGHT) -> pd.DataFrame:
    """Hybrid: normalised ALS score + genre-match score.

    Genre-match score for a (user, movie) pair:
      average of user_genre_vec[g] for each genre g in the movie.
    This rewards films whose genres align with the user's taste profile.

    ALS scores are normalised per-user to [0, 1] before combining, so the
    weights are comparable across users whose raw ALS scales differ.
    """
    vecs = _build_genre_vecs(train_pd, movie_genres)
    seen_by_user = train_pd.groupby("userId")["movieId"].apply(set).to_dict()

    # Per-user min/max normalisation of ALS predictions
    als_pd = als_preds_pd.copy()
    stats = als_pd.groupby("userId")["prediction"].agg(["min", "max"]).reset_index()
    als_pd = als_pd.merge(stats, on="userId")
    als_pd["als_norm"] = (
        (als_pd["prediction"] - als_pd["min"])
        / (als_pd["max"] - als_pd["min"] + 1e-9)
    )

    rows = []
    for uid, group in als_pd.groupby("userId"):
        vec = vecs.get(uid, {})
        seen = seen_by_user.get(uid, set())
        unseen = group[~group.movieId.isin(seen)].copy()

        def genre_score(movie_id: int) -> float:
            genres = movie_genres.get(movie_id, [])
            if not genres or not vec:
                return 0.0
            return sum(vec.get(g, 0) for g in genres) / len(genres)

        unseen = unseen.copy()
        unseen["genre_s"] = unseen["movieId"].map(genre_score)
        unseen["hybrid"]  = als_w * unseen["als_norm"] + genre_w * unseen["genre_s"]

        picks = unseen.nlargest(k, "hybrid")["movieId"].tolist()
        rows.extend({"userId": uid, "movieId": m} for m in picks)

    return pd.DataFrame(rows)


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    spark = get_spark("evaluate")
    ratings, movies = load_data(spark)
    ratings = ratings.drop("timestamp")

    train_spark, test_spark = ratings.randomSplit([0.8, 0.2], seed=SEED)

    # Apply the same cold-movie filter used during training
    movie_counts = train_spark.groupBy("movieId").agg(F.count("*").alias("count"))
    warm = movie_counts.filter(F.col("count") >= MIN_MOVIE_RATINGS).select("movieId")
    train_spark = train_spark.join(warm, "movieId")
    test_spark  = test_spark.join(warm,  "movieId")

    train_pd    = train_spark.toPandas()
    test_pd     = test_spark.toPandas()
    movies_pd   = movies.toPandas()

    movie_genres = {
        r.movieId: r.genres.split("|")
        for r in movies_pd.itertuples()
        if r.genres != "(no genres listed)"
    }
    all_movie_ids = movies_pd["movieId"].tolist()

    print(f"Train: {len(train_pd):,} ratings  Test: {len(test_pd):,} ratings")
    print(f"Evaluating Top-{K} recommendations...\n")

    # ALS predictions for all (user, movie) pairs — used by ALS, genre-sim, hybrid
    print("Loading ALS model and scoring all user-movie pairs...")
    model = ALSModel.load("models/als")
    users_spark  = train_spark.select("userId").distinct()
    movies_spark = train_spark.select("movieId").distinct()
    all_pairs    = users_spark.crossJoin(movies_spark)
    als_preds_pd = (model.transform(all_pairs)
                    .filter(F.col("prediction").isNotNull())
                    .toPandas())
    print(f"ALS scored {len(als_preds_pd):,} user-movie pairs\n")

    baselines = {
        "Random":           lambda: random_recs(train_pd, all_movie_ids),
        "Popularity":       lambda: popularity_recs(train_pd),
        "Genre similarity": lambda: genre_sim_recs(train_pd, movie_genres, als_preds_pd),
        "ALS":              lambda: als_recs(als_preds_pd, train_pd),
        "Hybrid":           lambda: hybrid_recs(als_preds_pd, train_pd, movie_genres),
    }

    results = {}
    for name, fn in baselines.items():
        print(f"  Computing {name}...")
        results[name] = ranking_metrics(fn(), test_pd)

    # Print comparison table
    col_w = 14
    header_cols = ["Precision@K", "Recall@K", "NDCG@K", "Hit Rate@K", "N"]
    print(f"\n{'Baseline':25}", end="")
    for col in header_cols:
        print(f"{col:>{col_w}}", end="")
    print()
    print("-" * (25 + col_w * len(header_cols)))
    for name, scores in results.items():
        print(f"{name:25}", end="")
        for col in header_cols:
            v = scores[col]
            print(f"{v:>{col_w}.4f}" if isinstance(v, float) else f"{v:>{col_w}}", end="")
        print()

    print(f"\nLIKED_THRESHOLD={LIKED_THRESHOLD}  K={K}")
    spark.stop()


if __name__ == "__main__":
    main()
