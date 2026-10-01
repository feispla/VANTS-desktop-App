import type { Session, SupabaseClient } from '@supabase/supabase-js'
import type { CompetitiveRank, PlayerProfile, QueueEntry, RankedMatch, Tournament } from '../lib/api'
import type { LocalDatabase, LocalNotification } from '../lib/database'
import type { PlanContentItem, PlanTier } from '../lib/plans'

export type Page = 'dashboard' | 'matches' | 'tournaments' | 'profile' | 'plan' | 'settings'
export type Toast = { kind: 'success' | 'error' | 'info'; message: string }
export type UpdaterState = 'idle' | 'unavailable' | 'checking' | 'current' | 'available' | 'installing' | 'installed' | 'error'
export type Theme = 'dark' | 'light'
export type Workspace = {
  client: SupabaseClient
  db: LocalDatabase
  session: Session | null
  profile: PlayerProfile | null
  matches: RankedMatch[]
  rank: CompetitiveRank | null
  queue: QueueEntry | null
  tournaments: Tournament[]
  notifications: LocalNotification[]
  plan: PlanTier
  planContent: PlanContentItem[]
  errors: string[]
  stale: boolean
}

export type ResourceResult<T> = { value: T; error?: string; stale?: boolean }
export type NotificationSnapshot = { queue: QueueEntry | null; matches: RankedMatch[]; tournaments: Tournament[] }
export type NativeNotificationCandidate = Pick<LocalNotification, 'id' | 'kind' | 'title' | 'body'>
