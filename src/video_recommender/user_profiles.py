"""Compute per-user genre preference scores and store them in Supabase.

Uses pure pandas (no Spark) — reads ratings.csv and movies.csv directly.

Writes two tables:
  user_genre_profiles  — (user_id, genre, score) rows for Taste DNA display
  user_embeddings      — (user_id, vector(19)) for server-side twin matching via pgvector

SUPABASE_SERVICE_KEY must be set as an environment variable — never commit it.
The anon key is safe to hardcode (public read-only access).
The service key bypasses RLS and is used only for writes in this script.

Run:  uv run python -m video_recommender.user_profiles
"""
import os
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd
from supabase import create_client

SUPABASE_URL = "https://spmtgrmedfilavekoije.supabase.co"
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")
if not SUPABASE_SERVICE_KEY:
    raise EnvironmentError(
        "SUPABASE_SERVICE_KEY not set. Run:\n"
        "  export SUPABASE_SERVICE_KEY='your-service-role-key'"
    )

DATA_DIR         = Path("data/ml-latest")
LIKED_THRESHOLD  = 3.5
BATCH_SIZE       = 500
SEED             = 42
MIN_MOVIE_RATINGS = 5

# Fixed genre order for pgvector embedding (dimension = 19)
GENRES = [
    "Action", "Adventure", "Animation", "Children", "Comedy", "Crime",
    "Documentary", "Drama", "Fantasy", "Film-Noir", "Horror", "IMAX",
    "Musical", "Mystery", "Romance", "Sci-Fi", "Thriller", "War", "Western",
]
GENRE_IDX = {g: i for i, g in enumerate(GENRES)}


def main():
    print("Loading ratings and movies...")
    ratings = pd.read_csv(DATA_DIR / "ratings.csv",
                          usecols=["userId", "movieId", "rating"],
                          dtype={"userId": "int32", "movieId": "int32", "rating": "float32"})
    movies = pd.read_csv(DATA_DIR / "movies.csv",
                         dtype={"movieId": "int32"})

    # Same 80/20 train split used in training
    rng   = np.random.default_rng(SEED)
    mask  = rng.random(len(ratings)) < 0.8
    train = ratings[mask].copy()

    # Same cold-movie filter
    counts    = train.groupby("movieId")["movieId"].transform("count")
    train     = train[counts >= MIN_MOVIE_RATINGS]

    # Keep only liked ratings
    liked = train[train["rating"] >= LIKED_THRESHOLD]

    # Build genre lookup
    movie_genres: dict[int, list[str]] = {}
    for row in movies.itertuples():
        if row.genres != "(no genres listed)":
            movie_genres[row.movieId] = row.genres.split("|")

    # Join liked ratings with genres
    liked_genres = liked.merge(
        movies[["movieId", "genres"]], on="movieId", how="inner"
    )

    print("Building genre preference vectors...")
    user_genre: dict[int, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for row in liked_genres.itertuples():
        for genre in row.genres.split("|"):
            if genre == "(no genres listed)":
                continue
            user_genre[row.userId][genre] += float(row.rating)

    profile_rows   = []
    embedding_rows = []

    for user_id, genre_scores in user_genre.items():
        mag = sum(v * v for v in genre_scores.values()) ** 0.5
        if mag == 0:
            continue

        # Sparse profile rows for Taste DNA display
        for genre, score in genre_scores.items():
            profile_rows.append({
                "user_id": int(user_id),
                "genre":   genre,
                "score":   round(score / mag, 6),
            })

        # Dense fixed-dim vector for pgvector
        vec = [0.0] * len(GENRES)
        for genre, score in genre_scores.items():
            if genre in GENRE_IDX:
                vec[GENRE_IDX[genre]] = round(score / mag, 6)
        embedding_rows.append({"user_id": int(user_id), "embedding": vec})

    print(f"Users: {len(embedding_rows):,}  |  profile rows: {len(profile_rows):,}")

    sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    skip_profiles = os.environ.get("SKIP_PROFILES") == "1"

    # ── user_genre_profiles ───────────────────────────────────────────────────
    if skip_profiles:
        print("Skipping user_genre_profiles (SKIP_PROFILES=1)")
    else:
        print("Clearing user_genre_profiles...")
        sb.table("user_genre_profiles").delete().neq("user_id", -1).execute()
        for i in range(0, len(profile_rows), BATCH_SIZE):
            sb.table("user_genre_profiles").insert(profile_rows[i: i + BATCH_SIZE]).execute()
            if (i // BATCH_SIZE) % 20 == 0:
                print(f"  profiles {min(i + BATCH_SIZE, len(profile_rows)):,} / {len(profile_rows):,}")

    # ── user_embeddings ───────────────────────────────────────────────────────
    # Table was pre-truncated via SQL (DELETE times out on large tables)
    print("Inserting user_embeddings...")
    for i in range(0, len(embedding_rows), BATCH_SIZE):
        sb.table("user_embeddings").insert(embedding_rows[i: i + BATCH_SIZE]).execute()
        if (i // BATCH_SIZE) % 20 == 0:
            print(f"  embeddings {min(i + BATCH_SIZE, len(embedding_rows)):,} / {len(embedding_rows):,}")

    print("Done.")


if __name__ == "__main__":
    main()
