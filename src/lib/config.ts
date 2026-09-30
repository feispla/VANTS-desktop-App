const projectUrl = 'https://qtetsgwwsvqzquxssudj.supabase.co'
const projectPublishableKey = 'sb_publishable_Wd5NBpT9pqEJV4Gw4jJB7w_hFXYvYtm'

const configuredUrl = import.meta.env.VITE_SUPABASE_URL?.trim() || projectUrl
const configuredKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  || import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
  || projectPublishableKey

export const supabaseConfig = {
  url: configuredUrl.replace(/\/$/, ''),
  apiKey: configuredKey,
}

export const supabaseProjectReady = Boolean(supabaseConfig.url && supabaseConfig.apiKey)

export const missingSupabaseSettings = [
  !supabaseConfig.url ? 'VITE_SUPABASE_URL' : null,
  !supabaseConfig.apiKey ? 'VITE_SUPABASE_PUBLISHABLE_KEY (o VITE_SUPABASE_ANON_KEY legacy)' : null,
].filter((value): value is string => value !== null)
