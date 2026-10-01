import type { AnonymousAnalyticsSummary, LocalDatabase } from '../lib/database'
import type { NativeNotificationCandidate, NotificationSnapshot, ResourceResult, Workspace } from './types'

export const EMPTY_WORKSPACE: Omit<Workspace, 'client' | 'db'> = {
  session: null, profile: null, matches: [], rank: null, queue: null, tournaments: [],
  notifications: [], plan: 'free', planContent: [], errors: [], stale: false,
}
export const EMPTY_ANALYTICS_SUMMARY: AnonymousAnalyticsSummary = { sessions: 0, features: 0 }

export async function withCache<T>(db: LocalDatabase, key: string, userId: string, loader: () => Promise<T>): Promise<ResourceResult<T>> {
  try {
    const value = await loader()
    await db.writeCache(key, userId, value)
    return { value }
  } catch (error) {
    const cached = await db.readCache<T>(key, userId).catch(() => null)
    if (cached !== null) return { value: cached, error: 'Sin conexión: se muestran los últimos datos reales guardados localmente.', stale: true }
    throw error
  }
}

export function collectNativeNotifications(previous: NotificationSnapshot | null, current: NotificationSnapshot, now: Date): NativeNotificationCandidate[] {
  const events: NativeNotificationCandidate[] = []
  const isRecent = (value: string | null, windowMs: number) => {
    if (!value) return false
    const timestamp = Date.parse(value)
    const age = now.getTime() - timestamp
    return Number.isFinite(timestamp) && age >= 0 && age <= windowMs
  }

  if (current.queue?.status === 'matched') {
    const transitioned = previous
      ? previous.queue?.status !== 'matched' || previous.queue.createdAt !== current.queue.createdAt
      : isRecent(current.queue.createdAt, 10 * 60_000)
    if (transitioned) events.push({
      id: `queue-found-${current.queue.createdAt ?? 'unknown'}`,
      kind: 'match_found',
      title: 'Partida encontrada',
      body: 'La cola competitiva informa que tu entrada fue emparejada.',
    })
  }

  const publishedOutcomes = ['victory', 'defeat', 'draw']
  for (const match of current.matches) {
    if (!publishedOutcomes.includes(match.outcome)) continue
    const prior = previous?.matches.find((item) => item.id === match.id)
    const changedToPublished = previous
      ? !prior || !publishedOutcomes.includes(prior.outcome)
      : isRecent(match.completedAt || match.createdAt, 5 * 60_000)
    if (!changedToPublished) continue
    const result = match.outcome === 'victory' ? 'Victoria' : match.outcome === 'defeat' ? 'Derrota' : 'Empate'
    events.push({
      id: `match-result-${match.id}-${match.outcome}`,
      kind: 'result_published',
      title: 'Resultado publicado',
      body: `${result} contra ${match.opponent}.`,
    })
  }

  for (const tournament of current.tournaments) {
    if (!tournament.startsAt || ['cancelled', 'closed', 'completed'].includes(tournament.status)) continue
    const startsAt = Date.parse(tournament.startsAt)
    const remaining = startsAt - now.getTime()
    if (!Number.isFinite(startsAt) || remaining <= 0 || remaining > 15 * 60_000) continue
    events.push({
      id: `tournament-start-${tournament.id}-${tournament.startsAt}`,
      kind: 'tournament_start',
      title: 'El torneo empieza pronto',
      body: `${tournament.name} empieza en ${Math.max(1, Math.ceil(remaining / 60_000))} min.`,
    })
  }

  return events
}
