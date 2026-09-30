import { openUrl } from '@tauri-apps/plugin-opener'
import { cancel, onUrl, start } from '@fabianlars/tauri-plugin-oauth'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { supabaseConfig } from './config'
import type { AuthStorage } from './secure-storage'

export function createSupabaseClient(storage: AuthStorage): SupabaseClient {
  return createClient(supabaseConfig.url, supabaseConfig.apiKey, {
    auth: {
      flowType: 'pkce',
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      storage,
    },
  })
}

export async function signInWithDiscord(client: SupabaseClient): Promise<void> {
  const port = await start({ response: 'VANTCALL Desktop: autenticación recibida. Puedes cerrar esta pestaña.' })
  let unlisten: (() => void) | undefined
  let timeoutId: number | undefined
  let resolveCallback!: (url: URL) => void
  let rejectCallback!: (error: Error) => void
  const callbackResult = new Promise<URL>((resolve, reject) => {
    resolveCallback = resolve
    rejectCallback = reject
  })

  try {
    unlisten = await onUrl((rawUrl) => {
      let callback: URL
      try {
        callback = new URL(rawUrl)
      } catch {
        rejectCallback(new Error('Discord devolvió una URL de retorno no válida.'))
        return
      }
      const loopbackHost = callback.hostname === 'localhost' || callback.hostname === '127.0.0.1' || callback.hostname === '[::1]'
      if (callback.protocol !== 'http:' || !loopbackHost || Number(callback.port) !== port || !['', '/'].includes(callback.pathname)) {
        rejectCallback(new Error('Se rechazó una URL de retorno OAuth que no coincide con el servidor local.'))
        return
      }
      resolveCallback(callback)
    })

    const redirectTo = `http://localhost:${port}/`
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'discord',
      options: { redirectTo, skipBrowserRedirect: true },
    })
    if (error) throw error
    if (!data.url) throw new Error('Supabase no devolvió la URL de autorización de Discord.')

    const authUrl = new URL(data.url)
    if (authUrl.protocol !== 'https:' || authUrl.hostname !== new URL(supabaseConfig.url).hostname) {
      throw new Error('La URL de OAuth no pertenece al proyecto Supabase configurado.')
    }
    await openUrl(authUrl)

    timeoutId = window.setTimeout(() => rejectCallback(new Error('La autenticación expiró. Inténtalo de nuevo.')), 5 * 60 * 1000)
    const callback = await callbackResult
    const authError = callback.searchParams.get('error_description') || callback.searchParams.get('error')
    if (authError) throw new Error(authError)
    const code = callback.searchParams.get('code')
    if (!code) throw new Error('No se recibió el código de autenticación de Supabase.')

    const { error: exchangeError } = await client.auth.exchangeCodeForSession(code)
    if (exchangeError) throw exchangeError
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId)
    unlisten?.()
    await cancel(port).catch(() => undefined)
  }
}
