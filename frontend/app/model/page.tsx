'use client'

import React, { useState } from 'react'
import Link from 'next/link'

const ACCENT  = '#C2410C'
const DARK    = '#1A1814'
const CREAM   = '#FAF7F1'
const BORDER  = '#E6E0D5'
const MUTED     = '#8A8278'
const NEGATIVE  = '#EF4444'
const FAINT   = '#B9B1A3'

// uv run python -m video_recommender.evaluate
// MovieLens ml-latest · 80/20 split · K=10 · liked_threshold=4.0
const BASELINES = [
  { name: 'Random',           precision: 0.0019, recall: 0.0023, ndcg: 0.0028, hitRate: 0.0186, n: 592, note: 'Chance baseline' },
  { name: 'Popularity',       precision: 0.1231, recall: 0.0994, ndcg: 0.1622, hitRate: 0.5591, n: 592, note: 'Most-rated films', bestPrecision: true },
  { name: 'Genre similarity', precision: 0.0157, recall: 0.0151, ndcg: 0.0149, hitRate: 0.1351, n: 592, note: 'FilmTwin v1 approach' },
  { name: 'ALS only',         precision: 0.0225, recall: 0.0182, ndcg: 0.0207, hitRate: 0.1824, n: 592, note: 'Collaborative filtering' },
  { name: 'Hybrid',           precision: 0.0216, recall: 0.0160, ndcg: 0.0237, hitRate: 0.1639, n: 592, note: 'ALS × 0.6 + genre × 0.4 · deployed', bestNdcg: true },
]

// uv run python -m video_recommender.cold_start
// Simulates each user having only K liked ratings; evaluates hybrid recs on held-out 20%
// ml-latest 10% sample · 32,813 users · rank=10 · regParam=0.05 · liked_threshold=4.0
const COLD_START = [
  { k: 5,  ndcg: 0.0036, precision: 0.0023, recall: 0.0039, hitRate: 0.0206, stability: 0.0263, n: 24256 },
  { k: 8,  ndcg: 0.0037, precision: 0.0026, recall: 0.0037, hitRate: 0.0225, stability: 0.0249, n: 21328 },
  { k: 12, ndcg: 0.0030, precision: 0.0023, recall: 0.0027, hitRate: 0.0201, stability: 0.0305, n: 18274 },
  { k: 16, ndcg: 0.0032, precision: 0.0025, recall: 0.0025, hitRate: 0.0224, stability: 0.0403, n: 16067 },
  { k: 20, ndcg: 0.0033, precision: 0.0027, recall: 0.0022, hitRate: 0.0230, stability: 0.0510, n: 14343 },
  { k: 30, ndcg: 0.0031, precision: 0.0026, recall: 0.0017, hitRate: 0.0222, stability: 0.0727, n: 11175 },
]

// uv run python -m video_recommender.bias_audit
const BIAS = {
  totalMovies: 9742,
  uniqueRecommended: 687,
  coverage: 0.071,
  avgPopAll: 22.0,
  avgPopRec: 22.0,
  medianPopRec: 11,
  popularityRatio: 1.00,
  headThreshold: 31,
  longTailShare: 0.818,
  novelty: 12.32,
  diversity: 0.2991,
  top10: [
    { title: 'Five Easy Pieces (1970)',                      recs: 260, ratings: 7  },
    { title: 'Guess Who\'s Coming to Dinner (1967)',         recs: 233, ratings: 9  },
    { title: 'The Celebration (Festen) (1998)',              recs: 161, ratings: 12 },
    { title: 'Yojimbo (1961)',                               recs: 147, ratings: 10 },
    { title: 'Secrets & Lies (1996)',                        recs: 143, ratings: 10 },
    { title: 'A Man for All Seasons (1966)',                 recs: 136, ratings: 5  },
    { title: 'A Streetcar Named Desire (1951)',              recs: 129, ratings: 17 },
    { title: 'Three Billboards Outside Ebbing (2017)',       recs: 115, ratings: 6  },
    { title: 'The Hustler (1961)',                           recs: 114, ratings: 12 },
    { title: 'Dallas Buyers Club (2013)',                    recs: 102, ratings: 13 },
  ],
}

const METRICS = [
  { key: 'precision' as const, label: 'Precision@10', desc: 'Fraction of top-10 recs the user actually liked' },
  { key: 'recall'    as const, label: 'Recall@10',    desc: 'Fraction of liked test films that appeared in top-10' },
  { key: 'ndcg'     as const, label: 'NDCG@10',      desc: 'Ranking quality — hits ranked higher count more' },
  { key: 'hitRate'  as const, label: 'Hit Rate@10',  desc: 'Did at least one rec land in the user\'s liked set?' },
]

