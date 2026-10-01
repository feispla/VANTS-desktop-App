import type { SupabaseClient } from '@supabase/supabase-js'
import { getRows, type PlayerProfile } from './api'

export type PlanTier = 'free' | 'basic' | 'pro' | 'elite'
export type PaidTier = Exclude<PlanTier, 'free'>

export const PLAN_RANK: Record<PlanTier, number> = { free: 0, basic: 1, pro: 2, elite: 3 }

export const PLAN_TIERS: { key: PaidTier; name: string; tag: string; blurb: string; price: number }[] = [
  { key: 'basic', name: 'VANT BASIC', tag: 'T1', blurb: 'Torneos abiertos, perfil Ranked y soporte.', price: 9 },
  { key: 'pro', name: 'VANT PRO', tag: 'T2', blurb: 'Pro Series, scrims privadas y prioridad en tryouts.', price: 19 },
  { key: 'elite', name: 'VANT ELITE', tag: 'T3', blurb: 'Elite Invitational, canal Command y badge Elite.', price: 39 },
]

export interface PlanContentItem {
  id: string
  tier: PaidTier
  kind: 'perk' | 'link' | 'announcement' | 'code'
  title: string
  body: string | null
  ctaLabel: string | null
  ctaUrl: string | null
  sortOrder: number
}

/** Plan activo más alto según `entitlements` (lectura propia por RLS). */
export async function fetchPlan(client: SupabaseClient, profile: PlayerProfile): Promise<PlanTier> {
  const rows = await getRows<{ tier: string | null; expires_at: string | null }>(
    client,
    `entitlements?select=tier,expires_at&player_id=eq.${encodeURIComponent(profile.id)}&is_active=eq.true`,
  )
  let plan: PlanTier = 'free'
  for (const row of rows) {
    const tier = String(row.tier || '').toLowerCase() as PlanTier
    if (!(tier in PLAN_RANK)) continue
    if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) continue
    if (PLAN_RANK[tier] > PLAN_RANK[plan]) plan = tier
  }
  return plan
}

/**
 * Contenido exclusivo. El servidor (RLS de `plan_content`) solo devuelve las filas del plan del
 * usuario y de los inferiores; el cliente nunca decide qué está desbloqueado.
 */
export async function fetchPlanContent(client: SupabaseClient): Promise<PlanContentItem[]> {
  const rows = await getRows<{
    id: string; tier: PaidTier; kind: PlanContentItem['kind']; title: string; body: string | null
    cta_label: string | null; cta_url: string | null; sort_order: number
  }>(client, 'plan_content?select=id,tier,kind,title,body,cta_label,cta_url,sort_order&order=sort_order.asc')
  return rows.map((row) => ({
    id: row.id, tier: row.tier, kind: row.kind, title: row.title, body: row.body,
    ctaLabel: row.cta_label, ctaUrl: row.cta_url, sortOrder: row.sort_order,
  }))
}

/** Las rutas internas de la web (#/...) se abren en la web oficial desde el escritorio. */
export function resolvePlanUrl(url: string | null): string | null {
  if (!url) return null
  if (url.startsWith('https://')) return url
  if (url.startsWith('#/')) return `https://vantcall-esports1.pplx.app/${url}`
  return null
}
