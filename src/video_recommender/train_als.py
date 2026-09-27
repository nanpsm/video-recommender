"""Train an offline ALS recommender on MovieLens and compare it to a popularity baseline.

Run from the project root:  uv run python -m video_recommender.train_als

Pipeline:
  1. Split ratings into train (80%) and test (20%).
  2. Tune ALS hyperparameters on a validation split carved out of train.
  3. Retrain the best ALS model on the full train set.
  4. Evaluate ALS and a popularity baseline on the test set:
       - RMSE: how accurately we predict the rating value.
       - Precision@K: how many of our top-K recommendations the user actually liked.
"""
from pyspark.ml.evaluation import RegressionEvaluator
from pyspark.ml.recommendation import ALS
from pyspark.sql import DataFrame, functions as F
from pyspark.sql.window import Window

from video_recommender.explore import get_spark, load_data

SEED = 42            # fixed seed so every run gives the same split and model
K = 10               # evaluate the top-10 recommendations per user
LIKED_THRESHOLD = 4.0  # a test rating >= 4.0 counts as "the user liked it"
MIN_MOVIE_RATINGS = 5  # filter out movies with fewer ratings; one or two
                       # ratings can produce extreme ALS factors that dominate
                       # recommendations even with regularisation
SAVE_MODEL = True    # save the trained model to disk after training
MODEL_DIR = "models/als"          # Spark saves a folder, not a single file
POPULARITY_DIR = "models/popularity"  # also save popularity stats for the API

# Small grid to keep runtime and memory modest on a laptop.
# rank     = number of latent "taste" factors per user and movie
# regParam = L2 penalty on factor sizes; higher = less overfitting
PARAM_GRID = [(rank, reg) for rank in (10, 20) for reg in (0.05, 0.1, 0.2)]


def build_als(rank: int, reg_param: float) -> ALS:
    return ALS(
        userCol="userId", itemCol="movieId", ratingCol="rating",
        rank=rank, regParam=reg_param, maxIter=10, seed=SEED,
        # Explicit feedback: we have real star ratings, not just clicks/views
        implicitPrefs=False,
        nonnegative=True,
        # Users/movies unseen in training get NaN predictions; drop them so
        # RMSE isn't NaN. (A real system would fall back to popularity.)
        coldStartStrategy="drop",
    )


def rmse(predictions: DataFrame) -> float:
    evaluator = RegressionEvaluator(
        metricName="rmse", labelCol="rating", predictionCol="prediction")
    return evaluator.evaluate(predictions)


def tune_als(train: DataFrame) -> tuple[int, float]:
    """Pick the (rank, regParam) with the lowest RMSE on a validation split.

    We tune on a slice of train, never on test, so the final test score is an
    honest estimate of performance on unseen data.
    """
    fit_part, val_part = train.randomSplit([0.8, 0.2], seed=SEED)
    fit_part.cache()
    best = None
    print("Tuning ALS (validation RMSE):")
    for rank, reg in PARAM_GRID:
        model = build_als(rank, reg).fit(fit_part)
        score = rmse(model.transform(val_part))
        print(f"  rank={rank:<3} regParam={reg:<5} RMSE={score:.4f}")
        if best is None or score < best[0]:
            best = (score, rank, reg)
    fit_part.unpersist()
    _, rank, reg = best
    print(f"Best: rank={rank}, regParam={reg}\n")
    return rank, reg


def als_recommendations(model, train: DataFrame) -> DataFrame:
    """Top-K recommendations per user, excluding movies already rated in train.

    model.recommendForAllUsers(K) uses Spark's optimised blocked matrix
    multiply to rank all movies for all users efficiently.

    We ask for K*5 then filter out training movies and re-rank by the
    original position (posexplode preserves ALS's predicted-rating order).
    """
    # Returns: userId, recommendations ARRAY<STRUCT<movieId INT, rating FLOAT>>
    raw = model.recommendForAllUsers(K * 5)
    # posexplode gives (pos, element) — pos is the 0-based rank from ALS
    recs = (raw
        .select("userId",
                F.posexplode("recommendations").alias("pos", "rec"))
        .select("userId",
                F.col("rec.movieId").alias("movieId"),
                F.col("pos").alias("als_rank")))
    # Remove movies the user already saw in training
    seen = train.select("userId", "movieId")
    unseen = recs.join(seen, ["userId", "movieId"], "left_anti")
    # Re-rank within each user by the original ALS order and take top K
    w = Window.partitionBy("userId").orderBy("als_rank")
    return (unseen
        .withColumn("r", F.row_number().over(w))
        .filter(F.col("r") <= K)
        .select("userId", "movieId"))


