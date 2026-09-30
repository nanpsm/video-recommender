"""Popularity bias audit for FilmTwin recommendations.

Measures how much the recommender depends on popular films vs. the long tail.

Metrics:
  Catalog coverage   — fraction of all films ever recommended
  Popularity bias    — avg. rating count of recommended films vs. all films
  Novelty            — avg. self-information of recommended films
  Diversity          — avg. pairwise genre dissimilarity within a rec list
  Long-tail share    — fraction of recs from the bottom 80% of popularity

Run:
  uv run python -m video_recommender.bias_audit
"""
import math
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd

MIN_MOVIE_RATINGS = 5   # must match train_als.py
SEED = 42               # must match train_als.py

from video_recommender.evaluate import (
    build_genre_vecs, item_genre_matrix,
    GENRE_ORDER, GENRE_IDX, N_GENRES,
    ALS_WEIGHT, GENRE_WEIGHT, K,
)

LIKED_THRESHOLD = 4.0
DATA_DIR  = Path("data/ml-latest")
MODEL_DIR = Path("models/als")


def genre_dissimilarity(genres_a: list[str], genres_b: list[str]) -> float:
    sa, sb = set(genres_a), set(genres_b)
    if not sa and not sb:
        return 0.0
    return 1.0 - len(sa & sb) / len(sa | sb)


def intra_list_diversity(rec_list: list[int], movie_genres: dict) -> float:
    if len(rec_list) < 2:
        return 0.0
    total = pairs = 0
    for i in range(len(rec_list)):
        for j in range(i + 1, len(rec_list)):
            total += genre_dissimilarity(
                movie_genres.get(rec_list[i], []),
                movie_genres.get(rec_list[j], []),
            )
            pairs += 1
    return total / pairs if pairs > 0 else 0.0


def novelty_score(rec_list: list[int], pop_prob: dict) -> float:
    scores = [-math.log2(pop_prob.get(mid, 1e-6)) for mid in rec_list]
    return sum(scores) / len(scores) if scores else 0.0