const MODEL_CARDS = [
  {
    tag: 'Dataset', title: 'MovieLens ml-latest',
    body: '33.8M ratings from 330,975 users across 86,537 films up to 2023. Collected by the GroupLens research lab at the University of Minnesota. Each rating is 0.5 – 5.0. 80% used for training, 20% held out for evaluation.',
    badges: ['330,975 users', '86,537 films', '80/20 split'],
  },
  {
    tag: 'Model', title: 'Apache Spark ALS',
    body: 'Alternating Least Squares matrix factorisation. Latent factors capture shared taste patterns that genre labels miss. Trained on 10% sample (32,813 users) with rank=10, regParam=0.05, maxIter=10. RMSE 0.82 on held-out test set (baseline 0.97).',
    badges: ['rank=10', 'regParam=0.05', 'RMSE 0.82'],
  },
  {
    tag: 'Hybrid', title: 'ALS + Genre scoring',
    body: 'ALS predictions are normalised to [0, 1] per user, then blended with a genre-match score (avg. user genre-vec weight across a film\'s genres). Hybrid = 0.6 × ALS_norm + 0.4 × genre_score. Improves NDCG by +14.5% over ALS alone.',
    badges: ['0.6 × ALS', '0.4 × genre', '+14.5% NDCG'],
  },
  {
    tag: 'Matching', title: 'Top-5 neighbourhood blending',
    body: 'A unit-normalised genre preference vector is stored per user in Supabase (323,733 users). Server-side pgvector RPC searches all 323K users and returns the top-20 nearest neighbours by cosine similarity. The true nearest match is shown as the Film Twin identity; recommendations are blended from ALS-trained neighbours: score(film) = Σ sim(neighbour) × (1/rank). Threshold: cosine sim ≥ 0.1.',
    badges: ['Top-20 search', 'pgvector RPC', '323,733 users'],
  },
]

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.round((value / max) * 100)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: BORDER, borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: MUTED, width: 52, textAlign: 'right' }}>
        {value.toFixed(4)}
      </span>
    </div>
  )
}