def popularity_top_k(train: DataFrame) -> DataFrame:
    """Top-K most-rated movies per user, excluding movies they've seen.

    The popularity baseline recommends the globally most-rated unseen movies
    to everyone. It ignores personal tastes entirely — a deliberately weak
    baseline to show ALS is learning something useful.
    """
    movie_stats = train.groupBy("movieId").agg(
        F.count("*").alias("popularity"),
        F.avg("rating").alias("avg_rating"))
    users = train.select("userId").distinct()
    all_pairs = users.crossJoin(movie_stats)
    unseen = all_pairs.join(
        train.select("userId", "movieId"), ["userId", "movieId"], "left_anti")
    w = Window.partitionBy("userId").orderBy(F.desc("popularity"), "movieId")
    return (unseen
        .withColumn("r", F.row_number().over(w))
        .filter(F.col("r") <= K)
        .select("userId", "movieId"))


def precision_at_k(recs: DataFrame, test: DataFrame) -> float:
    """Average over users of (# recommended movies the user liked in test) / K.

    Only users with at least one liked test movie are counted, otherwise
    they would score 0 no matter how good the model is.
    """
    liked = test.filter(F.col("rating") >= LIKED_THRESHOLD).select("userId", "movieId")
    eval_users = liked.select("userId").distinct()
    hits = (recs.join(liked, ["userId", "movieId"])
            .groupBy("userId").agg(F.count("*").alias("hits")))
    per_user = (eval_users.join(hits, "userId", "left")
                .fillna(0, subset=["hits"])
                .withColumn("precision", F.col("hits") / K))
    return per_user.agg(F.avg("precision")).first()[0]


def main():
    spark = get_spark("train_als")
    ratings, movies = load_data(spark)
    ratings = ratings.drop("timestamp")

    train, test = ratings.randomSplit([0.8, 0.2], seed=SEED)

    # Drop cold items (movies with very few training ratings).
    # Without this, movies with 1-2 ratings get extreme latent factors
    # that dominate every user's top-K, because there's too little data
    # for regularisation to pull those factors toward zero.
    movie_counts = train.groupBy("movieId").agg(F.count("*").alias("count"))
    warm_movies  = movie_counts.filter(F.col("count") >= MIN_MOVIE_RATINGS).select("movieId")
    cold_movies  = movie_counts.filter(F.col("count") <  MIN_MOVIE_RATINGS)
    n_cold = cold_movies.count()
    train = train.join(warm_movies, "movieId")
    test  = test.join(warm_movies, "movieId")

    train.cache()
    test.cache()
    print(f"Dropped {n_cold:,} cold movies (< {MIN_MOVIE_RATINGS} train ratings)")
    print(f"Train: {train.count():,} ratings  Test: {test.count():,} ratings\n")

    # ---- ALS ----
    rank, reg = tune_als(train)
    model = build_als(rank, reg).fit(train)
    als_rmse = rmse(model.transform(test))

    als_recs = als_recommendations(model, train)
    als_prec = precision_at_k(als_recs, test)

    # ---- Popularity baseline ----
    # RMSE: predict each movie's average train rating (global mean if unseen).
    global_mean = train.agg(F.avg("rating")).first()[0]
    movie_stats = train.groupBy("movieId").agg(
        F.avg("rating").alias("prediction"), F.count("*").alias("popularity"))
    base_preds = (test.join(movie_stats, "movieId", "left")
                  .fillna(global_mean, subset=["prediction"]))
    base_rmse = rmse(base_preds)
    base_recs = popularity_top_k(train)
    base_prec = precision_at_k(base_recs, test)

    # ---- Results ----
    print(f"{'Model':<22}{'RMSE':>8}{f'Precision@{K}':>16}")
    print(f"{'Popularity baseline':<22}{base_rmse:>8.4f}{base_prec:>16.4f}")
    print(f"{f'ALS (rank={rank}, reg={reg})':<22}{als_rmse:>8.4f}{als_prec:>16.4f}")

    # Sanity check: show what ALS recommends for one user
    user = 1
    print(f"\nALS top-{K} for user {user}:")
    (als_recs.filter(F.col("userId") == user)
        .join(movies, "movieId").select("title", "genres")
        .show(K, truncate=False))

    # ---- Save model ----
    if SAVE_MODEL:
        # Spark saves a model as a folder, not a single file.
        # Inside MODEL_DIR you'll see:
        #   metadata/  — hyperparameters and Spark version info (JSON)
        #   itemFactors/ — the movie latent factor matrix (Parquet)
        #   userFactors/ — the user latent factor matrix (Parquet)
        # To load it later: ALSModel.load(MODEL_DIR)
        model.save(MODEL_DIR)
        print(f"\nALS model saved to {MODEL_DIR}/")

        # Save movie popularity stats (used by the baseline in the API).
        # We save as Parquet — Spark's native columnar format, faster to
        # read back than CSV and preserves column types exactly.
        movie_stats.write.mode("overwrite").parquet(POPULARITY_DIR)
        print(f"Popularity stats saved to {POPULARITY_DIR}/")

    spark.stop()


if __name__ == "__main__":
    main()
