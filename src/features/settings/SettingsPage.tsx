import type { Workspace } from '../../app/types'
import type { Theme } from '../../app/types'

import { missingSupabaseSettings, supabaseProjectReady } from '../../lib/config'
import { LoginOptions, type LoginHandler } from '../auth/LoginOptions'

export function SettingsPage({ workspace, onLogin, onSignOut, theme, onToggleTheme, isOnline }: { workspace: Workspace | null; onLogin: LoginHandler; onSignOut: () => void; theme: Theme; onToggleTheme: () => void; isOnline: boolean }) {
  return <>
    <section className="hero-heading"><div><p className="eyebrow">CUENTA</p><h1>Ajustes</h1><p className="subtitle">Preferencias locales y estado de conexión a datos reales.</p></div></section>
    <div className="settings-card card">
      <div className="setting-row"><div><strong>Cuenta VANTS</strong><span>{workspace?.session ? `Conectada · ${workspace.profile?.username || 'perfil por vincular'}` : 'No hay una sesión autenticada.'}</span></div>{workspace?.session ? <button className="secondary-button" onClick={onSignOut}>Cerrar sesión</button> : <LoginOptions onLogin={onLogin} compact />}</div>
      <div className="setting-row"><div><strong>Modo sin conexión</strong><span>El estado de red se detecta en tiempo real; las últimas respuestas reales se conservan en SQLite.</span></div><span className={`setting-state ${isOnline ? 'state-good' : 'state-warn'}`}>{!isOnline ? 'Sin conexión' : workspace?.stale ? 'Caché en uso' : 'En línea'}</span></div>
      <div className="setting-row"><div><strong>Tema de la aplicación</strong><span>La preferencia se guarda en SQLite en este dispositivo.</span></div><div className="setting-control"><span className="setting-state">{theme === 'light' ? 'Claro' : 'Oscuro'}</span><button className={`toggle ${theme === 'light' ? 'on' : ''}`} onClick={onToggleTheme} aria-pressed={theme === 'light'} aria-label={theme === 'light' ? 'Cambiar a tema oscuro' : 'Cambiar a tema claro'}><span /></button></div></div>
      <div className="setting-row"><div><strong>Navegación recordada</strong><span>La última sección abierta se guarda localmente en SQLite.</span></div><span className="setting-state state-good">Activa</span></div>
      <div className="setting-row"><div><strong>Versión del cliente</strong><span>VANTCALL Desktop 0.1.1 · Sprint 5</span></div><span className="setting-state">Tauri 2</span></div>
      <div className="setting-row"><div><strong>Integración Supabase</strong><span>{supabaseProjectReady ? 'Proyecto VANTSBETA · lectura con clave pública y sesión autenticada.' : `Configuración pendiente: ${missingSupabaseSettings.join(', ')}`}</span></div><span className={`setting-state ${supabaseProjectReady ? 'state-good' : 'state-warn'}`}>{supabaseProjectReady ? 'Conectable' : 'Pendiente'}</span></div>
      <div className="setup-note"><strong>Discord OAuth</strong><p>En Supabase Auth activa el proveedor Discord y añade <code>vants://auth/callback</code> a Redirect URLs. La app intercambia el código PKCE al recibir el deep link y conserva tokens únicamente en Stronghold; la clave de Discord permanece en Supabase.</p></div>
    </div>
  </>
}