def main() -> None:
    print("Loading ratings and movies...")
    ratings = pd.read_csv(
        DATA_DIR / "ratings.csv",
        usecols=["userId", "movieId", "rating"],
        dtype={"userId": "int32", "movieId": "int32", "rating": "float32"},
    )
    movies = pd.read_csv(DATA_DIR / "movies.csv", dtype={"movieId": "int32"})

    rng   = np.random.default_rng(SEED)
    mask  = rng.random(len(ratings)) < 0.8
    train = ratings[mask].copy()

    counts    = train.groupby("movieId")["movieId"].transform("count")
    train     = train[counts >= MIN_MOVIE_RATINGS]
    warm_ids  = set(train["movieId"].unique())

    movie_genres: dict[int, list[str]] = {}
    for row in movies.itertuples():
        if row.genres != "(no genres listed)":
            movie_genres[row.movieId] = row.genres.split("|")

    total_movies = len(movies)
    pop_counts   = train.groupby("movieId").size().to_dict()
    total_ratings = sum(pop_counts.values())
    pop_prob      = {mid: c / total_ratings for mid, c in pop_counts.items()}
    sorted_pop    = sorted(pop_counts.values(), reverse=True)
    head_threshold = sorted_pop[int(len(sorted_pop) * 0.2)]

    print("Loading ALS factor matrices...")
    user_df  = pd.read_parquet(MODEL_DIR / "userFactors")
    item_df  = pd.read_parquet(MODEL_DIR / "itemFactors")
    user_ids = user_df["id"].to_numpy(dtype="int32")
    user_mat = np.stack(user_df["features"].to_numpy()).astype("float32")
    item_ids = item_df["id"].to_numpy(dtype="int32")
    item_mat = np.stack(item_df["features"].to_numpy()).astype("float32")

    warm_mask  = np.isin(item_ids, list(warm_ids))
    item_ids_w = item_ids[warm_mask]
    item_mat_w = item_mat[warm_mask]

    print("Building genre vectors and item genre matrix...")
    genre_vecs   = build_genre_vecs(train, movie_genres)
    item_genre_m = item_genre_matrix(item_ids_w, movie_genres)
    seen_by      = train.groupby("userId")["movieId"].apply(set).to_dict()

    print("Computing hybrid recommendations for all users...")
    rows = []
    for row_i, uid in enumerate(user_ids):
        uid = int(uid)
        if row_i % 5000 == 0:
            print(f"  {row_i:,}/{len(user_ids):,}", flush=True)
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

    recs_pd = pd.DataFrame(rows)
    print(f"Generated {len(recs_pd):,} recommendation rows for {recs_pd['userId'].nunique():,} users\n")

    recommended_movies = set(recs_pd["movieId"].unique())
    coverage = len(recommended_movies) / total_movies

    rec_pop       = [pop_counts.get(mid, 0) for mid in recs_pd["movieId"]]
    all_pop       = list(pop_counts.values())
    avg_rec_pop   = sum(rec_pop) / len(rec_pop)
    avg_all_pop   = sum(all_pop) / len(all_pop)
    median_rec_pop = sorted(rec_pop)[len(rec_pop) // 2]

    long_tail_recs  = sum(1 for mid in recs_pd["movieId"] if pop_counts.get(mid, 0) < head_threshold)
    long_tail_share = long_tail_recs / len(recs_pd)

    novelty_scores:   list[float] = []
    diversity_scores: list[float] = []
    for uid, grp in recs_pd.groupby("userId"):
        rec_list = grp["movieId"].tolist()
        novelty_scores.append(novelty_score(rec_list, pop_prob))
        diversity_scores.append(intra_list_diversity(rec_list, movie_genres))

    avg_novelty   = sum(novelty_scores)   / len(novelty_scores)
    avg_diversity = sum(diversity_scores) / len(diversity_scores)

    rec_counter = Counter(recs_pd["movieId"].tolist())
    movie_title = {r.movieId: r.title for r in movies.itertuples()}

    print("=" * 60)
    print("POPULARITY BIAS AUDIT — FilmTwin Hybrid Recommender")
    print("=" * 60)

    print(f"\n── Catalog coverage ──────────────────────────────────────")
    print(f"  Total movies in catalog:       {total_movies:>8,}")
    print(f"  Unique movies recommended:     {len(recommended_movies):>8,}")
    print(f"  Coverage:                      {coverage:>8.1%}")

    print(f"\n── Popularity bias ───────────────────────────────────────")
    print(f"  Avg rating count (all movies): {avg_all_pop:>8.1f}")
    print(f"  Avg rating count (recs):       {avg_rec_pop:>8.1f}")
    print(f"  Median rating count (recs):    {median_rec_pop:>8,}")
    print(f"  Popularity ratio (rec/all):    {avg_rec_pop/avg_all_pop:>8.2f}x")

    print(f"\n── Long-tail ─────────────────────────────────────────────")
    print(f"  Head threshold (top 20%):      {head_threshold:>8,} ratings")
    print(f"  Long-tail share of recs:       {long_tail_share:>8.1%}")

    print(f"\n── Novelty & diversity ───────────────────────────────────")
    print(f"  Avg novelty (self-information):{avg_novelty:>8.2f} bits")
    print(f"  Avg intra-list diversity:      {avg_diversity:>8.4f}")

    print(f"\n── Top 20 most recommended films ─────────────────────────")
    print(f"  {'#':>4}  {'Movie':45}  {'Recs':>6}  {'Pop (ratings)':>14}")
    print(f"  {'-'*4}  {'-'*45}  {'-'*6}  {'-'*14}")
    for rank, (mid, count) in enumerate(rec_counter.most_common(20), 1):
        title = movie_title.get(mid, f"id={mid}")[:44]
        pop   = pop_counts.get(mid, 0)
        print(f"  {rank:>4}  {title:45}  {count:>6}  {pop:>14,}")

    print(f"\nLIKED_THRESHOLD={LIKED_THRESHOLD}  K={K}  ALS_WEIGHT={ALS_WEIGHT}  seed={SEED}")
    print(f"Users: {len(user_ids):,}  Warm items: {len(item_ids_w):,}")


if __name__ == "__main__":
    main()