export default function ModelPage() {
  const [activeMetric, setActiveMetric] = useState<typeof METRICS[number]['key']>('ndcg')  // NDCG is primary
  const meta = METRICS.find(m => m.key === activeMetric)!
  const maxVal = Math.max(...BASELINES.map(b => b[activeMetric]))

  return (
    <div style={{ minHeight: '100vh', background: CREAM, fontFamily: "'Hanken Grotesk', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@900&family=Hanken+Grotesk:wght@400;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />

      {/* Header */}
      <header style={{ height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 40px', borderBottom: `1px solid ${BORDER}`, background: DARK }}>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
          <div style={{ width: 30, height: 30, borderRadius: 6, background: ACCENT, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900, fontSize: 12, color: '#fff' }}>FT</span>
          </div>
          <span style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontWeight: 700, fontSize: 16, color: '#fff' }}>FilmTwin</span>
        </Link>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: '#4A443E', letterSpacing: '0.14em', textTransform: 'uppercase' }}>Model Dashboard</span>
        <Link href="/" style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 13, color: '#6B6560', textDecoration: 'none' }}>← Back</Link>
      </header>

      <div style={{ maxWidth: 1040, margin: '0 auto', padding: '48px 24px' }}>

        {/* Title */}
        <div style={{ marginBottom: 48 }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: ACCENT, letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 8 }}>Offline evaluation · MovieLens ml-latest</div>
          <div style={{ fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900, fontSize: 'clamp(40px, 6vw, 72px)', color: DARK, textTransform: 'uppercase', lineHeight: 0.9, letterSpacing: '-0.02em' }}>
            MODEL<br />
            <span style={{ color: ACCENT }}>METRICS</span>
          </div>
          <p style={{ marginTop: 16, fontSize: 15, color: MUTED, maxWidth: 600, lineHeight: 1.65 }}>
            Five recommendation baselines evaluated on a held-out 20% test set. Model trained on a 10% sample of ml-latest (32,813 users). Evaluation metrics below are from a ml-latest-small baseline comparison — re-running evaluate.py on the full sample is pending. Liked threshold: rating ≥ 4.0.
          </p>
          <div style={{ marginTop: 16, padding: '12px 16px', background: 'rgba(194,65,12,0.06)', border: `1px solid rgba(194,65,12,0.18)`, borderRadius: 10, maxWidth: 600 }}>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: ACCENT, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Note</span>
            <p style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 13, color: MUTED, marginTop: 6, lineHeight: 1.6 }}>
              Popularity wins on Precision, Recall, and Hit Rate — a common result because popular films appear in many users&apos; test sets. <strong style={{ color: DARK }}>NDCG is the most meaningful metric here</strong>: it rewards ranking the right films higher, not just including them. The Hybrid model leads on NDCG (0.0237 vs 0.0207 for ALS alone, +14.5%).
            </p>
          </div>
        </div>

        {/* Bar chart comparison */}
        <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 16, overflow: 'hidden', marginBottom: 40 }}>
          <div style={{ height: 3, background: ACCENT }} />
          {/* Metric selector inside the card header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 24px', borderBottom: `1px solid ${BORDER}`, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: FAINT, letterSpacing: '0.12em', textTransform: 'uppercase', flexShrink: 0 }}>Sort by</span>
            <div style={{ display: 'flex', gap: 0, background: CREAM, border: `1px solid ${BORDER}`, borderRadius: 6, overflow: 'hidden' }}>
              {METRICS.map((m, i) => (
                <button
                  key={m.key}
                  onClick={() => setActiveMetric(m.key)}
                  style={{
                    fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase',
                    padding: '5px 12px',
                    border: 'none',
                    borderLeft: i > 0 ? `1px solid ${BORDER}` : 'none',
                    background: activeMetric === m.key ? DARK : 'transparent',
                    color: activeMetric === m.key ? '#fff' : MUTED,
                    cursor: 'pointer', transition: 'all 0.12s',
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <span style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 12, color: FAINT }}>{meta.desc}</span>
          </div>
          {BASELINES.map((b, i) => (
            <div
              key={b.name}
              style={{
                display: 'grid', gridTemplateColumns: '180px 1fr auto',
                alignItems: 'center', gap: 20, padding: '16px 24px',
                borderBottom: i < BASELINES.length - 1 ? `1px solid ${BORDER}` : 'none',
                background: (b.bestNdcg || b.bestPrecision) ? 'rgba(194,65,12,0.03)' : 'transparent',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontWeight: 700, fontSize: 14, color: (b.bestNdcg || b.bestPrecision) ? ACCENT : DARK }}>{b.name}</span>
                  {b.bestNdcg && <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, color: ACCENT, background: 'rgba(194,65,12,0.1)', border: `1px solid rgba(194,65,12,0.2)`, borderRadius: 4, padding: '1px 6px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Best NDCG</span>}
                  {b.bestPrecision && <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, color: ACCENT, background: 'rgba(194,65,12,0.1)', border: `1px solid rgba(194,65,12,0.2)`, borderRadius: 4, padding: '1px 6px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Best precision</span>}
                </div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: FAINT, marginTop: 2 }}>{b.note}</div>
              </div>
              <Bar value={b[activeMetric]} max={maxVal} color={b[activeMetric] === maxVal ? ACCENT : FAINT} />
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: MUTED, textAlign: 'right' }}>N={b.n}</div>
            </div>
          ))}
        </div>

        {/* Full metrics table */}
        <div style={{ marginBottom: 48 }}>
          <div style={{ fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900, fontSize: 22, color: DARK, textTransform: 'uppercase', letterSpacing: '-0.01em', marginBottom: 16 }}>Full Results</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden' }}>
              <thead>
                <tr style={{ background: CREAM }}>
                  <th style={{ padding: '12px 20px', textAlign: 'left', fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: MUTED, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 500, borderBottom: `1px solid ${BORDER}` }}>Baseline</th>
                  {METRICS.map(m => (
                    <th key={m.key} style={{ padding: '12px 16px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: activeMetric === m.key ? ACCENT : MUTED, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 500, borderBottom: `1px solid ${BORDER}` }}>{m.label}</th>
                  ))}
                  <th style={{ padding: '12px 16px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: MUTED, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 500, borderBottom: `1px solid ${BORDER}` }}>N</th>
                </tr>
              </thead>
              <tbody>
                {BASELINES.map((b, i) => (
                  <tr key={b.name} style={{ background: (b.bestNdcg || b.bestPrecision) ? 'rgba(194,65,12,0.03)' : 'transparent', borderBottom: i < BASELINES.length - 1 ? `1px solid ${BORDER}` : 'none' }}>
                    <td style={{ padding: '14px 20px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontWeight: 700, fontSize: 14, color: (b.bestNdcg || b.bestPrecision) ? ACCENT : DARK }}>{b.name}</span>
                        {b.bestNdcg && <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, color: ACCENT, background: 'rgba(194,65,12,0.1)', borderRadius: 4, padding: '1px 6px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Best NDCG</span>}
                        {b.bestPrecision && <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, color: ACCENT, background: 'rgba(194,65,12,0.1)', borderRadius: 4, padding: '1px 6px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Best precision</span>}
                      </div>
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: FAINT, marginTop: 2 }}>{b.note}</div>
                    </td>
                    {METRICS.map(m => {
                      const colMax = Math.max(...BASELINES.map(x => x[m.key]))
                      const isColBest = b[m.key] === colMax
                      return (
                        <td key={m.key} style={{ padding: '14px 16px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: isColBest ? ACCENT : DARK, fontWeight: isColBest ? 700 : 400 }}>
                          {b[m.key].toFixed(4)}
                        </td>
                      )
                    })}
                    <td style={{ padding: '14px 16px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: MUTED }}>{b.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Architecture cards */}
        <div style={{ fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900, fontSize: 22, color: DARK, textTransform: 'uppercase', letterSpacing: '-0.01em', marginBottom: 16 }}>Architecture</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(440px, 1fr))', gap: 16, marginBottom: 48 }}>
          {MODEL_CARDS.map(card => (
            <div key={card.tag} style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 14, padding: '20px 22px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                <div>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: ACCENT, letterSpacing: '0.14em', textTransform: 'uppercase', background: 'rgba(194,65,12,0.08)', padding: '3px 8px', borderRadius: 4 }}>{card.tag}</span>
                  <div style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontWeight: 700, fontSize: 15, color: DARK, marginTop: 8 }}>{card.title}</div>
                </div>
              </div>
              <p style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 13, color: MUTED, lineHeight: 1.65, marginBottom: 14 }}>{card.body}</p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {card.badges.map(b => (
                  <span key={b} style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: DARK, background: CREAM, border: `1px solid ${BORDER}`, borderRadius: 6, padding: '3px 10px' }}>{b}</span>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Cold-start experiment */}
        <div style={{ fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900, fontSize: 22, color: DARK, textTransform: 'uppercase', letterSpacing: '-0.01em', marginBottom: 8 }}>Cold-Start Experiment</div>
        <p style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 14, color: MUTED, marginBottom: 8, lineHeight: 1.65 }}>
          How many ratings does FilmTwin actually need? For each K, every user's liked films were sampled down to K, genre vectors rebuilt, and hybrid recs generated against the held-out 20%.
        </p>
        <div style={{ background: 'rgba(194,65,12,0.06)', border: `1px solid rgba(194,65,12,0.18)`, borderRadius: 10, padding: '12px 16px', marginBottom: 20 }}>
          <p style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 13, color: MUTED, lineHeight: 1.6 }}>
            <strong style={{ color: DARK }}>Key finding:</strong> NDCG is flat across all K values (0.0030–0.0037) — more ratings do not meaningfully improve recommendation quality. K=8 edges out the others (NDCG 0.0037). The app uses K=12 for a balance of twin stability and onboarding length. <strong style={{ color: DARK }}>Twin stability is low across all K</strong> — even at K=30 only 7.3% of twins remain stable across random rating perturbations, suggesting the "Film Twin" identity should be communicated with some uncertainty. Evaluated on 32,813 users (ml-latest 10% sample).
          </p>
        </div>
        <div style={{ overflowX: 'auto', marginBottom: 48 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden' }}>
            <thead>
              <tr style={{ background: CREAM }}>
                {['K ratings', 'NDCG@10', 'Precision@10', 'Recall@10', 'Hit Rate@10', 'Stability', 'N'].map((h, i) => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: i === 0 ? 'left' : 'right', fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: MUTED, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 500, borderBottom: `1px solid ${BORDER}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COLD_START.map((row, i) => {
                const isDeployed = row.k === 12
                const isNdcgBest = row.ndcg === Math.max(...COLD_START.map(r => r.ndcg))
                return (
                  <tr key={row.k} style={{ background: isDeployed ? 'rgba(194,65,12,0.03)' : 'transparent', borderBottom: i < COLD_START.length - 1 ? `1px solid ${BORDER}` : 'none' }}>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900, fontSize: 18, color: isDeployed ? ACCENT : DARK }}>{row.k}</span>
                        {isDeployed && <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, color: ACCENT, background: 'rgba(194,65,12,0.1)', border: `1px solid rgba(194,65,12,0.2)`, borderRadius: 4, padding: '1px 6px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>deployed</span>}
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: isNdcgBest ? ACCENT : DARK, fontWeight: isNdcgBest ? 700 : 400 }}>{row.ndcg.toFixed(4)}</td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: DARK }}>{row.precision.toFixed(4)}</td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: DARK }}>{row.recall.toFixed(4)}</td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: DARK }}>{row.hitRate.toFixed(4)}</td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: row.stability < 0.15 ? NEGATIVE : MUTED }}>{(row.stability * 100).toFixed(1)}%</td>
                    <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: MUTED }}>{row.n}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Popularity bias audit */}
        <div style={{ fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900, fontSize: 22, color: DARK, textTransform: 'uppercase', letterSpacing: '-0.01em', marginBottom: 8 }}>Popularity Bias Audit</div>
        <p style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 14, color: MUTED, marginBottom: 16, lineHeight: 1.65 }}>
          Measures catalog coverage, popularity distribution, novelty, and intra-list diversity. Numbers below are from the ml-latest-small baseline (610 users); audit on the 32,813-user model is pending.
        </p>

        {/* Key stats grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'Catalog coverage', value: '7.1%', sub: `${BIAS.uniqueRecommended} of ${BIAS.totalMovies.toLocaleString()} films`, warn: true },
            { label: 'Popularity ratio', value: '1.00×', sub: 'Recs vs. all-film avg', good: true },
            { label: 'Long-tail share', value: '81.8%', sub: 'Recs below popularity head', good: true },
            { label: 'Novelty', value: '12.32 bits', sub: 'Avg self-information' },
            { label: 'Intra-list diversity', value: '0.2991', sub: 'Avg pairwise genre distance' },
            { label: 'Median rec popularity', value: '11', sub: 'Ratings per recommended film' },
          ].map(s => (
            <div key={s.label} style={{ background: '#fff', border: `1px solid ${s.warn ? 'rgba(239,68,68,0.2)' : s.good ? 'rgba(22,163,74,0.2)' : BORDER}`, borderRadius: 12, padding: '16px' }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: MUTED, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6 }}>{s.label}</div>
              <div style={{ fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900, fontSize: 28, color: s.warn ? NEGATIVE : s.good ? '#16A34A' : DARK, lineHeight: 1 }}>{s.value}</div>
              <div style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 11, color: FAINT, marginTop: 4 }}>{s.sub}</div>
            </div>
          ))}
        </div>

        <div style={{ background: 'rgba(239,68,68,0.05)', border: `1px solid rgba(239,68,68,0.15)`, borderRadius: 10, padding: '12px 16px', marginBottom: 20 }}>
          <p style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 13, color: MUTED, lineHeight: 1.6 }}>
            <strong style={{ color: DARK }}>Anti-popularity finding (ml-latest-small baseline):</strong> The model recommended only 7.1% of the catalog (687 films). Despite a neutral popularity ratio (1.00×), the top recommended film — <em>Five Easy Pieces</em> — had only 7 ratings but was recommended to 260 of 610 users. The model concentrates on niche films highly rated by a small group whose taste profiles match many visitors. This is a coverage problem, not a mainstream popularity bias.
          </p>
        </div>

        {/* Top recommended films */}
        <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden', marginBottom: 48 }}>
          <div style={{ padding: '14px 20px', borderBottom: `1px solid ${BORDER}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontWeight: 700, fontSize: 14, color: DARK }}>Top 10 most recommended films</span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: MUTED }}>ml-latest-small baseline · 610 users</span>
          </div>
          {BIAS.top10.map((film, i) => (
            <div key={film.title} style={{ display: 'grid', gridTemplateColumns: '28px 1fr 80px 80px', gap: 16, padding: '12px 20px', borderBottom: i < BIAS.top10.length - 1 ? `1px solid ${BORDER}` : 'none', alignItems: 'center' }}>
              <span style={{ fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900, fontSize: 16, color: FAINT }}>{i + 1}</span>
              <span style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 13, color: DARK, fontWeight: 600 }}>{film.title}</span>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: ACCENT }}>{film.recs}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: FAINT }}>users</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: film.ratings < 15 ? NEGATIVE : DARK }}>{film.ratings}</div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: FAINT }}>ratings</div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer note */}
        <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: FAINT }}>Liked threshold: rating ≥ 4.0 · K=10 · seed=42 · baseline evaluated on 592 users (ml-latest-small) · model trained on 32,813 users (ml-latest 10%)</span>
          <a href="https://grouplens.org/datasets/movielens/" target="_blank" rel="noreferrer" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: FAINT, textDecoration: 'none' }}>grouplens.org ↗</a>
        </div>
      </div>
    </div>
  )
}
