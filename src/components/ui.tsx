export function Splash({ message }: { message: string }) { return <div className="splash"><div className="brand-mark">V</div><strong>VANTCALL</strong><span>{message}</span></div> }
export function Avatar({ initials, url, small = false }: { initials: string; url?: string; small?: boolean }) {
  return <div className={`avatar ${small ? 'avatar-sm' : ''}`}>{url ? <img src={url} alt="" referrerPolicy="no-referrer" /> : initials}</div>
}
export function EmptyState({ title, body }: { title: string; body: string }) { return <div className="empty-state"><span className="empty-mark">—</span><strong>{title}</strong><p>{body}</p></div> }
export function GameBadge({ game }: { game: string }) { return <span className={`game-badge ${game.toLowerCase().replaceAll(' ', '')}`}>{game}</span> }
