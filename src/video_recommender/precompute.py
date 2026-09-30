"""Precompute top-K recommendations for all users and store them in Supabase.

Uses the saved ALS factor matrices (Parquet) + numpy — no Spark needed at runtime.

Scoring:
  hybrid = ALS_WEIGHT * als_norm + GENRE_WEIGHT * genre_score

Run:  uv run python -m video_recommender.precompute
"""
import os
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd
from supabase import create_client

# SUPABASE_SERVICE_KEY must be set as an environment variable — never commit it.
# The anon key is safe to hardcode (public read-only access).
# The service key bypasses RLS and is used only for writes in this script.
SUPABASE_URL = "https://spmtgrmedfilavekoije.supabase.co"
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")
if not SUPABASE_SERVICE_KEY:
    raise EnvironmentError(
        "SUPABASE_SERVICE_KEY not set. Run:\n"
        "  export SUPABASE_SERVICE_KEY='your-service-role-key'"
    )

MODEL_DIR    = Path("models/als")
DATA_DIR     = Path("data/ml-latest")
K            = 10
BATCH_SIZE   = 500
LIKED_THRESHOLD = 4.0
MIN_MOVIE_RATINGS = 5
SEED         = 42

ALS_WEIGHT   = 0.6
GENRE_WEIGHT = 0.4


def load_factors(model_dir: Path) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Load user and item latent factor matrices from Parquet."""
    user_df = pd.read_parquet(model_dir / "userFactors")  # id, features
    item_df = pd.read_parquet(model_dir / "itemFactors")  # id, features
    return user_df, item_df


def build_genre_vecs(liked: pd.DataFrame, movie_genres: dict) -> dict:
    """Unit-normalised genre preference vector per user."""
    vecs: dict[int, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for row in liked.itertuples():
        for g in movie_genres.get(row.movieId, []):
            vecs[row.userId][g] += float(row.rating)
    for uid, vec in vecs.items():
        mag = sum(v * v for v in vec.values()) ** 0.5
        if mag > 0:
            for g in vec:
                vec[g] /= mag
    return vecs


def main():
    # ── Load factor matrices ──────────────────────────────────────────────────
    print("Loading ALS factor matrices...")
    user_df, item_df = load_factors(MODEL_DIR)
    # numpy arrays for fast dot product
    user_ids  = user_df["id"].to_numpy()
    user_mat  = np.stack(user_df["features"].to_numpy())   # (U, rank)
    item_ids  = item_df["id"].to_numpy()
    item_mat  = np.stack(item_df["features"].to_numpy())   # (I, rank)
    print(f"  Users: {len(user_ids):,}  Items: {len(item_ids):,}  Rank: {user_mat.shape[1]}")

    # ── Load ratings + movies ─────────────────────────────────────────────────
    print("Loading ratings and movies...")
    ratings = pd.read_csv(DATA_DIR / "ratings.csv",
                          usecols=["userId", "movieId", "rating"],
                          dtype={"userId": "int32", "movieId": "int32", "rating": "float32"})
    movies  = pd.read_csv(DATA_DIR / "movies.csv",
                          dtype={"movieId": "int32"})

    # Same 80/20 split used in training (fixed seed → identical split)
    rng   = np.random.default_rng(SEED)
    mask  = rng.random(len(ratings)) < 0.8
    train = ratings[mask].copy()

    # Same cold-movie filter
    counts     = train.groupby("movieId")["movieId"].transform("count")
    warm_mask  = counts >= MIN_MOVIE_RATINGS
    train      = train[warm_mask]
    warm_items = set(train["movieId"].unique())

    # ── Build lookup structures ───────────────────────────────────────────────
    movie_genres = {
        r.movieId: r.genres.split("|")
        for r in movies.itertuples()
        if r.genres != "(no genres listed)"
    }
    movie_meta = {r.movieId: (r.title, r.genres) for r in movies.itertuples()}
    seen_by_user = train.groupby("userId")["movieId"].apply(set).to_dict()

    liked = train[train["rating"] >= LIKED_THRESHOLD]
    user_vecs = build_genre_vecs(liked, movie_genres)

    # ── Filter item matrix to warm items only ─────────────────────────────────
    warm_mask_items = np.isin(item_ids, list(warm_items))
    item_ids_w  = item_ids[warm_mask_items]
    item_mat_w  = item_mat[warm_mask_items]

    # ── Score and select top-K per user ──────────────────────────────────────
    print("Computing hybrid scores and selecting top-K per user...")
    records = []
    for i, uid in enumerate(user_ids):
        if i % 5000 == 0:
            print(f"  {i:,} / {len(user_ids):,} users")

        seen = seen_by_user.get(uid, set())
        vec  = user_vecs.get(uid, {})

        # ALS scores via dot product: (I,)
        als_scores = item_mat_w @ user_mat[i]

        # Mask seen items
        seen_mask = np.isin(item_ids_w, list(seen))
        als_scores[seen_mask] = -np.inf

        # Normalise to [0, 1] per user
        valid = als_scores[als_scores > -np.inf]
        if len(valid) == 0:
            continue
        mn, mx = valid.min(), valid.max()
        als_norm = (als_scores - mn) / (mx - mn + 1e-9)

        # Genre scores
        genre_arr = np.array([
            (sum(vec.get(g, 0) for g in movie_genres.get(mid, [])) /
             max(len(movie_genres.get(mid, [])), 1))
            for mid in item_ids_w
        ], dtype="float32")

        hybrid = ALS_WEIGHT * als_norm + GENRE_WEIGHT * genre_arr

        # Top-K indices
        top_idx = np.argpartition(hybrid, -K)[-K:]
        top_idx = top_idx[np.argsort(hybrid[top_idx])[::-1]]

        for rank, idx in enumerate(top_idx, start=1):
            mid = int(item_ids_w[idx])
            title, genres = movie_meta.get(mid, ("Unknown", ""))
            records.append({
                "user_id":  int(uid),
                "rank":     rank,
                "movie_id": mid,
                "title":    title,
                "genres":   genres,
            })

    print(f"Total recommendations: {len(records):,}")

    # ── Write to Supabase ─────────────────────────────────────────────────────
    print("Inserting into Supabase...")
    supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    supabase.table("recommendations").delete().neq("user_id", -1).execute()

    for i in range(0, len(records), BATCH_SIZE):
        batch = records[i: i + BATCH_SIZE]
        supabase.table("recommendations").insert(batch).execute()
        if i % 10000 == 0:
            print(f"  Inserted {min(i + BATCH_SIZE, len(records)):,} / {len(records):,}")

    print("Done.")


if __name__ == "__main__":
    main()
