import type { RankedMatch } from '../../lib/api'
import { formatDate, statusName } from '../../lib/format'

export function MatchRow({ match, highlighted = false }: { match: RankedMatch; highlighted?: boolean }) {
  const resultLabel = match.outcome === 'victory' ? 'Victoria' : match.outcome === 'defeat' ? 'Derrota' : match.outcome === 'draw' ? 'Empate' : match.outcome === 'cancelled' ? 'Cancelada' : statusName(match.status)
  const positive = match.mmrChange != null && match.mmrChange > 0
  const mmrLabel = match.mmrChange == null ? '— MMR' : `${match.mmrChange > 0 ? '+' : ''}${match.mmrChange} MMR`
  return <div className={`table-row ${highlighted ? 'deep-link-highlight' : ''}`} data-match-id={match.id}><div className="match-cell"><div className="game-square">V</div><div><strong>Partida clasificatoria</strong><span>{match.opponent}</span></div></div><div><span className={`result ${match.outcome === 'victory' ? 'win' : match.outcome === 'defeat' || match.outcome === 'cancelled' ? 'loss' : ''}`}>{resultLabel}</span></div><strong className={positive ? 'rating-positive' : match.mmrChange != null && match.mmrChange < 0 ? 'rating-negative' : 'muted'}>{mmrLabel}</strong><span className="muted">{formatDate(match.completedAt || match.createdAt)}</span><span className="more-button" title={match.id}>···</span></div>
}
