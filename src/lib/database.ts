import { isTauri } from '@tauri-apps/api/core'
import Database from '@tauri-apps/plugin-sql'

type SqlValue = string | number | boolean | null

export type AnalyticsFeature = 'dashboard' | 'matches' | 'tournaments' | 'profile' | 'settings'
export type AnalyticsEventName = 'session_start' | 'feature_used'
export type AnonymousAnalyticsSummary = { sessions: number; features: number }

export interface LocalDatabase {
  readCache<T>(cacheKey: string, userId: string): Promise<T | null>
  writeCache(cacheKey: string, userId: string, value: unknown): Promise<void>
  saveSession(userId: string, expiresAt: number | null): Promise<void>
  clearSession(userId: string): Promise<void>
  getSetting(key: string): Promise<string | null>
  setSetting(key: string, value: string): Promise<void>
  listNotifications(): Promise<LocalNotification[]>
  hasNotification(id: string): Promise<boolean>
  saveNotification(notification: LocalNotification): Promise<void>
  recordAnalyticsEvent(eventName: AnalyticsEventName, feature?: AnalyticsFeature): Promise<void>
  getAnalyticsSummary(): Promise<AnonymousAnalyticsSummary>
  clearAnalyticsEvents(): Promise<void>
}

export interface LocalNotification {
  id: string
  kind: string
  title: string
  body: string
  created_at: string
  read_at: string | null
}

const memoryCache = new Map<string, unknown>()
const memorySettings = new Map<string, string>()
const memoryNotifications: LocalNotification[] = []
const memoryAnalytics: Array<{ eventName: AnalyticsEventName; feature?: AnalyticsFeature }> = []

class MemoryDatabase implements LocalDatabase {
  async readCache<T>(cacheKey: string, userId: string): Promise<T | null> {
    return (memoryCache.get(`${userId}:${cacheKey}`) as T | undefined) ?? null
  }
  async writeCache(cacheKey: string, userId: string, value: unknown): Promise<void> {
    memoryCache.set(`${userId}:${cacheKey}`, value)
  }
  async saveSession(): Promise<void> { /* Browser previews never persist auth material. */ }
  async clearSession(): Promise<void> { /* Browser previews never persist auth material. */ }
  async getSetting(key: string): Promise<string | null> { return memorySettings.get(key) ?? null }
  async setSetting(key: string, value: string): Promise<void> { memorySettings.set(key, value) }
  async listNotifications(): Promise<LocalNotification[]> { return [] }
  async hasNotification(id: string): Promise<boolean> { return memoryNotifications.some((item) => item.id === id) }
  async saveNotification(notification: LocalNotification): Promise<void> {
    if (!await this.hasNotification(notification.id)) memoryNotifications.unshift(notification)
  }
  async recordAnalyticsEvent(eventName: AnalyticsEventName, feature?: AnalyticsFeature): Promise<void> {
    memoryAnalytics.push({ eventName, feature })
  }
  async getAnalyticsSummary(): Promise<AnonymousAnalyticsSummary> {
    return {
      sessions: memoryAnalytics.filter((event) => event.eventName === 'session_start').length,
      features: memoryAnalytics.filter((event) => event.eventName === 'feature_used').length,
    }
  }
  async clearAnalyticsEvents(): Promise<void> { memoryAnalytics.length = 0 }
}

class SqliteDatabase implements LocalDatabase {
  private readonly db: Database

  constructor(db: Database) {
    this.db = db
  }

  async readCache<T>(cacheKey: string, userId: string): Promise<T | null> {
    const rows = await this.db.select<{ payload: string }[]>(
      'SELECT payload FROM api_cache WHERE cache_key = $1 AND user_id = $2 LIMIT 1',
      [cacheKey, userId],
    )
    if (!rows[0]) return null
    return JSON.parse(rows[0].payload) as T
  }

