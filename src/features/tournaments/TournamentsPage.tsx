import { Search } from 'lucide-react'
import type { Workspace } from '../../app/types'
import { EmptyState } from '../../components/ui'
import { TournamentCard } from './TournamentCard'

export function TournamentsPage({ workspace, refreshing, onRefresh }: { workspace: Workspace | null; refreshing: boolean; onRefresh: () => void }) {
  const tournaments = workspace?.tournaments ?? []
  return <>
    <section className="hero-heading">
      <div><p className="eyebrow">COMPETIR</p><h1>Torneos</h1><p className="subtitle">Torneos leídos directamente del proyecto Supabase conectado.</p></div>
      <button className="secondary-button" onClick={onRefresh} disabled={refreshing}><Search size={16} />{refreshing ? 'Actualizando…' : 'Actualizar'}</button>
    </section>
    <div className="filter-row"><span className="filter active">Todos los torneos</span><span className="filter">{tournaments.length} registros</span><span className="filter">Solo lectura</span></div>
    {tournaments.length
      ? <div className="tournament-grid large">{tournaments.map((tournament) => <TournamentCard key={tournament.id} tournament={tournament} />)}</div>
      : <div className="card"><EmptyState title={workspace?.errors.some((error) => error.startsWith('tournaments:')) ? 'No se pudo consultar la lista' : 'No hay torneos publicados'} body={workspace?.errors.some((error) => error.startsWith('tournaments:')) ? 'Supabase no devolvió una respuesta válida; revisa el error de conexión indicado arriba.' : 'La consulta GET a public.tournaments no devolvió registros. No se muestran elementos de demostración.'} /></div>}
  </>
}
