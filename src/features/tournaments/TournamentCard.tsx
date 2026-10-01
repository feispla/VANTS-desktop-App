import { Trophy, Users } from 'lucide-react'
import type { Tournament } from '../../lib/api'
import { EmptyState } from '../../components/ui'
import { formatDate, statusName } from '../../lib/format'

export function TournamentList({ tournaments, hasError }: { tournaments: Tournament[]; hasError: boolean }) {
  if (!tournaments.length) return <div className="tournament-grid"><EmptyState title={hasError ? 'No se pudo consultar torneos' : 'No hay torneos publicados'} body={hasError ? 'Consulta el estado de conexión para ver el error real de Supabase.' : 'La tabla real de torneos no contiene registros disponibles para mostrar.'} /></div>
  return <div className="tournament-grid">{tournaments.slice(0, 3).map((item) => <TournamentCard key={item.id} tournament={item} />)}</div>
}

export function TournamentCard({ tournament }: { tournament: Tournament }) {
  const tone = tournament.tier?.toLowerCase().includes('premier') ? 'purple' : 'red'
  const status = tournament.status.replaceAll('_', ' ')
  return <article className="tournament-card card"><div className={`tournament-banner ${tone}`}><Trophy size={27} /><span>{tournament.format.replaceAll('_', ' ')}</span><span className="tournament-status-tag">{statusName(tournament.status)}</span></div><div className="tournament-body"><span className="status-pill">{statusName(tournament.status)}</span><h3>{tournament.name}</h3>{tournament.description && <p className="tournament-description">{tournament.description}</p>}<div className="tournament-meta"><span><Users size={14} /> {tournament.currentParticipants} / {tournament.maxParticipants}</span><strong>{tournament.prizePool || 'Premio no especificado'}</strong></div>{tournament.startsAt && <p className="tournament-date">Inicio: {formatDate(tournament.startsAt)}</p>}<span className="visually-hidden">{status}</span></div></article>
}
