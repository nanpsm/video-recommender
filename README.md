# FilmTwin

**Find your film twin — personalised movie recommendations powered by Apache Spark ALS.**

🎬 **Live demo:** [filmtwin.vercel.app](https://filmtwin.vercel.app)

---

## What it does

FilmTwin asks you to rate 12 randomly-selected films (like / skip / dislike). It builds a genre preference vector from your ratings, finds your closest match among 323,733 real MovieLens viewers using cosine similarity, and surfaces the films *that person loved* that you haven't seen yet.

No account required. No tracking.

---

## How it works

```
User rates 12 films
        ↓
Build genre preference vector (19-dim, unit-normalised)
        ↓
pgvector RPC searches all 323,733 viewer embeddings (HNSW index)
        ↓
Display true nearest match as Film Twin identity
        ↓
Blend recs from top-20 ALS-trained neighbours (similarity-weighted)
```

### The data

- **Dataset:** [MovieLens ml-latest](https://grouplens.org/datasets/movielens/) — 33.8M ratings, 330,975 users, 86,537 films up to 2023
- **Collaborative filtering:** Apache Spark ALS trained on 10% sample (32,813 users), rank=10, regParam=0.05, RMSE 0.82
- **Hybrid scoring:** 0.6 × ALS normalised + 0.4 × genre score
- **User matching:** pgvector HNSW cosine similarity on 19-dim genre embeddings (323,733 users stored in Supabase)
- **Viewer profiles & feedback:** [Supabase](https://supabase.com/) (Postgres + pgvector)

---

## Tech stack

| Layer | Technology |
|---|---|
| Recommendation engine | Apache Spark ALS (PySpark) |
| Vector similarity search | Supabase pgvector (HNSW index) |
| User profile storage | Supabase (Postgres + RLS) |
| Frontend | Next.js (App Router) |
| Deployment | Vercel |
| Fonts | Big Shoulders Display, Hanken Grotesk, JetBrains Mono |

---

## Project structure

```
video-recommender/
├── src/video_recommender/
│   ├── train_als.py         # Train Spark ALS model, save factor matrices
│   ├── evaluate.py          # Offline evaluation (Precision, Recall, NDCG, Hit Rate)
│   ├── cold_start.py        # Cold-start experiment across K=[5,8,12,16,20,30]
│   ├── user_profiles.py     # Compute & upload genre embeddings to Supabase
│   └── bias_audit.py        # Popularity bias, catalog coverage, novelty, diversity
├── frontend/
│   ├── app/
│   │   ├── page.tsx         # Main app (rating flow → matching → results)
│   │   ├── model/page.tsx   # Model dashboard (metrics, architecture, cold-start)
│   │   └── layout.tsx
│   └── .env.local           # Supabase keys (gitignored)
├── models/als/              # Saved ALS factor matrices (Parquet, gitignored)
├── data/ml-latest/          # MovieLens ml-latest (gitignored)
└── pyproject.toml
```

---

## Running locally

### Python pipeline

```bash
# Install dependencies (requires Python 3.11+, Java 11+)
uv sync

# Train ALS model (saves factor matrices to models/als/)
uv run python -m video_recommender.train_als

# Compute user genre embeddings and upload to Supabase
export SUPABASE_SERVICE_KEY='your-service-role-key'
uv run python -m video_recommender.user_profiles

# Offline evaluation
uv run python -m video_recommender.evaluate

# Cold-start experiment
uv run python -m video_recommender.cold_start
```

> **Note:** `SUPABASE_SERVICE_KEY` must be set as an environment variable — never commit it. The anon key is safe to hardcode (public read-only access). The service key bypasses RLS and is used only for writes in this script.

### Frontend

```bash
cd frontend
npm install

# Create .env.local with:
# NEXT_PUBLIC_SUPABASE_URL=...
# NEXT_PUBLIC_SUPABASE_ANON_KEY=...

npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Model dashboard

The live app includes a **[/model](https://filmtwin.vercel.app/model)** page with full offline evaluation results:

- **Baseline comparison** — Random, Popularity, Genre similarity, ALS-only, Hybrid across Precision@10, Recall@10, NDCG@10, Hit Rate@10
- **Cold-start experiment** — recommendation quality and twin stability across K=[5,8,12,16,20,30] ratings
- **Architecture cards** — dataset, ALS model, hybrid scoring, pgvector matching
- **Popularity bias audit** — catalog coverage, long-tail share, novelty, intra-list diversity (ml-latest-small baseline)

---

## Model performance

| Metric | Value |
|---|---|
| Algorithm | ALS (Alternating Least Squares) |
| Rank | 10 |
| Regularisation | 0.05 |
| RMSE | 0.82 (baseline 0.97) |
| Training users | 32,813 (10% sample of ml-latest) |
| Training set | 80 / 20 split |
| Hybrid NDCG@10 | 0.0237 (+14.5% over ALS alone) |
| Hit Rate@10 | 16.4% |

### Cold-start (K ratings → quality)

| K ratings | NDCG@10 | Hit Rate@10 | Twin stability | N |
|---|---|---|---|---|
| 5  | 0.0036 | 2.1% | 2.6% | 24,256 |
| 8  | 0.0037 | 2.3% | 2.5% | 21,328 |
| **12** (deployed) | 0.0030 | 2.0% | 3.1% | 18,274 |
| 16 | 0.0032 | 2.2% | 4.0% | 16,067 |
| 20 | 0.0033 | 2.3% | 5.1% | 14,343 |
| 30 | 0.0031 | 2.2% | 7.3% | 11,175 |

NDCG is flat across all K — the genre embedding saturates after ~8 films. K=12 balances onboarding length and twin stability.

---

## Dataset

This project uses the [MovieLens ml-latest](https://grouplens.org/datasets/movielens/latest/) dataset:

> F. Maxwell Harper and Joseph A. Konstan. 2015. The MovieLens Datasets: History and Context. ACM Transactions on Interactive Intelligent Systems (TiiS) 5, 4: 1–19. https://doi.org/10.1145/2827872
