import { openUrl } from '@tauri-apps/plugin-opener'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseConfig } from './config'

export type LoginProvider = 'discord' | 'google' | 'steam'

export const PROVIDER_LABEL: Record<LoginProvider, string> = { discord: 'Discord', google: 'Google', steam: 'Steam' }

const CALLBACK_URL = 'vants://auth/callback'
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000

const STEAM_ERRORS: Record<string, string> = {
  cancelled: 'Cancelaste el inicio de sesión en Steam.',
  verification_failed: 'Steam no pudo verificar tu identidad. Inténtalo de nuevo.',
  already_linked: 'Esa cuenta de Steam ya está vinculada a otro usuario de VANTS.',
  account_create_failed: 'No se pudo crear tu cuenta con Steam. Prueba con Discord o Google.',
  link_failed: 'No se pudo vincular tu cuenta de Steam.',
  login_failed: 'No se pudo iniciar sesión con Steam. Inténtalo de nuevo.',
  start_failed: 'No se pudo iniciar la conexión con Steam.',
}

type PendingLogin = {
  client: SupabaseClient
  provider: LoginProvider
  resolve: () => void
  reject: (error: Error) => void
}

let pendingLogin: PendingLogin | null = null

export class LoginSupersededError extends Error {
  constructor() {
    super('Se inició un nuevo intento de inicio de sesión.')
    this.name = 'LoginSupersededError'
  }
}

/**
 * Abre el navegador del sistema para Discord, Google o Steam y espera al deep link
 * vants://auth/callback. Un nuevo intento sustituye al anterior: antes se lanzaba
 * "Ya hay un inicio de sesión en curso" y, si el usuario cerraba la pestaña o cerraba sesión,
 * no podía volver a entrar hasta pasados 5 minutos.
 */
export async function signInWithProvider(client: SupabaseClient, provider: LoginProvider): Promise<void> {
  if (pendingLogin) {
    pendingLogin.reject(new LoginSupersededError())
    pendingLogin = null
  }

  let resolveCallback!: () => void
  let rejectCallback!: (error: Error) => void
  const callbackResult = new Promise<void>((resolve, reject) => {
    resolveCallback = resolve
    rejectCallback = reject
  })
  const pending: PendingLogin = { client, provider, resolve: resolveCallback, reject: rejectCallback }
  pendingLogin = pending
  const timeoutId = window.setTimeout(() => {
    if (pendingLogin === pending) {
      pendingLogin = null
      rejectCallback(new Error('La autenticación expiró. Inténtalo de nuevo.'))
    }
  }, LOGIN_TIMEOUT_MS)

  try {
    const projectHost = new URL(supabaseConfig.url).hostname
    let authUrl: URL
    if (provider === 'steam') {
      // Steam usa OpenID 2.0 a través de la Edge Function steam-login (no es un proveedor OAuth nativo).
      authUrl = new URL(`${supabaseConfig.url.replace(/\/$/, '')}/functions/v1/steam-login`)
      authUrl.searchParams.set('redirect_to', CALLBACK_URL)
    } else {
      const { data, error } = await client.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: CALLBACK_URL,
          skipBrowserRedirect: true,
          scopes: provider === 'discord' ? 'identify email' : undefined,
          // Permite elegir otra cuenta tras cerrar sesión en lugar de reentrar automáticamente.
          queryParams: provider === 'discord' ? { prompt: 'consent' } : { prompt: 'select_account' },
        },
      })
      if (error) throw error
      if (!data.url) throw new Error(`Supabase no devolvió la URL de autorización de ${PROVIDER_LABEL[provider]}.`)
      authUrl = new URL(data.url)
    }
    if (authUrl.protocol !== 'https:' || authUrl.hostname !== projectHost) {
      throw new Error('La URL de inicio de sesión no pertenece al proyecto Supabase configurado.')
    }
    await openUrl(authUrl)
    await callbackResult
  } finally {
    window.clearTimeout(timeoutId)
    if (pendingLogin === pending) pendingLogin = null
  }
}

/** Compatibilidad con el código anterior. */
export function signInWithDiscord(client: SupabaseClient): Promise<void> {
  return signInWithProvider(client, 'discord')
}

/** Cierra sesión y, si la revocación remota falla (sin red, token caducado), limpia la sesión local igualmente. */
export async function signOutSafely(client: SupabaseClient): Promise<void> {
  if (pendingLogin) {
    pendingLogin.reject(new LoginSupersededError())
    pendingLogin = null
  }
  const { error } = await client.auth.signOut()
  if (error) await client.auth.signOut({ scope: 'local' }).catch(() => undefined)
}

export function friendlyAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (/flow state|code verifier|both auth code/i.test(message)) return 'El inicio de sesión anterior quedó a medias. Pulsa de nuevo para empezar uno nuevo.'
  if (/provider is not enabled|unsupported provider/i.test(message)) return 'Ese método de inicio de sesión no está activado en el proyecto.'
  if (/already linked|identity is already/i.test(message)) return 'Esa cuenta ya está vinculada a otro usuario de VANTS.'
  return message || 'No se pudo iniciar sesión.'
}

export async function handleSupabaseAuthCallback(client: SupabaseClient, rawUrl: string): Promise<boolean> {
  let callback: URL
  try {
    callback = new URL(rawUrl)
  } catch {
    return false
  }
  if (callback.protocol !== 'vants:' || callback.hostname.toLowerCase() !== 'auth' || callback.pathname !== '/callback') {
    return false
  }

  const pending = pendingLogin?.client === client ? pendingLogin : null
  const fail = (error: Error) => {
    if (pending) {
      pending.reject(error)
      return true
    }
    throw error
  }
  const fragmentParams = new URLSearchParams(callback.hash.slice(1))
  const param = (name: string) => callback.searchParams.get(name) || fragmentParams.get(name)

  const steamError = param('steam_error')
  if (steamError) return fail(new Error(STEAM_ERRORS[steamError] ?? STEAM_ERRORS.login_failed))

  const authError = param('error_description') || param('error')
  if (authError) return fail(new Error(friendlyAuthError(new Error(authError))))

  // Steam: la Edge Function devuelve un token_hash de un solo uso que se canjea por sesión.
  const steamToken = param('steam_token')
  if (steamToken) {
    const { error } = await client.auth.verifyOtp({ token_hash: steamToken, type: 'magiclink' })
    if (error) return fail(new Error(STEAM_ERRORS.login_failed))
    pending?.resolve()
    return true
  }

  const code = param('code')
  if (!code) return fail(new Error('No se recibió el código PKCE de Supabase en vants://auth/callback.'))

  const { error } = await client.auth.exchangeCodeForSession(code)
  if (error) return fail(new Error(friendlyAuthError(error)))
  pending?.resolve()
  return true
}
