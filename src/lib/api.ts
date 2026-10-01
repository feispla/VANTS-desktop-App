import type { SupabaseClient, User } from '@supabase/supabase-js'
import { supabaseConfig } from './config'

export interface PlayerProfile {
  id: string
  username: string
  display_name: string | null
  avatar_url: string | null
  region: string | null
  summoner_name: string | null
  verified: boolean | null
  main_game: string | null
  country: string | null
  bio: string | null
  stats: Record<string, unknown>
  riot_handle: string | null
}

export interface RankedMatch {
  id: string
  result: 'player1_win' | 'player2_win' | 'draw' | 'cancelled' | null
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled' | null
  outcome: 'victory' | 'defeat' | 'draw' | 'cancelled' | 'pending'
  opponent: string
  mmrChange: number | null
  createdAt: string | null
  completedAt: string | null
}

export interface CompetitiveRank {
  mmr: number | null
  rank: string | null
  wins: number | null
  losses: number | null
  placementDone: boolean | null
  season: string | null
  updatedAt: string | null
}

export interface QueueEntry {
  status: 'waiting' | 'matched' | 'cancelled' | 'timed_out'
  createdAt: string | null
}

export interface Tournament {
  id: string
  name: string
  description: string | null
  status: string
  format: string
  tier: string | null
  currentParticipants: number
  maxParticipants: number
  prizePool: string | null
  startsAt: string | null
  endsAt: string | null
  registrationClosesAt: string | null
}

