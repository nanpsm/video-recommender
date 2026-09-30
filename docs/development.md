# Development Setup

## Requirements

- Python 3.11+
- Java 11+ (for Spark)
- Node.js 18+
- [uv](https://github.com/astral-sh/uv)
- A [Supabase](https://supabase.com) project with pgvector enabled

## Python pipeline

```bash
# Install dependencies
uv sync

# 1. Train ALS model — saves factor matrices to models/als/ (Parquet)
uv run python -m video_recommender.train_als

# 2. Compute genre embeddings and upload to Supabase
export SUPABASE_SERVICE_KEY='your-service-role-key'
uv run python -m video_recommender.user_profiles

# 3. Offline evaluation
uv run python -m video_recommender.evaluate

# 4. Cold-start experiment
uv run python -m video_recommender.cold_start

# 5. Popularity bias audit
uv run python -m video_recommender.bias_audit
```

> **Security:** `SUPABASE_SERVICE_KEY` must be set as an environment variable — never commit it. The anon key is safe to hardcode (public read-only access). The service key bypasses RLS and is used only for writes in `user_profiles.py`.

## Data

Download [MovieLens ml-latest](https://grouplens.org/datasets/movielens/latest/) and extract to `data/ml-latest/`. The directory should contain `ratings.csv`, `movies.csv`, `links.csv`, `tags.csv`.

## Frontend

```bash
cd frontend
npm install
```

Create `frontend/.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Supabase schema

The app requires three tables:

- `user_embeddings` — 19-dim genre vectors for each MovieLens user, with pgvector HNSW index
- `recommendations` — precomputed top-20 hybrid recs per ALS-trained user
- `feedback` — optional thumbs-up/down feedback from visitors

And a server-side RPC `find_twin` that searches `user_embeddings` by cosine similarity and returns a `has_recs` boolean indicating whether that user has precomputed recommendations.
