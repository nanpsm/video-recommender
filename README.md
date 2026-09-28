# FilmTwin

**Find your film twin — personalised movie recommendations powered by Apache Spark ALS.**

🎬 **Live demo:** [filmtwin.vercel.app](https://filmtwin.vercel.app)

---

## What it does

FilmTwin asks you to rate 12 randomly-selected films (like / skip / dislike). It then compares your taste profile against 610 real MovieLens viewers using cosine similarity on genre preference vectors, finds your closest match, and surfaces the films *that person loved* that you haven't rated yet.

No account required. No tracking. Fully browser-side matching.

---

## How it works

```
User rates 12 films
        ↓
Build genre preference vector (weighted by rating)
        ↓
Cosine similarity against 610 real viewer profiles (Supabase)
        ↓
Find closest matching viewer
        ↓
Return their highest-rated unseen films as recommendations
```

### The data

- **Dataset:** [MovieLens ml-latest-small](https://grouplens.org/datasets/movielens/) — 100,836 ratings, 610 users, 9,742 movies
- **Collaborative filtering:** Apache Spark ALS (rank=20, regParam=0.1, RMSE ≈ 0.83)
- **User matching:** Cosine similarity on unit-normalised genre vectors, computed in the browser
- **Posters & metadata:** [TMDB API](https://www.themoviedb.org/)
- **Viewer profiles & feedback:** [Supabase](https://supabase.com/) (Postgres)

---

## Tech stack

| Layer | Technology |
|---|---|
| Recommendation engine | Apache Spark ALS (PySpark) |
| User profile storage | Supabase (Postgres + RLS) |
| Frontend | Next.js 14 (App Router) |
| Deployment | Vercel |
| Movie data | TMDB API |
| Fonts | Big Shoulders Display, Hanken Grotesk, JetBrains Mono |

---

## Project structure

```
video-recommender/
├── src/video_recommender/
│   ├── explore.py           # Spark session + data loading helpers
│   ├── als_model.py         # Train ALS model, evaluate RMSE
│   └── user_profiles.py     # Compute & upload genre vectors to Supabase
├── frontend/
│   ├── app/
│   │   ├── page.tsx         # Main app (rating flow → matching → results)
│   │   └── layout.tsx
│   └── .env.local           # TMDB token + Supabase keys (gitignored)
├── data/                    # MovieLens ml-latest-small (gitignored)
└── pyproject.toml
```

---

## Running locally

### Python / Spark pipeline

```bash
# Install dependencies (requires Python 3.11+, Java 11+)
uv sync

# Train ALS model and print RMSE
uv run python -m video_recommender.als_model

# Compute user genre profiles and upload to Supabase
export SUPABASE_SERVICE_KEY='your-service-role-key'
uv run python -m video_recommender.user_profiles
```

> **Note:** `SUPABASE_SERVICE_KEY` must be set as an environment variable — never commit it. The anon key is safe to hardcode (public read-only access). The service key bypasses RLS and is used only for writes in this script.

### Frontend

```bash
cd frontend
npm install

# Create .env.local with:
# NEXT_PUBLIC_SUPABASE_URL=...
# NEXT_PUBLIC_SUPABASE_ANON_KEY=...
# NEXT_PUBLIC_TMDB_TOKEN=...

npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Model performance

| Metric | Value |
|---|---|
| Algorithm | ALS (Alternating Least Squares) |
| Rank | 20 |
| Regularisation | 0.1 |
| RMSE | ~0.83 |
| Training set | 80% of 100,836 ratings |

---

## Dataset

This project uses the [MovieLens ml-latest-small](https://grouplens.org/datasets/movielens/latest/) dataset:

> F. Maxwell Harper and Joseph A. Konstan. 2015. The MovieLens Datasets: History and Context. ACM Transactions on Interactive Intelligent Systems (TiiS) 5, 4: 1–19. https://doi.org/10.1145/2827872
