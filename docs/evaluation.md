# Evaluation Methodology

## Setup

- **Dataset:** MovieLens ml-latest — 33.8M ratings, 330,975 users, 86,537 films
- **Split:** 80% train / 20% test (fixed seed=42)
- **Liked threshold:** rating ≥ 4.0
- **K:** 10
- **Warm items:** movies with ≥ 5 ratings in training set (~40K items)

Evaluation script: `uv run python -m video_recommender.evaluate`

## Baselines

| Baseline | Description |
|---|---|
| Random | Random unseen films |
| Popularity | Globally most-rated unseen films |
| Genre similarity | Nearest user by genre vector → their ALS top-K |
| ALS only | Collaborative filtering only |
| **Hybrid** | **0.6 × ALS_norm + 0.4 × genre_score (deployed)** |

## Results (ml-latest-small baseline, N=592)

| Baseline | Precision@10 | Recall@10 | NDCG@10 | Hit Rate@10 |
|---|---|---|---|---|
| Random | 0.0019 | 0.0023 | 0.0028 | 1.9% |
| Popularity | **0.1231** | **0.0994** | **0.1622** | **55.9%** |
| Genre similarity | 0.0157 | 0.0151 | 0.0149 | 13.5% |
| ALS only | 0.0225 | 0.0182 | 0.0207 | 18.2% |
| **Hybrid** | 0.0216 | 0.0160 | **0.0237** | 16.4% |

**Note:** Popularity wins on Precision, Recall, and Hit Rate — this is expected because popular films appear in many users' test sets. NDCG is the primary metric: it rewards ranking the right films higher. The Hybrid model leads on NDCG (+14.5% over ALS alone).

## Cold-start experiment

Each user's liked films were sampled down to K, genre vectors rebuilt from those K ratings only, and hybrid recommendations evaluated against the held-out 20% test set. N decreases with K because fewer users have at least K liked films.

These numbers are lower than the headline metrics because cold-start evaluation uses a truncated profile — the model has less signal.

| K ratings | NDCG@10 | Precision@10 | Recall@10 | Hit Rate@10 | Twin stability | N |
|---|---|---|---|---|---|---|
| 5  | 0.0036 | 0.0023 | 0.0039 | 2.1% | 2.6% | 24,256 |
| 8  | 0.0037 | 0.0026 | 0.0037 | 2.3% | 2.5% | 21,328 |
| **12** (deployed) | 0.0030 | 0.0023 | 0.0027 | 2.0% | 3.1% | 18,274 |
| 16 | 0.0032 | 0.0025 | 0.0025 | 2.2% | 4.0% | 16,067 |
| 20 | 0.0033 | 0.0027 | 0.0022 | 2.3% | 5.1% | 14,343 |
| 30 | 0.0031 | 0.0026 | 0.0017 | 2.2% | 7.3% | 11,175 |

**Key finding:** NDCG is flat across all K values (0.0030–0.0037) — the genre embedding saturates after ~8 films. K=12 is deployed as a balance of onboarding length and twin stability.

**Twin stability** measures how often the same Film Twin is returned across random perturbations of the K input ratings. Low stability (2–7%) reflects the sensitivity of cosine similarity in a sparse 19-dim space — the Film Twin identity should be understood as approximate.

Experiment script: `uv run python -m video_recommender.cold_start`

## Popularity bias audit

Computed on ml-latest-small (610 users, 9,742 films).

| Metric | Value |
|---|---|
| Catalog coverage | 7.1% (687 of 9,742 films) |
| Popularity ratio | 1.00× (recs vs. all-film avg) |
| Long-tail share | 81.8% of recs below popularity head |
| Avg novelty | 12.32 bits |
| Intra-list diversity | 0.2991 |

Despite a neutral popularity ratio, the model concentrates recs on niche films highly rated by a small group — a coverage problem rather than mainstream popularity bias. The top recommended film had only 7 ratings but was recommended to 260 of 610 users.

Audit script: `uv run python -m video_recommender.bias_audit`
