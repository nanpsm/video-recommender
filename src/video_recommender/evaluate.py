"""Offline evaluation of FilmTwin recommendation baselines.

Splits ratings 80/20, generates Top-10 recommendations from each baseline
using only the training 80%, then measures quality against the held-out 20%.

Metrics (all at K=10):
  Precision@K  — fraction of recommended films the user actually liked
  Recall@K     — fraction of liked test films that appeared in the top-10
  NDCG@K       — ranking quality (hits ranked higher count more)
  Hit Rate@K   — did at least one recommended film land in the user's liked set?

Baselines:
  Random            — random unseen films
  Popularity        — globally most-rated unseen films
  Genre similarity  — nearest user by genre vector → their ALS top-K
  ALS               — collaborative filtering only
  Hybrid            — 0.6 × ALS_norm + 0.4 × genre_score (deployed)

Run:
  uv run python -m video_recommender.evaluate
"""
import math
import random
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

LIKED_THRESHOLD    = 4.0   # must match train_als.py
MIN_MOVIE_RATINGS  = 5     # must match train_als.py
SEED               = 42    # must match train_als.py

K          = 10
ALS_WEIGHT = 0.6
GENRE_WEIGHT = 0.4

DATA_DIR  = Path("data/ml-latest")
MODEL_DIR = Path("models/als")

GENRE_ORDER = [
    "Action", "Adventure", "Animation", "Children", "Comedy", "Crime",
    "Documentary", "Drama", "Fantasy", "Film-Noir", "Horror", "IMAX",
    "Musical", "Mystery", "Romance", "Sci-Fi", "Thriller", "War", "Western",
]
GENRE_IDX = {g: i for i, g in enumerate(GENRE_ORDER)}
N_GENRES  = len(GENRE_ORDER)


# ── Data loading ──────────────────────────────────────────────────────────────

def load_data():
    print("Loading ratings and movies...")
    ratings = pd.read_csv(
        DATA_DIR / "ratings.csv",
        usecols=["userId", "movieId", "rating"],
        dtype={"userId": "int32", "movieId": "int32", "rating": "float32"},
    )
    movies = pd.read_csv(DATA_DIR / "movies.csv", dtype={"movieId": "int32"})

    rng  = np.random.default_rng(SEED)
    mask = rng.random(len(ratings)) < 0.8
    train = ratings[mask].copy()
    test  = ratings[~mask].copy()

    counts    = train.groupby("movieId")["movieId"].transform("count")
    warm_mask = counts >= MIN_MOVIE_RATINGS
    train     = train[warm_mask]
    warm_ids  = set(train["movieId"].unique())
    test      = test[test["movieId"].isin(warm_ids)]

    movie_genres: dict[int, list[str]] = {}
    for row in movies.itertuples():
        if row.genres != "(no genres listed)":
            movie_genres[row.movieId] = row.genres.split("|")

    all_movie_ids = movies["movieId"].tolist()
    print(f"  Train: {len(train):,}  Test: {len(test):,}  Warm items: {len(warm_ids):,}")
    return train, test, movie_genres, all_movie_ids, warm_ids


def load_factors():
    print("Loading ALS factor matrices...")
    user_df  = pd.read_parquet(MODEL_DIR / "userFactors")
    item_df  = pd.read_parquet(MODEL_DIR / "itemFactors")
    user_ids = user_df["id"].to_numpy(dtype="int32")
    user_mat = np.stack(user_df["features"].to_numpy()).astype("float32")
    item_ids = item_df["id"].to_numpy(dtype="int32")
    item_mat = np.stack(item_df["features"].to_numpy()).astype("float32")
    print(f"  Users: {len(user_ids):,}  Items: {len(item_ids):,}  Rank: {user_mat.shape[1]}")
    return user_ids, user_mat, item_ids, item_mat


# ── Metrics ───────────────────────────────────────────────────────────────────

