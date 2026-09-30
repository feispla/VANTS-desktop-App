import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { supabaseConfig } from './config'
import type { AuthStorage } from './secure-storage'

let singleton: SupabaseClient | null = null

export function getSupabaseClient(storage: AuthStorage): SupabaseClient {
  if (singleton) return singleton
  singleton = createClient(supabaseConfig.url, supabaseConfig.apiKey, {
    auth: {
      flowType: 'pkce',
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      storage,
    },
  })
  return singleton
}