  async writeCache(cacheKey: string, userId: string, value: unknown): Promise<void> {
    const payload = JSON.stringify(value)
    await this.db.execute(
      'INSERT INTO api_cache (cache_key, user_id, payload, updated_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP) ON CONFLICT(cache_key, user_id) DO UPDATE SET payload = excluded.payload, updated_at = CURRENT_TIMESTAMP',
      [cacheKey, userId, payload],
    )
    if (cacheKey === 'matches' && Array.isArray(value)) {
      await this.db.execute('DELETE FROM matches_cache WHERE user_id = $1', [userId])
      for (const match of value as Array<{ id?: string }>) {
        if (!match.id) continue
        await this.db.execute(
          'INSERT INTO matches_cache (match_id, user_id, payload, synced_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP) ON CONFLICT(match_id, user_id) DO UPDATE SET payload = excluded.payload, synced_at = CURRENT_TIMESTAMP',
          [match.id, userId, JSON.stringify(match)],
        )
      }
    }
    if (cacheKey === 'profile') {
      await this.db.execute(
        'INSERT INTO sessions (user_id, expires_at, updated_at) VALUES ($1, NULL, CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP',
        [userId],
      )
    }
  }

  async saveSession(userId: string, expiresAt: number | null): Promise<void> {
    await this.db.execute(
      'INSERT INTO sessions (user_id, expires_at, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO UPDATE SET expires_at = excluded.expires_at, updated_at = CURRENT_TIMESTAMP',
      [userId, expiresAt],
    )
  }

  async clearSession(userId: string): Promise<void> {
    await this.db.execute('DELETE FROM sessions WHERE user_id = $1', [userId])
    await this.db.execute('DELETE FROM api_cache WHERE user_id = $1', [userId])
    await this.db.execute('DELETE FROM matches_cache WHERE user_id = $1', [userId])
  }

  async getSetting(key: string): Promise<string | null> {
    const rows = await this.db.select<{ value: string }[]>(
      'SELECT value FROM settings WHERE key = $1 LIMIT 1', [key],
    )
    return rows[0]?.value ?? null
  }

  async setSetting(key: string, value: string): Promise<void> {
    await this.db.execute(
      'INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP',
      [key, value],
    )
  }

  async listNotifications(): Promise<LocalNotification[]> {
    return this.db.select<LocalNotification[]>(
      'SELECT id, kind, title, body, created_at, read_at FROM notifications ORDER BY created_at DESC LIMIT 50',
    )
  }

  async hasNotification(id: string): Promise<boolean> {
    const rows = await this.db.select<{ id: string }[]>(
      'SELECT id FROM notifications WHERE id = $1 LIMIT 1', [id],
    )
    return rows.length > 0
  }

  async saveNotification(notification: LocalNotification): Promise<void> {
    await this.db.execute(
      'INSERT OR IGNORE INTO notifications (id, kind, title, body, created_at, read_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [notification.id, notification.kind, notification.title, notification.body, notification.created_at, notification.read_at],
    )
  }

  async recordAnalyticsEvent(eventName: AnalyticsEventName, feature?: AnalyticsFeature): Promise<void> {
    await this.db.execute(
      'INSERT INTO anonymous_analytics (event_name, feature) VALUES ($1, $2)',
      [eventName, feature ?? null],
    )
  }

  async getAnalyticsSummary(): Promise<AnonymousAnalyticsSummary> {
    const rows = await this.db.select<Array<{ event_name: AnalyticsEventName; count: number | string }>>(
      'SELECT event_name, COUNT(*) AS count FROM anonymous_analytics GROUP BY event_name',
    )
    const counts = new Map(rows.map((row) => [row.event_name, Number(row.count)]))
    return { sessions: counts.get('session_start') ?? 0, features: counts.get('feature_used') ?? 0 }
  }

  async clearAnalyticsEvents(): Promise<void> {
    await this.db.execute('DELETE FROM anonymous_analytics')
  }
}

export async function openLocalDatabase(): Promise<LocalDatabase> {
  if (!isTauri()) return new MemoryDatabase()
  const db = await Database.load('sqlite:vantcall.sqlite')
  return new SqliteDatabase(db)
}

export function asSqlValues(values: unknown[]): SqlValue[] {
  return values.map((value) => value == null || ['string', 'number', 'boolean'].includes(typeof value)
    ? value as SqlValue
    : JSON.stringify(value))
}
