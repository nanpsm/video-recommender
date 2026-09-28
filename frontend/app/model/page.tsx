'use client'

import React, { useState } from 'react'
import Link from 'next/link'

const ACCENT  = '#C2410C'
const DARK    = '#1A1814'
const CREAM   = '#FAF7F1'
const BORDER  = '#E6E0D5'
const MUTED   = '#8A8278'
const FAINT   = '#B9B1A3'

// Evaluation results from: uv run python -m video_recommender.evaluate
// MovieLens ml-latest-small · 80/20 split · K=10 · liked_threshold=4.0
const BASELINES = [
  { name: 'Random',           precision: 0.0019, recall: 0.0023, ndcg: 0.0028, hitRate: 0.0186, n: 592, note: 'Chance baseline' },
  { name: 'Popularity',       precision: 0.1231, recall: 0.0994, ndcg: 0.1622, hitRate: 0.5591, n: 592, note: 'Most-rated films', bestPrecision: true },
  { name: 'Genre similarity', precision: 0.0157, recall: 0.0151, ndcg: 0.0149, hitRate: 0.1351, n: 592, note: 'FilmTwin v1 approach' },
  { name: 'ALS only',         precision: 0.0225, recall: 0.0182, ndcg: 0.0207, hitRate: 0.1824, n: 592, note: 'Collaborative filtering' },
  { name: 'Hybrid',           precision: 0.0216, recall: 0.0160, ndcg: 0.0237, hitRate: 0.1639, n: 592, note: 'ALS × 0.6 + genre × 0.4 · deployed', bestNdcg: true },
]

const METRICS = [
  { key: 'precision' as const, label: 'Precision@10', desc: 'Fraction of top-10 recs the user actually liked' },
  { key: 'recall'    as const, label: 'Recall@10',    desc: 'Fraction of liked test films that appeared in top-10' },
  { key: 'ndcg'     as const, label: 'NDCG@10',      desc: 'Ranking quality — hits ranked higher count more' },
  { key: 'hitRate'  as const, label: 'Hit Rate@10',  desc: 'Did at least one rec land in the user\'s liked set?' },
]

const MODEL_CARDS = [
  {
    tag: 'Dataset', title: 'MovieLens ml-latest-small',
    body: '100,836 ratings from 610 users across 9,742 films. Collected by the GroupLens research lab at the University of Minnesota. Each rating is 0.5 – 5.0. 80% used for training, 20% held out for evaluation.',
    badges: ['610 users', '9,742 films', '80/20 split'],
  },
  {
    tag: 'Model', title: 'Apache Spark ALS',
    body: 'Alternating Least Squares matrix factorisation. Latent factors capture shared taste patterns that genre labels miss. Trained with rank=20, regParam=0.1, maxIter=10. RMSE ≈ 0.83 on the held-out test set.',
    badges: ['rank=20', 'regParam=0.1', 'RMSE 0.83'],
  },
  {
    tag: 'Hybrid', title: 'ALS + Genre scoring',
    body: 'ALS predictions are normalised to [0, 1] per user, then blended with a genre-match score (avg. user genre-vec weight across a film\'s genres). Hybrid = 0.6 × ALS_norm + 0.4 × genre_score. Improves NDCG by +14.5% over ALS alone.',
    badges: ['0.6 × ALS', '0.4 × genre', '+14.5% NDCG'],
  },
  {
    tag: 'Matching', title: 'Top-5 neighbourhood blending',
    body: 'A unit-normalised genre preference vector is stored per user in Supabase. The browser fetches all 9,295 rows and runs cosine similarity in-memory. The top-5 nearest neighbours blend their recommendations: score(film) = Σ sim(neighbour) × (1/rank). Threshold: cosine sim ≥ 0.1.',
    badges: ['Top-5 blend', 'Cosine sim', '9,295 rows'],
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
  const [activeMetric, setActiveMetric] = useState<typeof METRICS[number]['key']>('ndcg')
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
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: ACCENT, letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 8 }}>Offline evaluation · MovieLens ml-latest-small</div>
          <div style={{ fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900, fontSize: 'clamp(40px, 6vw, 72px)', color: DARK, textTransform: 'uppercase', lineHeight: 0.9, letterSpacing: '-0.02em' }}>
            MODEL<br />
            <span style={{ color: ACCENT }}>METRICS</span>
          </div>
          <p style={{ marginTop: 16, fontSize: 15, color: MUTED, maxWidth: 600, lineHeight: 1.65 }}>
            Five recommendation baselines evaluated on a held-out 20% test set. Only users with at least one liked test film are included — 592 of 610 users. Liked threshold: rating ≥ 4.0.
          </p>
          <div style={{ marginTop: 16, padding: '12px 16px', background: 'rgba(194,65,12,0.06)', border: `1px solid rgba(194,65,12,0.18)`, borderRadius: 10, maxWidth: 600 }}>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: ACCENT, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Note</span>
            <p style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 13, color: MUTED, marginTop: 6, lineHeight: 1.6 }}>
              Popularity wins on Precision, Recall, and Hit Rate — a common result because popular films appear in many users&apos; test sets. <strong style={{ color: DARK }}>NDCG is the most meaningful metric here</strong>: it rewards ranking the right films higher, not just including them. The Hybrid model leads on NDCG (0.0237 vs 0.0207 for ALS alone, +14.5%).
            </p>
          </div>
        </div>

        {/* Metric selector */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 32, flexWrap: 'wrap' }}>
          {METRICS.map(m => (
            <button
              key={m.key}
              onClick={() => setActiveMetric(m.key)}
              style={{
                fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase',
                padding: '7px 16px', borderRadius: 8, border: `1px solid ${activeMetric === m.key ? ACCENT : BORDER}`,
                background: activeMetric === m.key ? ACCENT : '#fff',
                color: activeMetric === m.key ? '#fff' : MUTED,
                cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Metric description */}
        <div style={{ marginBottom: 24, padding: '12px 16px', background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 10 }}>
          <span style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 13, color: MUTED }}>{meta.desc}</span>
        </div>

        {/* Bar chart comparison */}
        <div style={{ background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 16, overflow: 'hidden', marginBottom: 40 }}>
          <div style={{ height: 3, background: ACCENT }} />
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
                  {b.bestPrecision && <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, color: ACCENT, background: 'rgba(194,65,12,0.1)', border: `1px solid rgba(194,65,12,0.2)`, borderRadius: 4, padding: '1px 6px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Best recall</span>}
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
                        {b.bestPrecision && <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, color: ACCENT, background: 'rgba(194,65,12,0.1)', borderRadius: 4, padding: '1px 6px', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Best recall</span>}
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

        {/* Footer note */}
        <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: FAINT }}>Liked threshold: rating ≥ 4.0 · K=10 · seed=42 · evaluated on 592 users</span>
          <a href="https://grouplens.org/datasets/movielens/" target="_blank" rel="noreferrer" style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: FAINT, textDecoration: 'none' }}>grouplens.org ↗</a>
        </div>
      </div>
    </div>
  )
}
