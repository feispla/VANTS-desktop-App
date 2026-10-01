import type { JSX } from 'react'
import { DiscordMark, GoogleMark, SteamMark } from '../../components/icons'
import type { LoginProvider } from '../../lib/auth'

export type LoginHandler = (provider?: LoginProvider) => void

const OPTIONS: { id: LoginProvider; label: string; Mark: () => JSX.Element }[] = [
  { id: 'discord', label: 'Discord', Mark: DiscordMark },
  { id: 'google', label: 'Google', Mark: GoogleMark },
  { id: 'steam', label: 'Steam', Mark: SteamMark },
]

/** Botones de inicio de sesión: Discord, Google y Steam (todas pasan por Supabase Auth). */
export function LoginOptions({ onLogin, busy = false, compact = false, verb = 'Continuar con' }: { onLogin: LoginHandler; busy?: boolean; compact?: boolean; verb?: string }) {
  return <div className={`login-options ${compact ? 'is-compact' : ''}`} role="group" aria-label="Iniciar sesión">
    {OPTIONS.map(({ id, label, Mark }) => <button key={id} type="button" className={`login-option login-option-${id}`} onClick={() => onLogin(id)} disabled={busy}>
      <Mark /><span>{compact ? label : `${verb} ${label}`}</span>
    </button>)}
  </div>
}
