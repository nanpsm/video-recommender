'use client'

import { useState } from 'react'
import { supabase, Recommendation } from '@/lib/supabase'

// ── Constants ──────────────────────────────────────────────────────────────

const ACCENT   = '#C2410C'
const DARK     = '#1A1814'
const CREAM    = '#FAF7F1'
const BORDER   = '#E6E0D5'
const MUTED    = '#8A8278'
const FAINT    = '#B9B1A3'
const NEGATIVE = '#EF4444'

const GENRE_GRADIENT: Record<string, [string, string]> = {
  Drama:     ['#C9D5E6', '#A9BAD2'],
  Crime:     ['#D9CBB5', '#B9A68A'],
  Action:    ['#E6C4BC', '#CFA095'],
  Comedy:    ['#C6DCC4', '#A2C19F'],
  Adventure: ['#E6D2B3', '#CDB189'],
  Animation: ['#BFD8DF', '#98BCC6'],
  War:       ['#C8CEC4', '#A8B1A3'],
  Romance:   ['#E8D0D4', '#CBADB2'],
  Children:  ['#E2D4BC', '#C4B498'],
  Thriller:  ['#D8D0C8', '#B8AFA4'],
  'Sci-Fi':  ['#D5C8E3', '#B7A5CE'],
  Horror:    ['#E0CECE', '#C9AAAA'],
  Mystery:   ['#C8D5D9', '#A4B8BE'],
  Fantasy:   ['#D4C8E3', '#B8A5CE'],
}

const FILMS = [
  { id: 318,   title: 'The Shawshank Redemption', year: 1994, genres: ['Drama'] },
  { id: 296,   title: 'Pulp Fiction',              year: 1994, genres: ['Crime', 'Drama'] },
  { id: 2571,  title: 'The Matrix',                year: 1999, genres: ['Action', 'Sci-Fi'] },
  { id: 356,   title: 'Forrest Gump',              year: 1994, genres: ['Comedy', 'Drama'] },
  { id: 260,   title: 'Star Wars: A New Hope',     year: 1977, genres: ['Action', 'Adventure'] },
  { id: 593,   title: 'The Silence of the Lambs',  year: 1991, genres: ['Crime', 'Horror'] },
  { id: 4993,  title: 'The Lord of the Rings',     year: 2001, genres: ['Adventure', 'Drama'] },
  { id: 58559, title: 'The Dark Knight',           year: 2008, genres: ['Action', 'Crime'] },
  { id: 79132, title: 'Inception',                 year: 2010, genres: ['Action', 'Mystery'] },
  { id: 2959,  title: 'Fight Club',                year: 1999, genres: ['Drama', 'Thriller'] },
  { id: 1,     title: 'Toy Story',                 year: 1995, genres: ['Animation', 'Comedy'] },
  { id: 1721,  title: 'Jurassic Park',             year: 1993, genres: ['Adventure', 'Sci-Fi'] },
]

type Vote = 'like' | 'skip'
type Step = 'landing' | 'rate' | 'loading' | 'results'

// ── Helpers ────────────────────────────────────────────────────────────────

function posterStyle(genres: string[]): React.CSSProperties {
  const [light, dark] = GENRE_GRADIENT[genres[0]] ?? ['#D0CCC4', '#B0ACA4']
  return {
    background: `repeating-linear-gradient(0deg, rgba(26,24,20,0.03) 0 1px, transparent 1px 4px),
                 linear-gradient(160deg, ${light}, ${dark})`,
  }
}

function MiniPoster({ genres, style }: { genres: string[]; style?: React.CSSProperties }) {
  return (
    <div style={{
      width: 28, height: 40, borderRadius: 4, flexShrink: 0,
      ...posterStyle(genres), ...style
    }} />
  )
}