export class ApiError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export async function getRows<T>(client: SupabaseClient, route: string): Promise<T[]> {
  if (!supabaseConfig.url || !supabaseConfig.apiKey) {
    throw new ApiError('Falta la configuración de Supabase para consultar datos reales.')
  }

  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const { data: { session } } = await client.auth.getSession()
      const bearerToken = session?.access_token
        ?? (supabaseConfig.apiKey.startsWith('eyJ') ? supabaseConfig.apiKey : undefined)
      const headers: Record<string, string> = {
        apikey: supabaseConfig.apiKey,
        Accept: 'application/json',
      }
      if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`
      const response = await fetch(`${supabaseConfig.url}/rest/v1/${route}`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(12000),
      })

      if (response.status === 401 && attempt === 0 && session) {
        const { error } = await client.auth.refreshSession()
        if (!error) continue
      }
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        const error = new ApiError(`Supabase respondió HTTP ${response.status}${detail ? `: ${detail.slice(0, 180)}` : ''}`, response.status)
        if (response.status === 429 || response.status >= 500) {
          lastError = error
          await delay(350 * (2 ** attempt))
          continue
        }
        throw error
      }
      return await response.json() as T[]
    } catch (error) {
      lastError = error
      const status = error instanceof ApiError ? error.status : undefined
      if (status && status < 500 && status !== 429) throw error
      if (attempt < 2) await delay(350 * (2 ** attempt))
    }
  }

  if (lastError instanceof Error) throw lastError
  throw new ApiError('No se pudo conectar con Supabase después de varios intentos.')
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export async function fetchTournaments(client: SupabaseClient): Promise<Tournament[]> {
  const rows = await getRows<{
    id: string; name: string; description: string | null; status: string; format: string
    tier: string | null; current_participants: number; max_participants: number; prize_pool: string | null
    starts_at: string | null; ends_at: string | null; registration_closes_at: string | null
  }>(client, 'tournaments?select=id,name,description,status,format,tier,current_participants,max_participants,prize_pool,starts_at,ends_at,registration_closes_at&status=neq.draft&order=starts_at.asc.nullslast&limit=50')
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    format: row.format,
    tier: row.tier,
    currentParticipants: row.current_participants,
    maxParticipants: row.max_participants,
    prizePool: row.prize_pool,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    registrationClosesAt: row.registration_closes_at,
  }))
}

export async function fetchProfile(client: SupabaseClient, user: User): Promise<PlayerProfile | null> {
  const playerRows = await getRows<{
    id: string; username: string; display_name: string | null; avatar_url: string | null
    region: string | null; summoner_name: string | null; verified: boolean | null; main_game: string | null; country: string | null
  }>(client, `players?select=id,username,display_name,avatar_url,region,summoner_name,verified,main_game,country&auth_user_id=eq.${encodeURIComponent(user.id)}&limit=1`)
  const player = playerRows[0]
  if (!player) return null
  const profiles = await getRows<{ bio: string | null; stats: Record<string, unknown> | null }>(
    client, `profiles?select=bio,stats&player_id=eq.${encodeURIComponent(player.id)}&limit=1`,
  )
  let riotHandle: string | null = null
  try {
    const accounts = await getRows<{ handle: string | null }>(
      client,
      `user_game_accounts?select=handle&user_id=eq.${encodeURIComponent(user.id)}&game=eq.riot&limit=1`,
    )
    riotHandle = accounts[0]?.handle ?? null
  } catch {
    // Riot linking is optional; an older schema must not prevent the profile loading.
  }
  return { ...player, bio: profiles[0]?.bio ?? null, stats: profiles[0]?.stats ?? {}, riot_handle: riotHandle }
}

export async function fetchMatches(client: SupabaseClient, profile: PlayerProfile): Promise<RankedMatch[]> {
  const rows = await getRows<{
    id: string; player1_id: string | null; player2_id: string | null; result: RankedMatch['result']
    status: NonNullable<RankedMatch['status']> | null; mmr_change_p1: number | null; mmr_change_p2: number | null
    created_at: string | null; completed_at: string | null
    player1: { username: string; display_name: string | null } | null
    player2: { username: string; display_name: string | null } | null
  }>(client, `ranked_matches?select=id,player1_id,player2_id,result,status,mmr_change_p1,mmr_change_p2,created_at,completed_at,player1:players!ranked_matches_player1_id_fkey(username,display_name),player2:players!ranked_matches_player2_id_fkey(username,display_name)&or=(player1_id.eq.${encodeURIComponent(profile.id)},player2_id.eq.${encodeURIComponent(profile.id)})&order=created_at.desc&limit=50`)
  return rows.map((row) => {
    const isPlayer1 = row.player1_id === profile.id
    const opponent = isPlayer1 ? row.player2 : row.player1
    const outcome = row.status === 'cancelled' || row.result === 'cancelled'
      ? 'cancelled'
      : row.status !== 'completed' || !row.result || !['player1_win', 'player2_win', 'draw'].includes(row.result)
        ? 'pending'
        : row.result === 'draw'
          ? 'draw'
          : (row.result === 'player1_win') === isPlayer1 ? 'victory' : 'defeat'
    return {
      id: row.id,
      result: row.result,
      status: row.status,
      outcome,
      opponent: opponent?.display_name || opponent?.username || 'Perfil rival no disponible',
      mmrChange: isPlayer1 ? row.mmr_change_p1 : row.mmr_change_p2,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    }
  })
}

export async function fetchRank(client: SupabaseClient, profile: PlayerProfile): Promise<CompetitiveRank | null> {
  const rows = await getRows<{
    mmr: number | null; rank: string | null; wins: number | null; losses: number | null; placement_done: boolean | null
    updated_at: string | null; season: { name: string } | null
  }>(client, `season_player_stats?select=mmr,rank,wins,losses,placement_done,updated_at,season:seasons(name)&player_id=eq.${encodeURIComponent(profile.id)}&order=updated_at.desc&limit=1`)
  const row = rows[0]
  return row ? {
    mmr: row.mmr,
    rank: row.rank,
    wins: row.wins,
    losses: row.losses,
    placementDone: row.placement_done,
    season: row.season?.name ?? null,
    updatedAt: row.updated_at,
  } : null
}

export async function fetchQueue(client: SupabaseClient, profile: PlayerProfile): Promise<QueueEntry | null> {
  const rows = await getRows<{ status: QueueEntry['status']; created_at: string | null }>(
    client,
    `ranked_queue?select=status,created_at&player_id=eq.${encodeURIComponent(profile.id)}&status=in.(waiting,matched)&order=created_at.desc&limit=1`,
  )
  return rows[0] ? { status: rows[0].status, createdAt: rows[0].created_at } : null
}
