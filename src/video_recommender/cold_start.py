"""Cold-start experiment: how many ratings does FilmTwin need?

Simulates the onboarding flow for every user by treating their first K liked
ratings as the only available signal, then evaluating recommendation quality
against the held-out 20% test set.

K values tested: 5, 8, 12, 16, 20, 30

Metrics (at K=10 recommendations):
  NDCG@10       — ranking quality (our primary metric)
  Precision@10  — fraction of recs the user actually liked
  Recall@10     — fraction of liked test films that appeared
  Hit Rate@10   — did at least one rec land in liked set?
  Twin stability — fraction of users whose top-1 twin is stable across ±1 rating

Run:
  uv run python -m video_recommender.cold_start
"""
import math
import random
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

from video_recommender.train_als import MIN_MOVIE_RATINGS, SEED

LIKED_THRESHOLD = 4.0
K_RATINGS       = [5, 8, 12, 16, 20, 30]
K_RECS          = 10
ALS_WEIGHT      = 0.6
GENRE_WEIGHT    = 0.4

DATA_DIR  = Path("data/ml-latest")
MODEL_DIR = Path("models/als")

GENRE_ORDER = [
    "Action", "Adventure", "Animation", "Children", "Comedy", "Crime",
    "Documentary", "Drama", "Fantasy", "Film-Noir", "Horror", "IMAX",
    "Musical", "Mystery", "Romance", "Sci-Fi", "Thriller", "War", "Western",
]
GENRE_IDX = {g: i for i, g in enumerate(GENRE_ORDER)}
N_GENRES = len(GENRE_ORDER)


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

    return train, test, movie_genres, warm_ids


def load_factors():
    print("Loading ALS factor matrices...")
    user_df = pd.read_parquet(MODEL_DIR / "userFactors")
    item_df = pd.read_parquet(MODEL_DIR / "itemFactors")
    user_ids  = user_df["id"].to_numpy()
    user_mat  = np.stack(user_df["features"].to_numpy())   # (U, rank)
    item_ids  = item_df["id"].to_numpy()
    item_mat  = np.stack(item_df["features"].to_numpy())   # (I, rank)
    print(f"  Users: {len(user_ids):,}  Items: {len(item_ids):,}  Rank: {user_mat.shape[1]}")
    return user_ids, user_mat, item_ids, item_mat


# ── Genre vector helpers ──────────────────────────────────────────────────────

def build_genre_vecs(train: pd.DataFrame, movie_genres: dict) -> dict[int, np.ndarray]:
    """Unit-normalised fixed-dim genre vec per user from ALL liked ratings."""
    liked = train[train["rating"] >= LIKED_THRESHOLD]
    mat: dict[int, np.ndarray] = {}
    for uid, grp in liked.groupby("userId"):
        vec = np.zeros(N_GENRES, dtype="float32")
        for mid in grp["movieId"]:
            for g in movie_genres.get(mid, []):
                if g in GENRE_IDX:
                    vec[GENRE_IDX[g]] += 1.0
        norm = np.linalg.norm(vec)
        if norm > 0:
            mat[int(uid)] = vec / norm
    return mat


def limited_genre_vec(movie_ids: list[int], movie_genres: dict) -> np.ndarray | None:
    """Build a unit-normalised genre vec from a subset of movie_ids."""
    vec = np.zeros(N_GENRES, dtype="float32")
    for mid in movie_ids:
        for g in movie_genres.get(mid, []):
            if g in GENRE_IDX:
                vec[GENRE_IDX[g]] += 1.0
    norm = np.linalg.norm(vec)
    if norm == 0:
        return None
    return vec / norm


# ── Metrics ───────────────────────────────────────────────────────────────────