def ranking_metrics(recs: pd.DataFrame, test: pd.DataFrame) -> dict:
    liked_by   = (test[test["rating"] >= LIKED_THRESHOLD]
                  .groupby("userId")["movieId"].apply(set).to_dict())
    recs_by    = recs.groupby("userId")["movieId"].apply(list).to_dict()

    precision_list, recall_list, ndcg_list, hit_list = [], [], [], []
    for uid, liked_set in liked_by.items():
        rec_list = recs_by.get(uid, [])[:K]
        if not rec_list:
            continue
        hits  = [1 if m in liked_set else 0 for m in rec_list]
        n_hit = sum(hits)
        precision_list.append(n_hit / K)
        recall_list.append(n_hit / len(liked_set))
        dcg   = sum(h / math.log2(i + 2) for i, h in enumerate(hits))
        ideal = sum(1 / math.log2(i + 2) for i in range(min(len(liked_set), K)))
        ndcg_list.append(dcg / ideal if ideal > 0 else 0.0)
        hit_list.append(1.0 if n_hit > 0 else 0.0)

    n = len(precision_list)
    return {
        "Precision@K": sum(precision_list) / n if n else 0.0,
        "Recall@K":    sum(recall_list)    / n if n else 0.0,
        "NDCG@K":      sum(ndcg_list)      / n if n else 0.0,
        "Hit Rate@K":  sum(hit_list)       / n if n else 0.0,
        "N": n,
    }


# ── Genre helpers ─────────────────────────────────────────────────────────────

def build_genre_vecs(train: pd.DataFrame, movie_genres: dict) -> dict[int, np.ndarray]:
    liked = train[train["rating"] >= LIKED_THRESHOLD]
    vecs: dict[int, np.ndarray] = {}
    for uid, grp in liked.groupby("userId"):
        vec = np.zeros(N_GENRES, dtype="float32")
        for mid in grp["movieId"]:
            for g in movie_genres.get(mid, []):
                if g in GENRE_IDX:
                    vec[GENRE_IDX[g]] += 1.0
        norm = np.linalg.norm(vec)
        if norm > 0:
            vecs[int(uid)] = vec / norm
    return vecs


def item_genre_matrix(item_ids_w: np.ndarray, movie_genres: dict) -> np.ndarray:
    mat = np.zeros((len(item_ids_w), N_GENRES), dtype="float32")
    for j, mid in enumerate(item_ids_w):
        for g in movie_genres.get(int(mid), []):
            if g in GENRE_IDX:
                mat[j, GENRE_IDX[g]] = 1.0
    counts = np.maximum(mat.sum(axis=1, keepdims=True), 1)
    return mat / counts  # (I, G) normalised


# ── Baselines ─────────────────────────────────────────────────────────────────

def baseline_random(train: pd.DataFrame, all_movie_ids: list) -> pd.DataFrame:
    rng = random.Random(SEED)
    seen_by = train.groupby("userId")["movieId"].apply(set).to_dict()
    rows = []
    for uid, seen in seen_by.items():
        pool  = [m for m in all_movie_ids if m not in seen]
        picks = rng.sample(pool, min(K, len(pool)))
        rows.extend({"userId": uid, "movieId": m} for m in picks)
    return pd.DataFrame(rows)


def baseline_popularity(train: pd.DataFrame) -> pd.DataFrame:
    seen_by   = train.groupby("userId")["movieId"].apply(set).to_dict()
    pop_order = train.groupby("movieId").size().sort_values(ascending=False).index.tolist()
    rows = []
    for uid, seen in seen_by.items():
        picks = [m for m in pop_order if m not in seen][:K]
        rows.extend({"userId": uid, "movieId": m} for m in picks)
    return pd.DataFrame(rows)


def baseline_genre_sim(
    train: pd.DataFrame,
    user_ids: np.ndarray,
    user_mat: np.ndarray,
    item_ids_w: np.ndarray,
    item_mat_w: np.ndarray,
    movie_genres: dict,
) -> pd.DataFrame:
    """Nearest user by genre vector → their ALS top-K (FilmTwin v1 approach)."""
    genre_vecs  = build_genre_vecs(train, movie_genres)
    seen_by     = train.groupby("userId")["movieId"].apply(set).to_dict()
    uid_to_row  = {int(uid): i for i, uid in enumerate(user_ids)}

    # Build aligned genre matrix
    genre_mat = np.zeros((len(user_ids), N_GENRES), dtype="float32")
    for uid, vec in genre_vecs.items():
        if uid in uid_to_row:
            genre_mat[uid_to_row[uid]] = vec

    rows = []
    for row_i, uid in enumerate(user_ids):
        uid = int(uid)
        if uid not in genre_vecs:
            continue
        query = genre_vecs[uid]
        sims  = genre_mat @ query
        sims[row_i] = -np.inf
        twin_row = int(np.argmax(sims))
        seen = seen_by.get(uid, set())
        als_scores = item_mat_w @ user_mat[twin_row]
        seen_mask  = np.isin(item_ids_w, list(seen))
        als_scores[seen_mask] = -np.inf
        top_idx = np.argpartition(als_scores, -K)[-K:]
        top_idx = top_idx[np.argsort(als_scores[top_idx])[::-1]]
        rows.extend({"userId": uid, "movieId": int(item_ids_w[i])} for i in top_idx)
    return pd.DataFrame(rows)


