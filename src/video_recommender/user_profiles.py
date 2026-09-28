"""Compute per-user genre preference scores and store them in Supabase.

For each user, we look at movies they rated >= 4.0 (liked), extract the genres
of those movies, and build a normalised score vector. This lets the frontend find
the closest real user by cosine similarity when a visitor rates a few movies.

Run:  uv run python -m video_recommender.user_profiles
"""
import os
from collections import defaultdict

from pyspark.sql import functions as F
from supabase import create_client

from video_recommender.explore import get_spark, load_data
from video_recommender.train_als import MIN_MOVIE_RATINGS, SEED

SUPABASE_URL = "https://spmtgrmedfilavekoije.supabase.co"
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")
if not SUPABASE_SERVICE_KEY:
    raise EnvironmentError(
        "SUPABASE_SERVICE_KEY not set. Run:\n"
        "  export SUPABASE_SERVICE_KEY='your-service-role-key'"
    )

LIKED_THRESHOLD = 3.5   # ratings >= this count toward genre affinity
BATCH_SIZE = 500


def main():
    spark = get_spark("user_profiles")

    ratings, movies = load_data(spark)
    ratings = ratings.drop("timestamp")

    # Use the same 80/20 split as training so genre vectors match the
    # collaborative-filtering model's view of each user's history
    train, _ = ratings.randomSplit([0.8, 0.2], seed=SEED)

    # Apply the same cold-movie filter used during training
    movie_counts = train.groupBy("movieId").agg(F.count("*").alias("count"))
    warm = movie_counts.filter(F.col("count") >= MIN_MOVIE_RATINGS).select("movieId")
    train = train.join(warm, "movieId")

    # Keep only liked ratings, join with movie genres
    liked = (
        train
        .filter(F.col("rating") >= LIKED_THRESHOLD)
        .join(movies.select("movieId", "genres"), "movieId")
    )

    # Collect to Python — ~30K rows is fine
    rows = liked.select("userId", "genres", "rating").collect()
    spark.stop()

    # Build per-user genre score: sum of ratings across movies containing each genre
    user_genre: dict[int, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for row in rows:
        for genre in row.genres.split("|"):
            if genre == "(no genres listed)":
                continue
            user_genre[row.userId][genre] += float(row.rating)

    # Normalise each user's vector to unit length (for cosine similarity)
    records = []
    for user_id, genre_scores in user_genre.items():
        total = sum(v * v for v in genre_scores.values()) ** 0.5
        if total == 0:
            continue
        for genre, score in genre_scores.items():
            records.append({
                "user_id": user_id,
                "genre":   genre,
                "score":   round(score / total, 6),
            })

    print(f"Total user-genre rows: {len(records):,}")

    sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    # Clear existing data
    sb.table("user_genre_profiles").delete().neq("user_id", -1).execute()

    for i in range(0, len(records), BATCH_SIZE):
        batch = records[i: i + BATCH_SIZE]
        sb.table("user_genre_profiles").insert(batch).execute()
        print(f"  Inserted {min(i + BATCH_SIZE, len(records)):,} / {len(records):,}")

    print("Done.")


if __name__ == "__main__":
    main()
