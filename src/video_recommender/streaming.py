"""Spark Structured Streaming consumer: reads rating events from Kafka,
retrains ALS on the updated data, and prints fresh recommendations.

Architecture:
  Kafka topic "rating-events"
       ↓  (Spark reads in micro-batches every TRIGGER_SECONDS)
  parse JSON → combine with base training data
       ↓
  retrain ALS → recommendForAllUsers
       ↓
  print top-K for users who sent new events this batch

Run from the project root:  uv run python -m video_recommender.streaming
Keep producer.py running in a separate terminal at the same time.
Press Ctrl+C to stop.
"""
from pyspark.ml.recommendation import ALS
from pyspark.sql import DataFrame, SparkSession, functions as F
from pyspark.sql.types import (FloatType, IntegerType, LongType, StringType,
                                StructField, StructType)

from video_recommender.explore import get_spark, load_data
from video_recommender.train_als import MIN_MOVIE_RATINGS, SEED, build_als

TOPIC = "rating-events"
KAFKA_BROKER = "localhost:9092"
K = 10
TRIGGER_SECONDS = 60  # process a new micro-batch every 60 seconds

# JSON schema of the events the producer sends.
# Spark needs this to parse the raw bytes it receives from Kafka.
EVENT_SCHEMA = StructType([
    StructField("userId",    IntegerType(), True),
    StructField("movieId",   IntegerType(), True),
    StructField("rating",    FloatType(),   True),
    StructField("timestamp", LongType(),    True),
])


def get_streaming_spark() -> SparkSession:
    """SparkSession with the Kafka connector package.

    spark-sql-kafka is a Spark extension that lets Spark read/write Kafka.
    We pass it as a Maven coordinate — Spark downloads it automatically the
    first time. Maven is Java's package registry (like PyPI for Python).
    """
    return (
        SparkSession.builder.appName("streaming")
        .master("local[2]")  # 2 cores: one for streaming, one for processing
        .config("spark.driver.memory", "2g")
        .config("spark.sql.shuffle.partitions", "8")
        # The connector version must match PySpark exactly (4.2.0).
        # Scala 2.13 suffix (_2.13) is required for PySpark 4.x.
        .config("spark.jars.packages",
                "org.apache.spark:spark-sql-kafka-0-10_2.13:4.2.0")
        .getOrCreate()
    )


def process_batch(new_events: DataFrame, base_train: DataFrame,
                  warm_movies: DataFrame, batch_id: int) -> None:
    """Called by Spark for every micro-batch of new Kafka events.

    Arguments:
        new_events  — the events that arrived in this 60-second window
        base_train  — the original MovieLens training ratings
        warm_movies — movies with >= MIN_MOVIE_RATINGS ratings (pre-computed)
        batch_id    — Spark's internal batch counter (useful for logging)
    """
    n = new_events.count()
    if n == 0:
        print(f"[batch {batch_id}] No new events — waiting...")
        return

    print(f"\n[batch {batch_id}] {n} new events received")

    # Which users sent events this batch? We'll show their updated recs.
    active_users = new_events.select("userId").distinct()
    active_users.show(truncate=False)

    # Combine new events with the original training data.
    # This means ALS sees both historical and new ratings.
    # We keep only the columns ALS needs (drop timestamp).
    combined = (base_train.select("userId", "movieId", "rating")
                .union(new_events.select("userId", "movieId", "rating"))
                .join(warm_movies, "movieId"))  # still filter cold movies

    # Retrain ALS on the combined data.
    # We use fixed hyperparameters (best from tuning) rather than re-tuning
    # every 60 seconds — tuning takes too long for a streaming context.
    print(f"[batch {batch_id}] Retraining ALS on {combined.count():,} ratings...")
    model = build_als(rank=20, reg_param=0.1).fit(combined)

    # Get top-K recommendations for active users only (not all 610).
    # recommendForUserSubset is more efficient than recommendForAllUsers
    # when you only need a few users.
    recs = (model.recommendForUserSubset(active_users, K)
            .select("userId", F.explode("recommendations").alias("rec"))
            .select("userId", F.col("rec.movieId").alias("movieId")))

    # Remove movies those users already rated (in combined = train + new events)
    seen = combined.select("userId", "movieId")
    fresh_recs = recs.join(seen, ["userId", "movieId"], "left_anti")

    print(f"[batch {batch_id}] Updated recommendations:")
    fresh_recs.show(K * active_users.count(), truncate=False)


def main():
    spark = get_streaming_spark()
    spark.sparkContext.setLogLevel("WARN")

    # Load base training data once (not re-read every batch)
    base_ratings, _ = load_data(spark)
    base_ratings = base_ratings.drop("timestamp")
    base_train, _ = base_ratings.randomSplit([0.8, 0.2], seed=SEED)

    # Pre-compute warm movies so we don't recalculate every batch
    movie_counts = base_train.groupBy("movieId").agg(F.count("*").alias("count"))
    warm_movies = movie_counts.filter(
        F.col("count") >= MIN_MOVIE_RATINGS).select("movieId")

    base_train.cache()
    warm_movies.cache()

    print(f"Base training data loaded: {base_train.count():,} ratings")
    print(f"Connecting to Kafka at {KAFKA_BROKER}, topic '{TOPIC}'...")

    # Read from Kafka as a streaming DataFrame.
    # "earliest" means start from the beginning of the topic — so we don't
    # miss events that arrived before this script started.
    raw_stream = (spark.readStream
        .format("kafka")
        .option("kafka.bootstrap.servers", KAFKA_BROKER)
        .option("subscribe", TOPIC)
        .option("startingOffsets", "earliest")
        .load())

    # Kafka delivers each message as raw bytes in a "value" column.
    # We cast to string then parse the JSON using our EVENT_SCHEMA.
    events = (raw_stream
        .select(F.from_json(
            F.col("value").cast(StringType()), EVENT_SCHEMA
        ).alias("data"))
        .select("data.*")  # flatten: data.userId → userId, etc.
        .filter(F.col("userId").isNotNull()))  # drop malformed messages

    # foreachBatch: call process_batch() for every micro-batch.
    # We pass base_train and warm_movies in via a closure (lambda capture).
    query = (events.writeStream
        .foreachBatch(
            lambda df, batch_id: process_batch(
                df, base_train, warm_movies, batch_id))
        .trigger(processingTime=f"{TRIGGER_SECONDS} seconds")
        .option("checkpointLocation", "models/streaming_checkpoint")
        .start())

    print(f"Streaming started. Processing every {TRIGGER_SECONDS}s.")
    print("Keep producer.py running in another terminal.")
    print("Press Ctrl+C to stop.\n")

    try:
        query.awaitTermination()
    except KeyboardInterrupt:
        print("\nStopping stream...")
        query.stop()
        spark.stop()


if __name__ == "__main__":
    main()
