import { Crown, ExternalLink, Lock, RefreshCw } from 'lucide-react'
import type { Workspace } from '../../app/types'
import { EmptyState } from '../../components/ui'
import { PLAN_RANK, PLAN_TIERS, resolvePlanUrl, type PlanContentItem } from '../../lib/plans'
import { LoginOptions, type LoginHandler } from '../auth/LoginOptions'

const KIND_LABEL: Record<PlanContentItem['kind'], string> = { perk: 'Ventaja', link: 'Acceso', announcement: 'Aviso', code: 'Código' }
const CHECKOUT = 'https://vantcall-esports1.pplx.app/#/checkout/'

/**
 * Zona exclusiva por plan. Lo que se muestra desbloqueado viene filtrado por RLS en Supabase
 * (plan_content + current_plan_rank), así que modificar el cliente no da acceso a nada.
 */
export function PlanZonePage({ workspace, onLogin, authBusy, onOpen, refreshing, onRefresh }: {
  workspace: Workspace | null
  onLogin: LoginHandler
  authBusy: boolean
  onOpen: (url: string) => void
  refreshing: boolean
  onRefresh: () => void
}) {
  if (!workspace?.session) {
    return <section className="plan-zone">
      <div className="page-heading"><p className="eyebrow">Zona exclusiva</p><h1>Zona de plan</h1><p>Contenido reservado para BASIC, PRO y ELITE. Inicia sesión para ver lo que incluye tu plan.</p></div>
      <div className="plan-gate"><div className="plan-gate-icon"><Lock size={20} /></div><strong>Inicia sesión para entrar</strong><LoginOptions onLogin={onLogin} busy={authBusy} /></div>
    </section>
  }
  const plan = workspace.plan
  const rank = PLAN_RANK[plan]
  return <section className="plan-zone">
    <div className="page-heading heading-with-action">
      <div><p className="eyebrow">Zona exclusiva</p><h1>Zona de plan</h1><p>Se desbloquea automáticamente cuando Stripe confirma tu pago. El acceso lo valida el servidor.</p></div>
      <button className="secondary-button" onClick={onRefresh} disabled={refreshing}><RefreshCw size={16} className={refreshing ? 'spin' : ''} />Actualizar</button>
    </div>
    <div className={`plan-status plan-status-${plan}`}>
      <div className="plan-status-icon"><Crown size={20} /></div>
      <div><span>Tu plan</span><strong>{plan === 'free' ? 'GRATIS' : `VANT ${plan.toUpperCase()}`}</strong></div>
      {plan !== 'elite'
        ? <button className="primary-button" onClick={() => onOpen('https://vantcall-esports1.pplx.app/#/precios')}>Mejorar plan</button>
        : <span className="plan-max">Plan máximo</span>}
    </div>
    <div className="plan-grid">
      {PLAN_TIERS.map((tier) => {
        const unlocked = PLAN_RANK[tier.key] <= rank
        const items = workspace.planContent.filter((item) => item.tier === tier.key)
        return <article key={tier.key} className={`plan-tier plan-tier-${tier.key} ${unlocked ? 'is-unlocked' : 'is-locked'}`}>
          <header><h2>{tier.name}</h2><span className="plan-tier-tag">{tier.tag} · {unlocked ? 'DESBLOQUEADO' : 'BLOQUEADO'}</span></header>
          {unlocked
            ? items.length
              ? <ul className="plan-items">{items.map((item) => {
                  const url = resolvePlanUrl(item.ctaUrl)
                  return <li key={item.id}><div><span className="plan-kind">{KIND_LABEL[item.kind]}</span><strong>{item.title}</strong>{item.body && <p>{item.body}</p>}</div>
                    {url && item.ctaLabel && <button className="secondary-button" onClick={() => onOpen(url)}>{item.ctaLabel}<ExternalLink size={14} /></button>}</li>
                })}</ul>
              : <EmptyState title="Sin contenido todavía" body="El staff aún no ha publicado contenido para este plan." />
            : <div className="plan-locked"><Lock size={18} /><p>{tier.blurb}</p><button className="primary-button" onClick={() => onOpen(CHECKOUT + tier.key)}>Desbloquear · {tier.price} €</button></div>}
        </article>
      })}
    </div>
  </section>
}