def baseline_als(
    train: pd.DataFrame,
    user_ids: np.ndarray,
    user_mat: np.ndarray,
    item_ids_w: np.ndarray,
    item_mat_w: np.ndarray,
) -> pd.DataFrame:
    seen_by = train.groupby("userId")["movieId"].apply(set).to_dict()
    rows = []
    for row_i, uid in enumerate(user_ids):
        uid = int(uid)
        scores    = item_mat_w @ user_mat[row_i]
        seen      = seen_by.get(uid, set())
        seen_mask = np.isin(item_ids_w, list(seen))
        scores[seen_mask] = -np.inf
        top_idx = np.argpartition(scores, -K)[-K:]
        top_idx = top_idx[np.argsort(scores[top_idx])[::-1]]
        rows.extend({"userId": uid, "movieId": int(item_ids_w[i])} for i in top_idx)
    return pd.DataFrame(rows)


def baseline_hybrid(
    train: pd.DataFrame,
    user_ids: np.ndarray,
    user_mat: np.ndarray,
    item_ids_w: np.ndarray,
    item_mat_w: np.ndarray,
    movie_genres: dict,
) -> pd.DataFrame:
    genre_vecs   = build_genre_vecs(train, movie_genres)
    seen_by      = train.groupby("userId")["movieId"].apply(set).to_dict()
    item_genre_m = item_genre_matrix(item_ids_w, movie_genres)  # (I, G)

    rows = []
    for row_i, uid in enumerate(user_ids):
        uid = int(uid)
        als_scores = item_mat_w @ user_mat[row_i]
        seen       = seen_by.get(uid, set())
        seen_mask  = np.isin(item_ids_w, list(seen))

        valid = als_scores[~seen_mask]
        if len(valid) == 0:
            continue
        mn, mx   = valid.min(), valid.max()
        als_norm = (als_scores - mn) / (mx - mn + 1e-9)
        als_norm[seen_mask] = -np.inf

        query       = genre_vecs.get(uid, np.zeros(N_GENRES, dtype="float32"))
        genre_score = item_genre_m @ query
        hybrid      = ALS_WEIGHT * als_norm + GENRE_WEIGHT * genre_score
        hybrid[seen_mask] = -np.inf

        top_idx = np.argpartition(hybrid, -K)[-K:]
        top_idx = top_idx[np.argsort(hybrid[top_idx])[::-1]]
        rows.extend({"userId": uid, "movieId": int(item_ids_w[i])} for i in top_idx)
    return pd.DataFrame(rows)


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    train, test, movie_genres, all_movie_ids, warm_ids = load_data()
    user_ids, user_mat, item_ids, item_mat = load_factors()

    warm_mask  = np.isin(item_ids, list(warm_ids))
    item_ids_w = item_ids[warm_mask]
    item_mat_w = item_mat[warm_mask]

    print(f"\nEvaluating Top-{K} recommendations...\n")

    baselines = [
        ("Random",           lambda: baseline_random(train, all_movie_ids)),
        ("Popularity",       lambda: baseline_popularity(train)),
        ("Genre similarity", lambda: baseline_genre_sim(train, user_ids, user_mat, item_ids_w, item_mat_w, movie_genres)),
        ("ALS",              lambda: baseline_als(train, user_ids, user_mat, item_ids_w, item_mat_w)),
        ("Hybrid",           lambda: baseline_hybrid(train, user_ids, user_mat, item_ids_w, item_mat_w, movie_genres)),
    ]

    results = {}
    for name, fn in baselines:
        print(f"  Computing {name}...", flush=True)
        results[name] = ranking_metrics(fn(), test)

    col_w   = 14
    headers = ["Precision@K", "Recall@K", "NDCG@K", "Hit Rate@K", "N"]
    print(f"\n{'Baseline':25}", end="")
    for h in headers:
        print(f"{h:>{col_w}}", end="")
    print()
    print("-" * (25 + col_w * len(headers)))
    for name, scores in results.items():
        print(f"{name:25}", end="")
        for h in headers:
            v = scores[h]
            print(f"{v:>{col_w}.4f}" if isinstance(v, float) else f"{v:>{col_w}}", end="")
        print()

    print(f"\nLIKED_THRESHOLD={LIKED_THRESHOLD}  K={K}  seed={SEED}")


if __name__ == "__main__":
    main()
