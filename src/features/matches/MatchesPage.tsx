import { useEffect } from 'react'
import type { Workspace } from '../../app/types'
import { EmptyState } from '../../components/ui'
import { MatchRow } from './MatchRow'
import { LoginOptions, type LoginHandler } from '../auth/LoginOptions'

export function MatchesPage({ workspace, onLogin, focusedMatchId, onClearFocus }: { workspace: Workspace | null; onLogin: LoginHandler; focusedMatchId: string | null; onClearFocus: () => void }) {
  const matches = workspace?.matches ?? []
  const hasProfile = Boolean(workspace?.session && workspace.profile)
  const hasMatchError = workspace?.errors.some((error) => error.startsWith('matches:')) ?? false
  const countsAvailable = hasProfile && (!hasMatchError || (workspace?.stale && matches.length > 0))
  const wins = matches.filter((match) => match.outcome === 'victory').length
  const completed = matches.filter((match) => ['victory', 'defeat', 'draw'].includes(match.outcome)).length
  const rate = completed ? `${((wins / completed) * 100).toFixed(1)}%` : '—'
  const focusedMatch = focusedMatchId ? matches.find((match) => match.id === focusedMatchId) : undefined
  const hasFocusedMatch = Boolean(focusedMatch)
  useEffect(() => {
    if (!focusedMatchId || !hasFocusedMatch) return
    const frame = window.requestAnimationFrame(() => {
      const row = Array.from(document.querySelectorAll<HTMLElement>('[data-match-id]')).find((item) => item.dataset.matchId === focusedMatchId)
      row?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [focusedMatchId, hasFocusedMatch])
  const emptyMessage = !workspace?.session
    ? 'Inicia sesión con Discord para consultar tu historial.'
    : !workspace.profile
      ? 'No se encontró un perfil competitivo vinculado a esta cuenta.'
      : hasMatchError && !workspace.stale
        ? 'No se pudo consultar el historial real; revisa el error de conexión indicado arriba.'
        : 'No se encontraron partidas para este jugador en ranked_matches.'
  return <>
    <section className="hero-heading"><div><p className="eyebrow">COMPETIR</p><h1>Historial de partidas</h1><p className="subtitle">Resultados y cambios de MMR consultados desde Supabase.</p></div>{workspace?.session ? <span className="source-pill">Datos del proyecto</span> : <LoginOptions onLogin={onLogin} compact />}</section>
    {focusedMatchId && <div className={`deep-link-notice ${focusedMatch ? '' : 'is-warning'}`} role="status"><div><strong>{focusedMatch ? 'Partida localizada' : 'Enlace de partida recibido'}</strong><span>{focusedMatch ? `ID ${focusedMatchId} · ${focusedMatch.opponent}` : !workspace?.session ? 'Inicia sesión con Discord para buscarla en el historial privado.' : hasMatchError && !workspace.stale ? 'No se pudo verificar ahora por un error de sincronización.' : `El ID ${focusedMatchId} no aparece en el historial visible de esta cuenta.`}</span></div><button className="icon-button" onClick={onClearFocus} aria-label="Cerrar aviso de partida">×</button></div>}
    <div className="stats-strip"><div><span>PARTIDAS CARGADAS</span><strong>{countsAvailable ? matches.length : '—'}</strong></div><div><span>VICTORIAS</span><strong className="text-green">{countsAvailable ? wins : '—'}</strong></div><div><span>WIN RATE</span><strong>{countsAvailable ? rate : '—'}</strong></div><div><span>ESTADO</span><strong className="stat-caption">{workspace?.errors.length ? 'Con errores' : workspace?.session ? 'Sincronizado' : 'No conectado'}</strong></div></div>
    <div className="table-card card full-table"><div className="table-head"><span>PARTIDA</span><span>RESULTADO</span><span>CAMBIO MMR</span><span>FECHA</span><span /></div>{matches.length ? matches.map((match) => <MatchRow key={match.id} match={match} highlighted={match.id === focusedMatchId} />) : <EmptyState title="No hay historial disponible" body={emptyMessage} />}</div>
  </>
}
