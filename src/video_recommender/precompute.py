"""Precompute top-K recommendations for all users and store them in Supabase.

This runs once (or whenever you retrain the model). The API and frontend
then read from Supabase instead of running ALS on every request — much faster.

Run from the project root:  uv run python -m video_recommender.precompute
"""
from pyspark.ml.recommendation import ALSModel
from pyspark.sql import functions as F
from pyspark.sql.window import Window
from supabase import create_client

from video_recommender.explore import get_spark, load_data
from video_recommender.train_als import MIN_MOVIE_RATINGS, SEED

# Supabase connection.
# SUPABASE_SERVICE_KEY must be set as an environment variable — never commit it.
# The anon key below is safe to hardcode (public read-only access).
# The service key bypasses RLS and is used only for writes in this script.
import os
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
# Batch size for Supabase inserts — inserting 6100 rows one at a time is slow;
# batching sends them in chunks of 500 rows per request.
BATCH_SIZE = 500


def main():
    spark = get_spark("precompute")
    spark.sparkContext.setLogLevel("WARN")

    # Load the saved ALS model — no retraining needed
    print(f"Loading ALS model from {MODEL_DIR}...")
    model = ALSModel.load(MODEL_DIR)

    # Load movies for title/genre lookup
    _, movies = load_data(spark)

    # Load ratings to know which movies each user has already seen
    # (we exclude those from recommendations)
    ratings, _ = load_data(spark)
    ratings = ratings.drop("timestamp")
    train, _ = ratings.randomSplit([0.8, 0.2], seed=SEED)

    # Filter cold movies (same threshold used during training)
    movie_counts = train.groupBy("movieId").agg(F.count("*").alias("count"))
    warm_movies = movie_counts.filter(
        F.col("count") >= MIN_MOVIE_RATINGS).select("movieId")
    train = train.join(warm_movies, "movieId")

    # Generate top K*3 recommendations for all users, then filter seen movies
    print("Generating recommendations for all users...")
    raw = model.recommendForAllUsers(K * 3)
    recs = (raw
        .select("userId", F.posexplode("recommendations").alias("pos", "rec"))
        .select("userId",
                F.col("rec.movieId").alias("movieId"),
                F.col("pos").alias("als_rank")))

    # Remove movies already rated in training
    seen = train.select("userId", "movieId")
    unseen = recs.join(seen, ["userId", "movieId"], "left_anti")

    # Re-rank and take top K per user
    w = Window.partitionBy("userId").orderBy("als_rank")
    top_k = (unseen
        .withColumn("rank", F.row_number().over(w))
        .filter(F.col("rank") <= K)
        .select("userId", "rank", "movieId"))

    # Join with movie titles and genres
    final = (top_k
        .join(movies, "movieId")
        .select("userId", "rank", "movieId", "title", "genres")
        .orderBy("userId", "rank"))

    # Collect to Python — 610 users * 10 recs = 6,100 rows, small enough
    print("Collecting results...")
    rows = final.collect()
    print(f"Total recommendations: {len(rows):,}")

    # Insert into Supabase using the service role key (bypasses RLS for writes).
    # The frontend uses the anon key for reads — that's separate.
    print("Inserting into Supabase...")
    supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    # Clear existing recommendations before inserting fresh ones
    supabase.table("recommendations").delete().neq("user_id", -1).execute()

    records = [
        {
            "user_id":  row.userId,
            "rank":     row.rank,
            "movie_id": row.movieId,
            "title":    row.title,
            "genres":   row.genres,
        }
        for row in rows
    ]

    # Insert in batches of BATCH_SIZE
    for i in range(0, len(records), BATCH_SIZE):
        batch = records[i: i + BATCH_SIZE]
        supabase.table("recommendations").insert(batch).execute()
        print(f"  Inserted {min(i + BATCH_SIZE, len(records)):,} / {len(records):,}")

    print("Done! Recommendations stored in Supabase.")
    spark.stop()


if __name__ == "__main__":
    main()