function GenreChips({ genres }: { genres: string[] }) {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {genres.map(g => {
        const [light] = GENRE_GRADIENT[g] ?? ['#E0D9D0', '#C0B9B0']
        return (
          <span key={g} style={{
            background: light, color: DARK, fontSize: 10, fontWeight: 700,
            fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.08em',
            padding: '2px 8px', borderRadius: 4, textTransform: 'uppercase',
          }}>{g}</span>
        )
      })}
    </div>
  )
}

function Eyebrow({ children, color = MUTED }: { children: React.ReactNode; color?: string }) {
  return (
    <p style={{
      fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 400,
      letterSpacing: '0.14em', textTransform: 'uppercase', color,
    }}>{children}</p>
  )
}

function cosineSim(a: Record<string, number>, b: Record<string, number>) {
  let dot = 0
  for (const [k, v] of Object.entries(b)) if (a[k]) dot += a[k] * v
  return dot
}

// ── Main component ─────────────────────────────────────────────────────────

export default function Home() {
  const [step, setStep]           = useState<Step>('landing')
  const [currentIndex, setIndex]  = useState(0)
  const [votes, setVotes]         = useState<Record<number, Vote>>({})
  const [recs, setRecs]           = useState<Recommendation[]>([])
  const [matchedUser, setMatchedUser] = useState<number | null>(null)
  const [error, setError]         = useState('')

  const likedIndices = Object.entries(votes).filter(([, v]) => v === 'like').map(([i]) => parseInt(i))
  const likedCount   = likedIndices.length
  const done         = currentIndex >= FILMS.length
  const ready        = likedCount >= 2

  function vote(v: Vote) {
    setVotes(prev => ({ ...prev, [currentIndex]: v }))
    setIndex(i => i + 1)
  }

  async function getRecommendations() {
    setError('')
    setStep('loading')

    const w: Record<string, number> = {}
    for (const i of likedIndices)
      for (const g of FILMS[i].genres) w[g] = (w[g] ?? 0) + 1
    const mag = Math.sqrt(Object.values(w).reduce((s, v) => s + v * v, 0))
    const vVec: Record<string, number> = {}
    for (const [g, s] of Object.entries(w)) vVec[g] = s / mag

    const { data: profiles, error: pe } = await supabase
      .from('user_genre_profiles').select('user_id, genre, score')
    if (pe || !profiles) { setError(pe?.message ?? 'Error'); setStep('rate'); return }

    const uVecs: Record<number, Record<string, number>> = {}
    for (const r of profiles) {
      if (!uVecs[r.user_id]) uVecs[r.user_id] = {}
      uVecs[r.user_id][r.genre] = r.score
    }
    let best = -1, bestS = -1
    for (const [uid, vec] of Object.entries(uVecs)) {
      const s = cosineSim(vec, vVec)
      if (s > bestS) { bestS = s; best = parseInt(uid) }
    }

    const { data: recData, error: re } = await supabase
      .from('recommendations').select('rank, movie_id, title, genres')
      .eq('user_id', best).order('rank')
    if (re || !recData) { setError(re?.message ?? 'Error'); setStep('rate'); return }

    setRecs(recData as Recommendation[])
    setMatchedUser(best)
    setStep('results')
  }

  function restart() {
    setStep('rate'); setIndex(0); setVotes({}); setRecs([]); setMatchedUser(null); setError('')
  }

  // ── LANDING ──────────────────────────────────────────────────────────────
  if (step === 'landing') return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: CREAM, overflow: 'hidden' }}>

      {/* Nav */}
      <header style={{
        height: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 56px', borderBottom: `1px solid ${BORDER}`,
        background: DARK,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 6, background: ACCENT,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900, fontSize: 13, color: '#fff' }}>MM</span>
          </div>
          <span style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontWeight: 700, fontSize: 17, color: '#fff' }}>MovieMatch</span>
        </div>
      </header>

      {/* Split panel */}
      <div style={{ display: 'flex', flex: 1 }}>

        {/* Left — dark */}
        <div style={{
          width: '55%', background: DARK, padding: '48px 56px 52px', display: 'flex',
          flexDirection: 'column', justifyContent: 'space-between', position: 'relative',
          backgroundImage: 'repeating-linear-gradient(0deg, rgba(255,255,255,0.015) 0 1px, transparent 1px 48px)',
        }}>
          <div>
            <Eyebrow color={ACCENT}>ML-powered · Apache Spark ALS · MovieLens</Eyebrow>
            <div style={{ marginTop: 28 }}>
              <div style={{
                fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900,
                fontSize: 'clamp(80px, 9vw, 136px)', lineHeight: 0.87,
                letterSpacing: '-0.02em', textTransform: 'uppercase',
              }}>
                <div style={{ color: '#fff' }}>FIND</div>
                <div style={{ color: '#fff' }}>YOUR</div>
                <div style={{ color: ACCENT }}>FILM</div>
              </div>
            </div>
            <p style={{
              marginTop: 32, fontSize: 17, color: MUTED, lineHeight: 1.6,
              fontFamily: "'Hanken Grotesk', sans-serif", maxWidth: 480,
            }}>
              Rate 12 classic films. We analyse your taste, match you to the most
              similar viewer from 100,000 real ratings, and surface what they loved next.
            </p>
            <button
              onClick={() => setStep('rate')}
              style={{
                marginTop: 36, display: 'inline-flex', alignItems: 'center', gap: 10,
                background: ACCENT, color: '#fff', border: 'none', cursor: 'pointer',
                fontFamily: "'Hanken Grotesk', sans-serif", fontWeight: 700, fontSize: 17,
                padding: '0 32px', height: 58, borderRadius: 10,
                boxShadow: '0 4px 20px rgba(194,65,12,0.3)',
              }}>
              Rate 12 films
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
            <p style={{ marginTop: 12, fontSize: 13, color: '#4A453D', fontFamily: "'Hanken Grotesk', sans-serif" }}>
              No account needed · takes ~30 seconds
            </p>
          </div>

          {/* Stat bar */}
          <div style={{
            borderTop: `1px solid #2E2A25`, paddingTop: 24, marginTop: 40,
            display: 'flex', gap: 48,
          }}>
            {[['610', 'Viewers'], ['9,742', 'Movies'], ['100K', 'Ratings']].map(([n, l]) => (
              <div key={l}>
                <div style={{
                  fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900,
                  fontSize: 30, color: '#fff',
                }}>{n}</div>
                <Eyebrow color="#4A453D">{l}</Eyebrow>
              </div>
            ))}
          </div>
        </div>

        {/* Right — cream */}
        <div style={{
          flex: 1, background: CREAM, position: 'relative', overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '40px 56px',
        }}>
          {/* 610 watermark */}
          <div style={{
            position: 'absolute', bottom: -20, right: -10,
            fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900,
            fontSize: 380, lineHeight: 1, color: '#F0EBE2', userSelect: 'none',
            pointerEvents: 'none', letterSpacing: '-0.04em',
          }}>610</div>

          {/* Demo match card */}
          <div style={{
            background: '#fff', borderRadius: 20, border: `1px solid ${BORDER}`,
            boxShadow: '0 2px 4px rgba(26,24,20,0.04), 0 16px 40px -16px rgba(26,24,20,0.14)',
            padding: '28px 28px 24px', width: 360, position: 'relative', zIndex: 1,
          }}>
            <Eyebrow color={ACCENT}>You liked</Eyebrow>
            <div style={{ display: 'flex', gap: 10, marginTop: 10, marginBottom: 20 }}>
              {[['Drama'], ['Action', 'Sci-Fi']].map((g, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <MiniPoster genres={g} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: DARK, fontFamily: "'Hanken Grotesk', sans-serif" }}>
                    {i === 0 ? 'Shawshank' : 'The Matrix'}
                  </span>
                </div>
              ))}
            </div>

            {/* Ticket divider */}
            <div style={{ position: 'relative', height: 0, borderTop: '2px dashed #E0D9CC', margin: '0 -4px' }}>
              <span style={{ position: 'absolute', left: -20, top: -12, width: 22, height: 22, borderRadius: '50%', background: CREAM, border: `1px solid ${BORDER}` }} />
              <span style={{ position: 'absolute', right: -20, top: -12, width: 22, height: 22, borderRadius: '50%', background: CREAM, border: `1px solid ${BORDER}` }} />
            </div>

            <div style={{ paddingTop: 20 }}>
              <Eyebrow color="#6B655A">Nearest viewer · #{26}</Eyebrow>
              <p style={{ fontSize: 13, color: MUTED, marginTop: 4, marginBottom: 16, fontFamily: "'Hanken Grotesk', sans-serif" }}>
                They also loved
              </p>
              {[
                { title: 'Yojimbo', genres: ['Action', 'Adventure'] },
                { title: 'The Apartment', genres: ['Comedy', 'Drama'] },
                { title: 'In Bruges', genres: ['Comedy', 'Crime'] },
              ].map(f => (
                <div key={f.title} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <MiniPoster genres={f.genres} />
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 600, color: DARK, fontFamily: "'Hanken Grotesk', sans-serif" }}>{f.title}</p>
                    <p style={{ fontSize: 11, color: MUTED, fontFamily: "'Hanken Grotesk', sans-serif" }}>{f.genres.join(', ')}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* How it works bar */}
      <div style={{
        background: DARK, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
        backgroundImage: 'repeating-linear-gradient(0deg, rgba(255,255,255,0.015) 0 1px, transparent 1px 48px)',
      }}>
        {[
          { n: '01', title: 'Rate', body: 'Like or skip 12 well-known films to signal your taste.' },
          { n: '02', title: 'Match', body: 'Cosine similarity finds your nearest viewer from 610 real profiles.' },
          { n: '03', title: 'Watch', body: 'See the films they rated highly that you haven\'t seen yet.' },
          { n: '—', title: 'The data', body: 'MovieLens ml-latest-small · 100,836 ratings · Spark ALS rank 20.' },
        ].map((s, i) => (
          <div key={s.n} style={{
            padding: '28px 32px', borderLeft: i > 0 ? `1px solid #2E2A25` : 'none',
          }}>
            <Eyebrow color={ACCENT}>{s.n} · {s.title}</Eyebrow>
            <p style={{ marginTop: 8, fontSize: 14, color: '#A09890', lineHeight: 1.55, fontFamily: "'Hanken Grotesk', sans-serif" }}>{s.body}</p>
          </div>
        ))}
      </div>
    </div>
  )

  // ── RATE ─────────────────────────────────────────────────────────────────
  if (step === 'rate') return (
    <div style={{ height: '100vh', background: CREAM, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Header */}
      <header style={{
        height: 64, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 56px', borderBottom: `1px solid ${BORDER}`, background: '#fff', gap: 24,
      }}>
        <button onClick={() => setStep('landing')} style={{
          display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer',
        }}>
          <div style={{
            width: 30, height: 30, borderRadius: 6, background: ACCENT,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900, fontSize: 12, color: '#fff' }}>MM</span>
          </div>
          <span style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontWeight: 700, fontSize: 16, color: DARK }}>MovieMatch</span>
        </button>

        {/* 12-segment progress bar */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 500 }}>
          <div style={{ display: 'flex', gap: 3 }}>
            {FILMS.map((_, i) => {
              const v = votes[i]
              const bg = v === 'like' ? ACCENT : v === 'skip' ? FAINT : BORDER
              return <div key={i} style={{ flex: 1, height: 5, borderRadius: 3, background: bg, transition: 'background 0.2s' }} />
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Eyebrow color={MUTED}>{likedCount} liked · {Object.values(votes).filter(v => v === 'skip').length} skipped</Eyebrow>
            <Eyebrow color={MUTED}>{Math.min(currentIndex, 12)} / 12</Eyebrow>
          </div>
        </div>

        <Eyebrow color={MUTED}>Step 1 of 2</Eyebrow>
      </header>

      {/* Card area */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 80, padding: '32px 56px' }}>

        {/* NOPE side */}
        <div style={{ width: 110, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%', border: `3px solid ${NEGATIVE}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={NEGATIVE} strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </div>
          <span style={{
            fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900,
            fontSize: 22, letterSpacing: '0.08em', textTransform: 'uppercase', color: NEGATIVE,
          }}>Nope</span>
        </div>

        {/* Card stack */}
        <div style={{ position: 'relative', width: 380, height: 560 }}>
          {!done ? (
            <>
              {/* Back card */}
              {currentIndex + 2 < FILMS.length && (
                <div style={{
                  position: 'absolute', inset: 0, borderRadius: 24,
                  transform: 'rotate(-5deg) translateY(22px) scale(0.91)',
                  ...posterStyle(FILMS[currentIndex + 2].genres),
                }} />
              )}
              {/* Mid card */}
              {currentIndex + 1 < FILMS.length && (
                <div style={{
                  position: 'absolute', inset: 0, borderRadius: 24,
                  transform: 'rotate(3deg) translateY(11px) scale(0.95)',
                  ...posterStyle(FILMS[currentIndex + 1].genres),
                }} />
              )}
              {/* Front card */}
              <div style={{
                position: 'absolute', inset: 0, borderRadius: 24, overflow: 'hidden',
                boxShadow: '0 8px 40px rgba(26,24,20,0.18)', background: '#fff',
              }}>
                {/* Poster area — top 66% */}
                <div style={{ height: '66%', position: 'relative', ...posterStyle(FILMS[currentIndex].genres) }}>
                  <span style={{
                    position: 'absolute', top: 16, left: 18,
                    fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 400,
                    color: 'rgba(26,24,20,0.45)', letterSpacing: '0.1em',
                  }}>
                    {String(currentIndex + 1).padStart(2, '0')} / 12
                  </span>
                  <div style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0, padding: '32px 24px 20px',
                    background: 'linear-gradient(to top, rgba(26,24,20,0.5), transparent)',
                  }}>
                    <div style={{
                      fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900,
                      fontSize: 56, lineHeight: 0.9, textTransform: 'uppercase',
                      color: '#fff', letterSpacing: '-0.01em',
                    }}>
                      {FILMS[currentIndex].title}
                    </div>
                  </div>
                </div>

                {/* Info area — bottom 34% */}
                <div style={{ padding: '18px 24px 16px', background: '#fff' }}>
                  <p style={{
                    fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 15,
                    color: MUTED, marginBottom: 8,
                  }}>
                    {FILMS[currentIndex].year} · {FILMS[currentIndex].genres.join(', ')}
                  </p>
                  <p style={{
                    fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: FAINT,
                    letterSpacing: '0.08em', marginTop: 'auto',
                  }}>
                    SWIPE TO RATE &nbsp;←&nbsp; NOPE · LIKE &nbsp;→
                  </p>
                </div>
              </div>
            </>
          ) : (
            <div style={{
              position: 'absolute', inset: 0, borderRadius: 24, background: '#fff',
              border: `1px solid ${BORDER}`, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32,
              boxShadow: '0 8px 40px rgba(26,24,20,0.10)',
            }}>
              <div style={{
                fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900,
                fontSize: 64, color: ACCENT, textTransform: 'uppercase',
              }}>Done!</div>
              <p style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 16, color: MUTED, textAlign: 'center' }}>
                You rated all 12 films.<br />{likedCount} liked · ready to match.
              </p>
            </div>
          )}
        </div>

        {/* LIKE side */}
        <div style={{ width: 110, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%', border: `3px solid ${ACCENT}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill={ACCENT} stroke={ACCENT} strokeWidth="1.5">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </div>
          <span style={{
            fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900,
            fontSize: 22, letterSpacing: '0.08em', textTransform: 'uppercase', color: ACCENT,
          }}>Like</span>
        </div>
      </div>

      {/* Action buttons row */}
      {!done && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 24, paddingBottom: 28 }}>
          <button onClick={() => vote('skip')} style={{
            width: 64, height: 64, borderRadius: '50%', background: '#fff',
            border: `2px solid ${BORDER}`, cursor: 'pointer',
            boxShadow: '0 4px 16px rgba(26,24,20,0.08)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: FAINT }}>
            {currentIndex + 1} / 12
          </span>
          <button onClick={() => vote('like')} style={{
            width: 72, height: 72, borderRadius: '50%', background: ACCENT,
            border: 'none', cursor: 'pointer',
            boxShadow: '0 6px 24px rgba(194,65,12,0.32)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="#fff" stroke="#fff" strokeWidth="1.5">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </button>
        </div>
      )}

      {/* Ready / error banner */}
      {error && (
        <div style={{ background: '#FEF2F2', borderTop: `1px solid #FECACA`, padding: '14px 56px', textAlign: 'center' }}>
          <span style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 14, color: '#B91C1C' }}>{error}</span>
        </div>
      )}
      {(ready || done) && (
        <div style={{
          background: ACCENT, padding: '16px 56px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 16, fontWeight: 600, color: '#fff' }}>
            {likedCount} film{likedCount !== 1 ? 's' : ''} liked — ready to match!
          </span>
          <button onClick={getRecommendations} style={{
            background: '#fff', color: ACCENT, border: 'none', cursor: 'pointer',
            fontFamily: "'Hanken Grotesk', sans-serif", fontWeight: 700, fontSize: 15,
            padding: '0 24px', height: 44, borderRadius: 10,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            See results →
          </button>
        </div>
      )}
    </div>
  )

  // ── LOADING ───────────────────────────────────────────────────────────────
  if (step === 'loading') return (
    <div style={{
      height: '100vh', background: CREAM,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20,
    }}>
      <div style={{
        width: 48, height: 48, borderRadius: '50%',
        border: `3px solid ${BORDER}`, borderTopColor: ACCENT,
        animation: 'spin 0.8s linear infinite',
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      <p style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 16, color: MUTED }}>
        Finding your match…
      </p>
      <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: FAINT, letterSpacing: '0.1em' }}>
        COMPUTING COSINE SIMILARITY ACROSS 610 PROFILES
      </p>
    </div>
  )

  // ── RESULTS ───────────────────────────────────────────────────────────────
  const top    = recs[0]
  const rest   = recs.slice(1)
  const liked  = likedIndices.map(i => FILMS[i])

  return (
    <div style={{ height: '100vh', background: CREAM, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Header */}
      <header style={{
        height: 56, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 56px', borderBottom: `2px solid ${DARK}`, background: '#fff', gap: 24,
      }}>
        <button onClick={() => setStep('landing')} style={{
          display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0,
        }}>
          <div style={{
            width: 30, height: 30, borderRadius: 6, background: ACCENT,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900, fontSize: 12, color: '#fff' }}>MM</span>
          </div>
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flex: 1, overflow: 'hidden' }}>
          <Eyebrow color={ACCENT}>Match found · Viewer #{matchedUser}</Eyebrow>
          <div style={{ display: 'flex', gap: 8 }}>
            {liked.slice(0, 3).map((f, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <MiniPoster genres={f.genres} />
                <span style={{ fontSize: 12, color: MUTED, fontFamily: "'Hanken Grotesk', sans-serif", whiteSpace: 'nowrap' }}>
                  {f.title.split(':')[0]}
                </span>
              </div>
            ))}
          </div>
        </div>

        <button onClick={restart} style={{
          background: 'none', border: `1.5px solid ${BORDER}`, cursor: 'pointer', flexShrink: 0,
          fontFamily: "'Hanken Grotesk', sans-serif", fontWeight: 600, fontSize: 14, color: '#5A5449',
          padding: '0 18px', height: 38, borderRadius: 8,
        }}>
          ← Rate again
        </button>
      </header>

      {/* Featured strip — rank 1 */}
      {top && (
        <div style={{
          background: DARK, padding: '0 56px', minHeight: 200,
          display: 'flex', alignItems: 'center', gap: 48,
          backgroundImage: 'repeating-linear-gradient(0deg, rgba(255,255,255,0.015) 0 1px, transparent 1px 48px)',
        }}>
          {/* Rank col */}
          <div style={{ width: 160, flexShrink: 0 }}>
            <Eyebrow color={ACCENT}>Top pick</Eyebrow>
            <div style={{
              fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900,
              fontSize: 80, color: '#fff', lineHeight: 1, marginTop: 4,
            }}>01</div>
          </div>
          {/* Film info */}
          <div style={{ flex: 1 }}>
            <p style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 15, color: MUTED, marginBottom: 6 }}>
              {top.genres.split('|').join(' · ')}
            </p>
            <div style={{
              fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900,
              fontSize: 'clamp(32px, 4vw, 72px)', textTransform: 'uppercase',
              color: '#fff', lineHeight: 0.9, letterSpacing: '-0.01em',
            }}>
              {top.title}
            </div>
          </div>
          {/* Genre chips */}
          <div style={{ width: 200, flexShrink: 0 }}>
            <GenreChips genres={top.genres.split('|')} />
          </div>
        </div>
      )}

      {/* Grid label bar */}
      <div style={{
        height: 44, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 56px', borderBottom: `1px solid ${BORDER}`,
      }}>
        <span style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontWeight: 600, fontSize: 14, color: DARK }}>
          Films 2–10
        </span>
        <Eyebrow color={MUTED}>Ranked by ALS score</Eyebrow>
      </div>

      {/* 3×3 grid */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 1, background: BORDER, flex: 1, overflow: 'auto',
      }}>
        {rest.slice(0, 9).map((rec, i) => {
          const genres  = rec.genres.split('|')
          const primary = genres[0]
          const [light] = GENRE_GRADIENT[primary] ?? ['#E0D9D0', '#C0B9B0']
          const bg      = i % 2 === 0 ? '#fff' : CREAM
          return (
            <div key={rec.rank} style={{
              background: bg, padding: '20px 24px', position: 'relative', overflow: 'hidden',
              borderTop: `4px solid ${light}`,
            }}>
              {/* Rank top-right */}
              <span style={{
                position: 'absolute', top: 12, right: 16,
                fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: ACCENT,
              }}>
                {String(rec.rank).padStart(2, '0')}
              </span>
              {/* Watermark */}
              <span style={{
                position: 'absolute', bottom: -16, right: 8,
                fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900,
                fontSize: 110, color: DARK, opacity: 0.04, lineHeight: 1,
                userSelect: 'none', pointerEvents: 'none',
              }}>
                {rec.rank}
              </span>
              {/* Content */}
              <div style={{ position: 'relative' }}>
                <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: MUTED, marginBottom: 4 }}>
                  {rec.genres.split('|')[0]}
                </p>
                <div style={{
                  fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900,
                  fontSize: 28, textTransform: 'uppercase', color: DARK,
                  lineHeight: 0.95, letterSpacing: '-0.01em', marginBottom: 8,
                }}>
                  {rec.title}
                </div>
                {/* Genre swatches bottom-right */}
                <div style={{ display: 'flex', gap: 3, marginTop: 8 }}>
                  {genres.slice(0, 2).map(g => {
                    const [l] = GENRE_GRADIENT[g] ?? ['#E0D9D0', '#C0B9B0']
                    return <div key={g} style={{ width: 10, height: 14, borderRadius: 2, background: l }} />
                  })}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div style={{
        height: 36, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 56px', borderTop: `1px solid ${BORDER}`,
      }}>
        <Eyebrow color={FAINT}>Spark ALS · rank=20 · regParam=0.1 · matched viewer #{matchedUser}</Eyebrow>
        <a href="https://grouplens.org/datasets/movielens/" target="_blank" rel="noreferrer"
           style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: FAINT, textDecoration: 'none' }}>
          grouplens.org ↗
        </a>
      </div>
    </div>
  )
}