def ranking_metrics(recs: pd.DataFrame, test: pd.DataFrame, k: int) -> dict:
    liked_test = test[test["rating"] >= LIKED_THRESHOLD]
    liked_by   = liked_test.groupby("userId")["movieId"].apply(set).to_dict()
    recs_by    = recs.groupby("userId")["movieId"].apply(list).to_dict()

    precisions, recalls, ndcgs, hits = [], [], [], []
    for uid, rec_list in recs_by.items():
        relevant = liked_by.get(uid, set())
        if not relevant:
            continue
        rec_list = rec_list[:k]
        hits_k   = [1 if m in relevant else 0 for m in rec_list]
        p = sum(hits_k) / k
        r = sum(hits_k) / len(relevant)
        dcg  = sum(h / math.log2(i + 2) for i, h in enumerate(hits_k))
        idcg = sum(1 / math.log2(i + 2) for i in range(min(len(relevant), k)))
        nd   = dcg / idcg if idcg > 0 else 0.0
        precisions.append(p); recalls.append(r); ndcgs.append(nd)
        hits.append(1 if sum(hits_k) > 0 else 0)

    n = len(precisions)
    return {
        "Precision@K": float(np.mean(precisions)) if n else 0.0,
        "Recall@K":    float(np.mean(recalls))    if n else 0.0,
        "NDCG@K":      float(np.mean(ndcgs))      if n else 0.0,
        "Hit Rate@K":  float(np.mean(hits))        if n else 0.0,
        "N": n,
    }


# ── Cold-start simulation ─────────────────────────────────────────────────────

def simulate_k_ratings(
    train:         pd.DataFrame,
    test:          pd.DataFrame,
    user_ids:      np.ndarray,
    user_mat:      np.ndarray,
    item_ids_w:    np.ndarray,
    item_mat_w:    np.ndarray,
    all_genre_mat: np.ndarray,    # (U, N_GENRES) unit-normalised, aligned with user_ids
    uid_to_row:    dict[int, int],
    movie_genres:  dict,
    k_ratings:     int,
) -> dict:
    seen_by_user  = train.groupby("userId")["movieId"].apply(set).to_dict()
    # Precompute once — avoids O(U × N_ratings) scan inside the loop
    liked_by_user = (
        train[train["rating"] >= LIKED_THRESHOLD]
        .groupby("userId")["movieId"].apply(list).to_dict()
    )
    rng  = random.Random(SEED)
    recs_rows: list[dict] = []

    # Precompute genre score array template
    item_genres_mat = np.zeros((len(item_ids_w), N_GENRES), dtype="float32")
    for j, mid in enumerate(item_ids_w):
        for g in movie_genres.get(int(mid), []):
            if g in GENRE_IDX:
                item_genres_mat[j, GENRE_IDX[g]] = 1.0
    # Each row: mean genre indicator (for genre_score = dot(query, mean_genre))
    item_genre_counts = np.maximum(item_genres_mat.sum(axis=1, keepdims=True), 1)
    item_genre_norm   = item_genres_mat / item_genre_counts  # (I, G)

    n_users = len(user_ids)

    for row_i, uid in enumerate(user_ids):
        if row_i % 5000 == 0:
            print(f"    {row_i:,}/{n_users:,}", flush=True)

        liked_movies = liked_by_user.get(int(uid), [])

        if len(liked_movies) < k_ratings:
            continue

        sampled = rng.sample(liked_movies, k_ratings)
        query   = limited_genre_vec(sampled, movie_genres)
        if query is None:
            continue

        # Find nearest twin via vectorised cosine (genre_mat already unit-normalised)
        sims = all_genre_mat @ query          # (U,)
        sims[row_i] = -np.inf                 # exclude self
        twin_row = int(np.argmax(sims))
        twin_uid = int(user_ids[twin_row])

        # ALS scores for twin on unseen items
        als_scores = item_mat_w @ user_mat[twin_row]     # (I,)
        seen       = seen_by_user.get(uid, set())
        seen_mask  = np.isin(item_ids_w, list(seen))
        als_scores[seen_mask] = -np.inf

        valid = als_scores[als_scores > -np.inf]
        if len(valid) == 0:
            continue
        mn, mx    = valid.min(), valid.max()
        als_norm  = (als_scores - mn) / (mx - mn + 1e-9)

        genre_scores = item_genre_norm @ query            # (I,)
        hybrid       = ALS_WEIGHT * als_norm + GENRE_WEIGHT * genre_scores

        top_idx = np.argpartition(hybrid, -K_RECS)[-K_RECS:]
        picks   = item_ids_w[top_idx].tolist()
        recs_rows.extend({"userId": int(uid), "movieId": int(m)} for m in picks)

    return ranking_metrics(pd.DataFrame(recs_rows), test, k=K_RECS)


