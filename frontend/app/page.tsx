'use client'

import { useState, useEffect } from 'react'
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
  { id: 318,   tmdbId: 278,   title: 'The Shawshank Redemption', year: 1994, genres: ['Drama'] },
  { id: 296,   tmdbId: 680,   title: 'Pulp Fiction',              year: 1994, genres: ['Crime', 'Drama'] },
  { id: 2571,  tmdbId: 603,   title: 'The Matrix',                year: 1999, genres: ['Action', 'Sci-Fi'] },
  { id: 356,   tmdbId: 13,    title: 'Forrest Gump',              year: 1994, genres: ['Comedy', 'Drama'] },
  { id: 260,   tmdbId: 11,    title: 'Star Wars: A New Hope',     year: 1977, genres: ['Action', 'Adventure'] },
  { id: 593,   tmdbId: 274,   title: 'The Silence of the Lambs',  year: 1991, genres: ['Crime', 'Horror'] },
  { id: 4993,  tmdbId: 120,   title: 'The Lord of the Rings',     year: 2001, genres: ['Adventure', 'Drama'] },
  { id: 58559, tmdbId: 155,   title: 'The Dark Knight',           year: 2008, genres: ['Action', 'Crime'] },
  { id: 79132, tmdbId: 27205, title: 'Inception',                 year: 2010, genres: ['Action', 'Mystery'] },
  { id: 2959,  tmdbId: 550,   title: 'Fight Club',                year: 1999, genres: ['Drama', 'Thriller'] },
  { id: 1,     tmdbId: 862,   title: 'Toy Story',                 year: 1995, genres: ['Animation', 'Comedy'] },
  { id: 1721,  tmdbId: 329,   title: 'Jurassic Park',             year: 1993, genres: ['Adventure', 'Sci-Fi'] },
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
  const [modal, setModal]         = useState<'how' | 'data' | 'match' | null>(null)
  const [posters, setPosters]     = useState<Record<number, string>>({})
  const [recPosters, setRecPosters]  = useState<Record<number, string>>({})
  const [recDetails, setRecDetails]  = useState<Record<number, { overview: string; cast: string[] }>>({})
  const [hoveredRec, setHoveredRec]  = useState<number | null>(null)

  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_TMDB_TOKEN
    if (!token) return
    Promise.all(
      FILMS.map(f =>
        fetch(`https://api.themoviedb.org/3/movie/${f.tmdbId}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
          .then(r => r.json())
          .then(d => d.poster_path ? [f.id, `https://image.tmdb.org/t/p/w342${d.poster_path}`] : null)
          .catch(() => null)
      )
    ).then(results => {
      const map: Record<number, string> = {}
      for (const r of results) if (r) map[r[0] as number] = r[1] as string
      setPosters(map)
    })
  }, [])

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

    const recList = recData as Recommendation[]
    setRecs(recList)
    setMatchedUser(best)
    setStep('results')

    // Fetch TMDB posters for recommendations
    const token = process.env.NEXT_PUBLIC_TMDB_TOKEN
    if (token) {
      // Clean MovieLens title format: "General, The (1926)" → { title: "The General", year: "1926" }
      function parseTitle(raw: string): { title: string; year: string } {
        const yearMatch = raw.match(/\((\d{4})\)\s*$/)
        const year = yearMatch?.[1] ?? ''
        let title = raw.replace(/\s*\(\d{4}\)\s*$/, '').trim()
        // "Title, The" / "Title, A" / "Title, An" → "The Title" etc.
        const articleMatch = title.match(/^(.*),\s*(The|A|An)$/i)
        if (articleMatch) title = `${articleMatch[2]} ${articleMatch[1].trim()}`
        return { title, year }
      }

      async function fetchMovieData(movieId: number, rawTitle: string): Promise<{ id: number; poster: string | null; overview: string; cast: string[] }> {
        const { title, year } = parseTitle(rawTitle)
        const base = 'https://api.themoviedb.org/3/search/movie'
        const headers = { Authorization: `Bearer ${token}` }
        let tmdbId: number | null = null
        let poster: string | null = null
        let overview = ''

        for (const q of [`${base}?query=${encodeURIComponent(title)}&year=${year}&page=1`, `${base}?query=${encodeURIComponent(title)}&page=1`]) {
          try {
            const d = await fetch(q, { headers }).then(r => r.json())
            const hit = d.results?.[0]
            if (hit) {
              tmdbId   = hit.id
              overview = hit.overview ?? ''
              if (hit.poster_path) poster = `https://image.tmdb.org/t/p/w342${hit.poster_path}`
              break
            }
          } catch { /* continue */ }
        }

        let cast: string[] = []
        if (tmdbId) {
          try {
            const c = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}/credits`, { headers }).then(r => r.json())
            cast = (c.cast ?? []).slice(0, 4).map((a: { name: string }) => a.name)
          } catch { /* skip */ }
        }

        return { id: movieId, poster, overview, cast }
      }

      Promise.all(recList.map(r => fetchMovieData(r.movie_id, r.title))).then(results => {
        const posterMap: Record<number, string>                            = {}
        const detailMap: Record<number, { overview: string; cast: string[] }> = {}
        for (const r of results) {
          if (r.poster)   posterMap[r.id] = r.poster
          if (r.overview) detailMap[r.id] = { overview: r.overview, cast: r.cast }
        }
        setRecPosters(posterMap)
        setRecDetails(detailMap)
      })
    }
  }

  function restart() {
    setStep('rate'); setIndex(0); setVotes({}); setRecs([]); setMatchedUser(null); setError('')
  }

  // ── MODALS ────────────────────────────────────────────────────────────────
  const modalContent: Record<string, { title: string; rows: { n: string; head: string; body: string }[] }> = {
    match: {
      title: 'What is your Film Twin?',
      rows: [
        {
          n: '01', head: 'You rated 12 films',
          body: `From the films you liked, we built a genre preference vector — a number for each genre representing how much you enjoy it. For example: 60% Drama, 30% Crime, 10% Comedy.`,
        },
        {
          n: '02', head: `Viewer #${matchedUser} is your nearest match`,
          body: `We compared your genre vector against the profiles of all 610 real MovieLens viewers using cosine similarity — a measure of how closely two taste profiles point in the same direction. Viewer #${matchedUser} had the highest similarity score with you.`,
        },
        {
          n: '03', head: 'These are their top films',
          body: `The recommendations you see are films that Viewer #${matchedUser} rated highly — predicted by an Apache Spark ALS model trained on 100,836 ratings. Since their taste is closest to yours, their favourites are your best discovery list.`,
        },
      ],
    },
    how: {
      title: 'How it works',
      rows: [
        {
          n: '01', head: 'Rate 12 films',
          body: 'We show you 12 well-known films one at a time. Like the ones you enjoyed, skip the ones you haven\'t seen or didn\'t like. You need at least two likes to continue.',
        },
        {
          n: '02', head: 'Cosine similarity match',
          body: 'Your likes are turned into a genre preference vector (e.g. 60% Action, 40% Drama). We compare that against the genre profiles of all 610 real MovieLens viewers and find the one whose taste is closest to yours.',
        },
        {
          n: '03', head: 'Personalised recommendations',
          body: 'We look at the films your nearest viewer rated highly — then surface the ones you haven\'t already told us you liked. Those are your top 10 recommendations.',
        },
      ],
    },
    data: {
      title: 'The data',
      rows: [
        {
          n: '—', head: 'MovieLens ml-latest-small',
          body: '100,836 ratings from 610 real users across 9,742 films. Collected by the GroupLens research lab at the University of Minnesota. Each rating is a score from 0.5 to 5.0.',
        },
        {
          n: '—', head: 'Apache Spark ALS',
          body: 'Ratings are factorised using Alternating Least Squares collaborative filtering (rank=20, regParam=0.1) running on Apache Spark. The model achieves RMSE ≈ 0.83 on a held-out test set.',
        },
        {
          n: '—', head: 'Genre profiles in Supabase',
          body: 'For each of the 610 users, a unit-normalised genre preference vector is precomputed from their liked ratings and stored in Supabase. The browser fetches all 9,295 rows and runs the cosine similarity in-memory — no server round-trip needed.',
        },
      ],
    },
  }

  const activeModal = modal ? modalContent[modal] : null

  // ── LANDING ──────────────────────────────────────────────────────────────
  if (step === 'landing') return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: CREAM }}>
      {ModalOverlay}

      {/* Nav — split: dark left / cream right */}
      <header style={{ display: 'flex', height: 56, flexShrink: 0 }}>
        {/* Logo on dark side */}
        <div style={{
          width: '52%', background: DARK, display: 'flex', alignItems: 'center',
          padding: '0 40px', borderBottom: `1px solid #2E2A25`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 30, height: 30, borderRadius: 6, background: ACCENT,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900, fontSize: 12, color: '#fff' }}>FT</span>
            </div>
            <span style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontWeight: 700, fontSize: 16, color: '#fff' }}>FilmTwin</span>
          </div>
        </div>
        {/* Links on cream side */}
        <div style={{
          flex: 1, background: CREAM, display: 'flex', alignItems: 'center',
          justifyContent: 'flex-end', padding: '0 40px', gap: 32,
          borderBottom: `1px solid ${BORDER}`,
        }}>
          <span
            onClick={() => setModal('how')}
            style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 14, color: '#5A5449', cursor: 'pointer', userSelect: 'none' }}
          >How it works</span>
          <span
            onClick={() => setModal('data')}
            style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 14, color: '#5A5449', cursor: 'pointer', userSelect: 'none' }}
          >The data</span>
        </div>
      </header>

      {/* Split panel */}
      <div style={{ display: 'flex', flex: 1 }}>

        {/* Left — dark */}
        <div style={{
          width: '52%', background: DARK, padding: '44px 40px 44px',
          display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
          backgroundImage: 'repeating-linear-gradient(0deg, rgba(255,255,255,0.015) 0 1px, transparent 1px 48px)',
        }}>
          <div>
            <Eyebrow color={'#5A5449'}>Collaborative filtering · Apache Spark ALS</Eyebrow>
            <div style={{ marginTop: 20 }}>
              <div style={{
                fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900,
                fontSize: 'clamp(72px, 8.5vw, 128px)', lineHeight: 0.87,
                letterSpacing: '-0.02em', textTransform: 'uppercase',
              }}>
                <div style={{ color: '#fff' }}>FIND</div>
                <div style={{ color: '#fff' }}>YOUR</div>
                <div style={{ color: ACCENT }}>FILM</div>
              </div>
            </div>
            <p style={{
              marginTop: 28, fontSize: 16, color: MUTED, lineHeight: 1.6,
              fontFamily: "'Hanken Grotesk', sans-serif", maxWidth: 420,
            }}>
              Rate 12 films you know. We match you with the real
              viewer — out of 610 — whose taste is closest to yours,
              then show you what they loved.
            </p>
            <div style={{ marginTop: 32, display: 'flex', alignItems: 'center', gap: 20 }}>
              <button
                onClick={() => setStep('rate')}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 10,
                  background: ACCENT, color: '#fff', border: 'none', cursor: 'pointer',
                  fontFamily: "'Hanken Grotesk', sans-serif", fontWeight: 700, fontSize: 16,
                  padding: '0 28px', height: 52, borderRadius: 100,
                  boxShadow: '0 4px 20px rgba(194,65,12,0.3)', whiteSpace: 'nowrap',
                }}>
                Start matching →
              </button>
              <span style={{ fontSize: 13, color: '#4A453D', fontFamily: "'Hanken Grotesk', sans-serif" }}>
                No account · ~30 seconds
              </span>
            </div>
          </div>

          {/* Stat bar */}
          <div style={{
            borderTop: `1px solid #2E2A25`, paddingTop: 24,
            display: 'flex', gap: 40,
          }}>
            {[['610', 'Viewers'], ['9,742', 'Films'], ['100K', 'Ratings']].map(([n, l]) => (
              <div key={l}>
                <div style={{
                  fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900,
                  fontSize: 32, color: '#fff', lineHeight: 1,
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
          padding: '40px 48px',
        }}>
          {/* 610 watermark */}
          <div style={{
            position: 'absolute', bottom: -40, right: -20,
            fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900,
            fontSize: 340, lineHeight: 1, color: '#EDE8DF', userSelect: 'none',
            pointerEvents: 'none', letterSpacing: '-0.04em',
          }}>610</div>

          {/* Demo card */}
          <div style={{
            background: '#fff', borderRadius: 16, border: `1px solid ${BORDER}`,
            boxShadow: '0 2px 4px rgba(26,24,20,0.04), 0 16px 40px -16px rgba(26,24,20,0.12)',
            width: 380, position: 'relative', zIndex: 1, overflow: 'hidden',
          }}>
            {/* Card header */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '14px 20px', borderBottom: `1px solid ${BORDER}`,
            }}>
              <Eyebrow color={MUTED}>Example · How it works</Eyebrow>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: ACCENT }} />
                <Eyebrow color={ACCENT}>Match found</Eyebrow>
              </div>
            </div>

            {/* Row 01 — You liked */}
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${BORDER}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: ACCENT, fontWeight: 400 }}>01</span>
                <Eyebrow color={'#5A5449'}>You liked</Eyebrow>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                {[
                  { title: 'Pulp Fiction', year: 1994, genres: ['Crime', 'Drama'] },
                  { title: 'The Matrix',   year: 1999, genres: ['Action', 'Sci-Fi'] },
                ].map(f => (
                  <div key={f.title} style={{
                    flex: 1, display: 'flex', alignItems: 'center', gap: 10,
                    background: CREAM, borderRadius: 8, padding: '8px 12px',
                    border: `1px solid ${BORDER}`,
                  }}>
                    <MiniPoster genres={f.genres} />
                    <div>
                      <p style={{ fontSize: 13, fontWeight: 600, color: DARK, fontFamily: "'Hanken Grotesk', sans-serif" }}>{f.title}</p>
                      <p style={{ fontSize: 11, color: FAINT, fontFamily: "'JetBrains Mono', monospace" }}>{f.year}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Row 02 — Nearest viewer */}
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${BORDER}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: ACCENT }}>02</span>
                <Eyebrow color={'#5A5449'}>Your nearest viewer</Eyebrow>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <span style={{
                  fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900,
                  fontSize: 40, color: ACCENT, lineHeight: 1, textTransform: 'uppercase',
                }}>Viewer #26</span>
                <span style={{ fontSize: 13, color: MUTED, fontFamily: "'Hanken Grotesk', sans-serif" }}>
                  out of 610 real viewers
                </span>
              </div>
            </div>

            {/* Row 03 — They also loved */}
            <div style={{ padding: '16px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: ACCENT }}>03</span>
                <Eyebrow color={'#5A5449'}>They also loved</Eyebrow>
              </div>
              {[
                { n: 1, title: 'Yojimbo',                         year: 1961 },
                { n: 2, title: 'A Grand Day Out',                 year: 1989 },
                { n: 3, title: 'Three Billboards Outside Ebbing', year: 2017 },
              ].map(f => (
                <div key={f.title} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '7px 0', borderTop: `1px solid ${BORDER}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: FAINT, width: 12 }}>{f.n}</span>
                    <span style={{ fontSize: 14, fontWeight: 500, color: DARK, fontFamily: "'Hanken Grotesk', sans-serif" }}>{f.title}</span>
                  </div>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: FAINT }}>{f.year}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
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
            <span style={{ fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900, fontSize: 12, color: '#fff' }}>FT</span>
          </div>
          <span style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontWeight: 700, fontSize: 16, color: DARK }}>FilmTwin</span>
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
                  overflow: 'hidden',
                  ...(posters[FILMS[currentIndex + 2].id]
                    ? { background: '#111' }
                    : posterStyle(FILMS[currentIndex + 2].genres)),
                }}>
                  {posters[FILMS[currentIndex + 2].id] && (
                    <img src={posters[FILMS[currentIndex + 2].id]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.7 }} />
                  )}
                </div>
              )}
              {/* Mid card */}
              {currentIndex + 1 < FILMS.length && (
                <div style={{
                  position: 'absolute', inset: 0, borderRadius: 24,
                  transform: 'rotate(3deg) translateY(11px) scale(0.95)',
                  overflow: 'hidden',
                  ...(posters[FILMS[currentIndex + 1].id]
                    ? { background: '#111' }
                    : posterStyle(FILMS[currentIndex + 1].genres)),
                }}>
                  {posters[FILMS[currentIndex + 1].id] && (
                    <img src={posters[FILMS[currentIndex + 1].id]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.7 }} />
                  )}
                </div>
              )}
              {/* Front card */}
              <div style={{
                position: 'absolute', inset: 0, borderRadius: 24, overflow: 'hidden',
                boxShadow: '0 8px 40px rgba(26,24,20,0.18)', background: '#111',
              }}>
                {/* Poster — full card */}
                {posters[FILMS[currentIndex].id] ? (
                  <img
                    src={posters[FILMS[currentIndex].id]}
                    alt={FILMS[currentIndex].title}
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <div style={{ position: 'absolute', inset: 0, ...posterStyle(FILMS[currentIndex].genres) }} />
                )}

                {/* Counter badge */}
                <span style={{
                  position: 'absolute', top: 16, left: 18,
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
                  color: 'rgba(255,255,255,0.6)', letterSpacing: '0.1em',
                  background: 'rgba(0,0,0,0.3)', padding: '3px 8px', borderRadius: 6,
                }}>
                  {String(currentIndex + 1).padStart(2, '0')} / 12
                </span>

                {/* Title + meta overlay at bottom */}
                <div style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0,
                  padding: '64px 24px 22px',
                  background: 'linear-gradient(to top, rgba(10,8,6,0.92) 0%, rgba(10,8,6,0.6) 60%, transparent 100%)',
                }}>
                  <div style={{
                    fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900,
                    fontSize: 48, lineHeight: 0.92, textTransform: 'uppercase',
                    color: '#fff', letterSpacing: '-0.01em', marginBottom: 10,
                  }}>
                    {FILMS[currentIndex].title}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{
                      fontFamily: "'JetBrains Mono', monospace", fontSize: 12,
                      color: 'rgba(255,255,255,0.55)',
                    }}>{FILMS[currentIndex].year}</span>
                    <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 10 }}>·</span>
                    <GenreChips genres={FILMS[currentIndex].genres} />
                  </div>
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

  // shared modal renderer
  const ModalOverlay = activeModal ? (
    <div
      onClick={() => setModal(null)}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(10,8,6,0.75)',
        zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: DARK, borderRadius: 20,
          boxShadow: '0 32px 80px rgba(0,0,0,0.7)',
          width: '100%', maxWidth: 540, overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ padding: '22px 24px 18px', borderBottom: '1px solid #222018', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <Eyebrow color={ACCENT}>{modal === 'match' ? 'How matching works' : modal === 'how' ? 'The process' : 'About the data'}</Eyebrow>
            <div style={{ fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900, fontSize: 24, color: '#fff', textTransform: 'uppercase', letterSpacing: '-0.01em', marginTop: 4 }}>
              {activeModal.title}
            </div>
          </div>
          <button onClick={() => setModal(null)} style={{ background: '#1E1A16', border: 'none', cursor: 'pointer', color: '#6B6560', width: 32, height: 32, borderRadius: 8, fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>×</button>
        </div>

        <div style={{ padding: '0 24px 24px' }}>
          {(modal === 'how' || modal === 'match') ? (
            /* Dark editorial — number + row */
            <div>
              {activeModal.rows.map((row, i) => (
                <div key={i} style={{
                  display: 'flex', gap: 16, alignItems: 'flex-start',
                  padding: '20px 0',
                  borderBottom: i < activeModal.rows.length - 1 ? '1px solid #1E1A16' : 'none',
                }}>
                  {/* Accent step number */}
                  <div style={{
                    fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900,
                    fontSize: 52, lineHeight: 0.85, color: ACCENT, flexShrink: 0, width: 44,
                  }}>
                    {i + 1}
                  </div>
                  <div>
                    <p style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontWeight: 700, fontSize: 15, color: '#fff', marginBottom: 7 }}>
                      {row.head}
                    </p>
                    <p style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 13, color: '#6B6560', lineHeight: 1.65 }}>
                      {row.body}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {/* Stat strip */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', background: '#1A1612', borderRadius: 12, margin: '20px 0', overflow: 'hidden', border: '1px solid #222018' }}>
                {[{ n: '100,836', label: 'Ratings' }, { n: '610', label: 'Real viewers' }, { n: '9,742', label: 'Films' }].map((s, i) => (
                  <div key={s.label} style={{ padding: '16px', textAlign: 'center', borderRight: i < 2 ? '1px solid #222018' : 'none' }}>
                    <div style={{ fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900, fontSize: 26, color: '#fff', lineHeight: 1 }}>{s.n}</div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: '#4A443E', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 5 }}>{s.label}</div>
                  </div>
                ))}
              </div>
              {[
                { tag: 'Dataset', head: 'MovieLens ml-latest-small', body: 'Collected by the GroupLens research lab at the University of Minnesota. Each rating is a score from 0.5 – 5.0.', badge: 'GroupLens · UMN' },
                { tag: 'Model', head: 'Apache Spark ALS', body: 'Ratings are factorised using Alternating Least Squares collaborative filtering (rank=20, regParam=0.1). RMSE ≈ 0.83 on a held-out test set.', badge: 'RMSE 0.83' },
                { tag: 'Matching', head: 'Genre profiles in Supabase', body: 'A unit-normalised genre vector is precomputed per user and stored in Supabase. The browser fetches all 9,295 rows and runs cosine similarity in-memory — no extra server round-trip.', badge: '9,295 rows' },
              ].map((card, i) => (
                <div key={i} style={{ display: 'flex', gap: 16, padding: '16px 0', borderTop: '1px solid #1E1A16' }}>
                  <div style={{ width: 68, flexShrink: 0 }}>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: ACCENT, letterSpacing: '0.1em', textTransform: 'uppercase', background: 'rgba(194,65,12,0.12)', padding: '3px 7px', borderRadius: 4, display: 'inline-block' }}>{card.tag}</span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 5 }}>
                      <p style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontWeight: 700, fontSize: 14, color: '#fff' }}>{card.head}</p>
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: '#4A443E', background: '#1A1612', border: '1px solid #2A2520', padding: '2px 7px', borderRadius: 4, whiteSpace: 'nowrap', marginLeft: 10, marginTop: 2 }}>{card.badge}</span>
                    </div>
                    <p style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 13, color: '#6B6560', lineHeight: 1.6 }}>{card.body}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  ) : null

  return (
    <div style={{ height: '100vh', background: '#0E0C0A', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {ModalOverlay}

      {/* Header */}
      <header style={{
        height: 52, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 20px', borderBottom: `1px solid #1E1A16`, background: '#0E0C0A', gap: 16,
      }}>
        <button onClick={() => setStep('landing')} style={{
          display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer',
        }}>
          <div style={{ width: 28, height: 28, borderRadius: 6, background: ACCENT, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900, fontSize: 11, color: '#fff' }}>FT</span>
          </div>
          <span style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontWeight: 700, fontSize: 14, color: '#fff' }}>FilmTwin</span>
        </button>

        <button
          onClick={() => setModal('match')}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
          }}
        >
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: ACCENT }} />
          <Eyebrow color={ACCENT}>Match found · your film twin is viewer #{matchedUser}</Eyebrow>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: '#4A443E', marginLeft: 2 }}>?</span>
        </button>

        <button onClick={restart} style={{
          background: 'none', border: `1px solid #2A2520`, cursor: 'pointer',
          fontFamily: "'Hanken Grotesk', sans-serif", fontWeight: 600, fontSize: 12, color: '#6B6560',
          padding: '0 14px', height: 30, borderRadius: 6,
        }}>
          ← Rate again
        </button>
      </header>

      {/* Main: big poster left + 3×3 grid right */}
      <div style={{ flex: 1, display: 'flex', gap: 12, padding: 12, minHeight: 0 }}>

        {/* LEFT — #1 poster */}
        {top && (() => {
          const genres = top.genres.split('|')
          const poster = recPosters[top.movie_id]
          return (
            <div
              onMouseEnter={() => setHoveredRec(top.movie_id)}
              onMouseLeave={() => setHoveredRec(null)}
              style={{
                width: '32%', flexShrink: 0, position: 'relative', borderRadius: 12, overflow: 'hidden',
                background: poster ? '#111' : undefined,
                boxShadow: '0 12px 48px rgba(0,0,0,0.7)',
                ...(poster ? {} : posterStyle(genres)),
              }}>
              {poster && <img src={poster} alt={top.title} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transition: 'transform 0.4s ease', transform: hoveredRec === top.movie_id ? 'scale(1.04)' : 'scale(1)' }} />}
              {/* Rank badge */}
              <div style={{
                position: 'absolute', top: 14, left: 14,
                background: ACCENT, borderRadius: 6, padding: '3px 10px',
                fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#fff', fontWeight: 500,
              }}>01</div>
              {/* Hover detail overlay */}
              {hoveredRec === top.movie_id && recDetails[top.movie_id] && (
                <div style={{
                  position: 'absolute', inset: 0,
                  background: 'linear-gradient(to top, rgba(0,0,0,0.97) 0%, rgba(0,0,0,0.75) 100%)',
                  display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
                  padding: '24px 20px', gap: 12,
                }}>
                  <Eyebrow color={ACCENT}>Top pick</Eyebrow>
                  <div style={{ fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900, fontSize: 'clamp(18px, 2vw, 28px)', textTransform: 'uppercase', color: '#fff', lineHeight: 1.0, letterSpacing: '-0.01em' }}>{top.title}</div>
                  <p style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: 1.55, display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {recDetails[top.movie_id].overview}
                  </p>
                  {recDetails[top.movie_id].cast.length > 0 && (
                    <div>
                      <Eyebrow color={'rgba(255,255,255,0.3)'}>Cast</Eyebrow>
                      <p style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 4 }}>
                        {recDetails[top.movie_id].cast.join(' · ')}
                      </p>
                    </div>
                  )}
                </div>
              )}
              {/* Default bottom overlay (no hover) */}
              {hoveredRec !== top.movie_id && (
                <div style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0,
                  padding: '80px 20px 22px',
                  background: 'linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.6) 50%, transparent 100%)',
                }}>
                  <Eyebrow color={ACCENT}>Top pick</Eyebrow>
                  <div style={{ fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900, fontSize: 'clamp(20px, 2.4vw, 34px)', textTransform: 'uppercase', color: '#fff', lineHeight: 1.0, letterSpacing: '-0.01em', marginTop: 6, marginBottom: 8 }}>{top.title}</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {genres.slice(0, 3).map(g => (
                      <span key={g} style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{g}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })()}

        {/* RIGHT — 3×3 grid for ranks 2–10 */}
        <div style={{
          flex: 1, display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gridTemplateRows: 'repeat(3, 1fr)',
          gap: 10, minWidth: 0,
        }}>
          {rest.slice(0, 9).map((rec) => {
            const genres   = rec.genres.split('|')
            const poster   = recPosters[rec.movie_id]
            const details  = recDetails[rec.movie_id]
            const isHover  = hoveredRec === rec.movie_id
            return (
              <div
                key={rec.rank}
                onMouseEnter={() => setHoveredRec(rec.movie_id)}
                onMouseLeave={() => setHoveredRec(null)}
                style={{
                  position: 'relative', borderRadius: 10, overflow: 'hidden',
                  background: poster ? '#111' : undefined,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
                  ...(poster ? {} : posterStyle(genres)),
                }}>
                {poster && <img src={poster} alt={rec.title} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transition: 'transform 0.35s ease', transform: isHover ? 'scale(1.05)' : 'scale(1)' }} />}
                {/* Rank badge */}
                <div style={{
                  position: 'absolute', top: 8, left: 8, zIndex: 2,
                  background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
                  borderRadius: 5, padding: '2px 7px',
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: '#fff',
                }}>{String(rec.rank).padStart(2, '0')}</div>

                {/* Hover overlay — description + cast */}
                {isHover && details ? (
                  <div style={{
                    position: 'absolute', inset: 0, zIndex: 1,
                    background: 'linear-gradient(to top, rgba(0,0,0,0.97) 0%, rgba(0,0,0,0.8) 100%)',
                    display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
                    padding: '10px 12px 12px', gap: 6,
                  }}>
                    <div style={{ fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900, fontSize: 'clamp(10px, 1vw, 14px)', textTransform: 'uppercase', color: '#fff', lineHeight: 1.1, letterSpacing: '-0.01em' }}>{rec.title}</div>
                    <p style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 11, color: 'rgba(255,255,255,0.65)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {details.overview}
                    </p>
                    {details.cast.length > 0 && (
                      <p style={{ fontFamily: "'Hanken Grotesk', sans-serif", fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>
                        {details.cast.join(' · ')}
                      </p>
                    )}
                  </div>
                ) : (
                  /* Default bottom overlay */
                  <div style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 1,
                    padding: '28px 10px 10px',
                    background: 'linear-gradient(to top, rgba(0,0,0,0.9) 0%, transparent 100%)',
                  }}>
                    <div style={{ fontFamily: "'Big Shoulders Display', sans-serif", fontWeight: 900, fontSize: 'clamp(11px, 1.1vw, 16px)', textTransform: 'uppercase', color: '#fff', lineHeight: 1.1, letterSpacing: '-0.01em', marginBottom: 3 }}>{rec.title}</div>
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 8, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{genres[0]}</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Footer */}
      <div style={{
        height: 28, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 20px', borderTop: `1px solid #1A1612`,
      }}>
        <Eyebrow color={'#2E2924'}>Spark ALS · rank=20 · regParam=0.1 · matched viewer #{matchedUser}</Eyebrow>
        <a href="https://grouplens.org/datasets/movielens/" target="_blank" rel="noreferrer"
           style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: '#2E2924', textDecoration: 'none' }}>
          grouplens.org ↗
        </a>
      </div>
    </div>
  )
}
