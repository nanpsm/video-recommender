"""Load MovieLens ml-latest into Spark and explore it.

Run from the project root:  uv run python -m video_recommender.explore
"""
from pyspark.sql import SparkSession, functions as F

DATA_DIR = "data/ml-latest"


def get_spark(app_name: str) -> SparkSession:
    """Create a local SparkSession with modest memory settings for a laptop."""
    spark = (
        SparkSession.builder.appName(app_name)
        # local[*] = run Spark on this machine using all CPU cores
        .master("local[*]")
        .config("spark.driver.memory", "3g")
        .config("spark.driver.memoryOverhead", "512m")
        # The default of 200 shuffle partitions is overkill for 100K rows
        .config("spark.sql.shuffle.partitions", "8")
        # /tmp is a tiny tmpfs; use the real disk for shuffle spill
        .config("spark.local.dir", "/home/nanph/projects/video-recommender/.spark-tmp")
        # Spill to disk aggressively rather than OOM
        .config("spark.memory.fraction", "0.6")
        .config("spark.memory.storageFraction", "0.3")
        .getOrCreate()
    )
    spark.sparkContext.setLogLevel("WARN")
    return spark


def load_data(spark: SparkSession):
    """Load ratings and movies with explicit schemas.

    An explicit schema is faster than inferSchema (no extra pass over the file)
    and guarantees the types ALS needs later (int IDs, float ratings).
    """
    ratings = spark.read.csv(
        f"{DATA_DIR}/ratings.csv", header=True,
        schema="userId INT, movieId INT, rating FLOAT, timestamp LONG",
    )
    movies = spark.read.csv(
        f"{DATA_DIR}/movies.csv", header=True,
        schema="movieId INT, title STRING, genres STRING",
    )
    return ratings, movies


def main():
    spark = get_spark("explore")
    ratings, movies = load_data(spark)
    ratings.cache()  # reused several times below, so keep it in memory

    n_ratings = ratings.count()
    n_users = ratings.select("userId").distinct().count()
    n_movies = ratings.select("movieId").distinct().count()
    # Sparsity = share of user-movie pairs with no rating: the gap CF must fill
    sparsity = 1 - n_ratings / (n_users * n_movies)
    print(f"Ratings: {n_ratings:,}  Users: {n_users:,}  Movies: {n_movies:,}")
    print(f"Matrix sparsity: {sparsity:.2%}")

    print("\nRating distribution:")
    ratings.groupBy("rating").count().orderBy("rating").show()

    print("Ratings per user (min / avg / max):")
    ratings.groupBy("userId").count().agg(
        F.min("count"), F.round(F.avg("count"), 1), F.max("count")).show()

    print("Ratings per movie (long tail):")
    per_movie = ratings.groupBy("movieId").count()
    per_movie.agg(F.min("count"), F.round(F.avg("count"), 1), F.max("count")).show()
    print(f"Movies with only 1 rating: {per_movie.filter('count = 1').count():,}")

    print("\nMost-rated movies (basis of the popularity baseline):")
    (ratings.groupBy("movieId")
        .agg(F.count("*").alias("n"), F.avg("rating").alias("avg_rating"))
        .join(movies, "movieId")
        .orderBy(F.desc("n"))
        .select("title", "n", F.round("avg_rating", 2).alias("avg_rating"))
        .show(10, truncate=False))

    spark.stop()


if __name__ == "__main__":
    main()