# ── Twin stability ────────────────────────────────────────────────────────────

def twin_stability(
    train:         pd.DataFrame,
    user_ids:      np.ndarray,
    all_genre_mat: np.ndarray,
    movie_genres:  dict,
    k_ratings:     int,
    n_perturb:     int = 3,
) -> float:
    liked_by_user = (
        train[train["rating"] >= LIKED_THRESHOLD]
        .groupby("userId")["movieId"].apply(list).to_dict()
    )
    rng = random.Random(SEED + 1)
    stable = total = 0

    for row_i, uid in enumerate(user_ids):
        liked_movies = liked_by_user.get(int(uid), [])

        if len(liked_movies) < k_ratings + 1:
            continue

        sampled   = rng.sample(liked_movies, k_ratings)
        base_vec  = limited_genre_vec(sampled, movie_genres)
        if base_vec is None:
            continue

        sims = all_genre_mat @ base_vec
        sims[row_i] = -np.inf
        base_twin = int(np.argmax(sims))

        perturb_stable = 0
        for _ in range(n_perturb):
            alt_sampled = rng.sample(liked_movies, k_ratings)
            alt_vec     = limited_genre_vec(alt_sampled, movie_genres)
            if alt_vec is None:
                continue
            alt_sims = all_genre_mat @ alt_vec
            alt_sims[row_i] = -np.inf
            alt_twin = int(np.argmax(alt_sims))
            if alt_twin == base_twin:
                perturb_stable += 1

        stable += perturb_stable / n_perturb
        total  += 1

    return stable / total if total > 0 else 0.0


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    train, test, movie_genres, warm_ids = load_data()
    user_ids, user_mat, item_ids, item_mat = load_factors()

    # Filter item matrix to warm items only
    warm_mask  = np.isin(item_ids, list(warm_ids))
    item_ids_w = item_ids[warm_mask]
    item_mat_w = item_mat[warm_mask]

    # Build full genre matrix for all ALS users (for twin matching)
    print("Building genre vectors for all users...")
    all_genre_vecs = build_genre_vecs(train, movie_genres)

    # Align genre matrix with user_ids order from ALS factor matrix
    all_genre_mat = np.zeros((len(user_ids), N_GENRES), dtype="float32")
    uid_to_row    = {int(uid): i for i, uid in enumerate(user_ids)}
    for uid, vec in all_genre_vecs.items():
        if uid in uid_to_row:
            all_genre_mat[uid_to_row[uid]] = vec

    col_w   = 13
    headers = ["Precision@10", "Recall@10", "NDCG@10", "Hit Rate@10", "Stability", "N"]
    print(f"\n{'K ratings':>12}", end="")
    for h in headers:
        print(f"{h:>{col_w}}", end="")
    print()
    print("-" * (12 + col_w * len(headers)))

    for k in K_RATINGS:
        print(f"\n  Evaluating K={k} (recs)...", flush=True)
        m = simulate_k_ratings(
            train, test,
            user_ids, user_mat,
            item_ids_w, item_mat_w,
            all_genre_mat, uid_to_row,
            movie_genres, k,
        )
        print(f"  Computing stability K={k}...", flush=True)
        stab = twin_stability(train, user_ids, all_genre_mat, movie_genres, k)
        row  = [m["Precision@K"], m["Recall@K"], m["NDCG@K"], m["Hit Rate@K"], stab, m["N"]]
        print(f"{k:>12}", end="")
        for v in row:
            print(f"{v:>{col_w}.4f}" if isinstance(v, float) else f"{v:>{col_w}}", end="")
        print()

    print(f"\nLIKED_THRESHOLD={LIKED_THRESHOLD}  K_RECS={K_RECS}  seed={SEED}")


if __name__ == "__main__":
    main()
