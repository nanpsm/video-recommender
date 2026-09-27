import { createClient } from '@supabase/supabase-js'

// These are public/read-only values — safe to expose in the browser.
// The anon key can only SELECT from tables that have a public read RLS policy.
const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnon)

export interface Recommendation {
  rank:     number
  movie_id: number
  title:    string
  genres:   string
}
