import { openUrl } from '@tauri-apps/plugin-opener'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseConfig } from './config'

type PendingDiscordLogin = {
  client: SupabaseClient
  resolve: () => void
  reject: (error: Error) => void
}

let pendingDiscordLogin: PendingDiscordLogin | null = null

export async function signInWithDiscord(client: SupabaseClient): Promise<void> {
  if (pendingDiscordLogin) throw new Error('Ya hay un inicio de sesión Discord en curso.')

  let resolveCallback!: () => void
  let rejectCallback!: (error: Error) => void
  const callbackResult = new Promise<void>((resolve, reject) => {
    resolveCallback = resolve
    rejectCallback = reject
  })
  const pending: PendingDiscordLogin = { client, resolve: resolveCallback, reject: rejectCallback }
  pendingDiscordLogin = pending
  const timeoutId = window.setTimeout(() => {
    if (pendingDiscordLogin === pending) {
      pendingDiscordLogin = null
      rejectCallback(new Error('La autenticación expiró. Inténtalo de nuevo.'))
    }
  }, 5 * 60 * 1000)

  try {
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'discord',
      options: { redirectTo: 'vants://auth/callback', skipBrowserRedirect: true },
    })
    if (error) throw error
    if (!data.url) throw new Error('Supabase no devolvió la URL de autorización de Discord.')

    const authUrl = new URL(data.url)
    if (authUrl.protocol !== 'https:' || authUrl.hostname !== new URL(supabaseConfig.url).hostname) {
      throw new Error('La URL de OAuth no pertenece al proyecto Supabase configurado.')
    }
    await openUrl(authUrl)
    await callbackResult
  } finally {
    window.clearTimeout(timeoutId)
    if (pendingDiscordLogin === pending) pendingDiscordLogin = null
  }
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

  const pending = pendingDiscordLogin?.client === client ? pendingDiscordLogin : null
  const fragmentParams = new URLSearchParams(callback.hash.slice(1))
  const authError = callback.searchParams.get('error_description')
    || callback.searchParams.get('error')
    || fragmentParams.get('error_description')
    || fragmentParams.get('error')
  if (authError) {
    const error = new Error(authError)
    if (pending) {
      pending.reject(error)
      return true
    }
    throw error
  }

  const code = callback.searchParams.get('code') || fragmentParams.get('code')
  if (!code) {
    const error = new Error('No se recibió el código PKCE de Supabase en vants://auth/callback.')
    if (pending) {
      pending.reject(error)
      return true
    }
    throw error
  }

  const { error } = await client.auth.exchangeCodeForSession(code)
  if (error) {
    if (pending) {
      pending.reject(error)
      return true
    }
    throw error
  }
  pending?.resolve()
  return true
}
