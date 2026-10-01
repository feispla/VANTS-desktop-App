import type { UpdaterState } from '../../app/types'
import type { AnonymousAnalyticsSummary } from '../../lib/database'

export function UpdaterSettingsPanel({ enabled, isDesktop, status, version, message, progress, onCheck, onInstall }: { enabled: boolean; isDesktop: boolean; status: UpdaterState; version: string; message: string; progress: number | null; onCheck: () => void; onInstall: () => void }) {
  const statusLabel: Record<UpdaterState, string> = {
    idle: 'Listo', unavailable: 'Pendiente de configuración', checking: 'Comprobando…', current: 'Actualizado',
    available: `Versión ${version} disponible`, installing: 'Instalando…', installed: 'Instalado', error: 'No disponible',
  }
  const canCheck = isDesktop && enabled && status !== 'checking' && status !== 'installing'
  return <div className="settings-card card updater-settings-card">
    <div className="setting-row">
      <div><strong>Actualizaciones firmadas</strong><span>Consulta el feed público de instaladores y valida la firma antes de instalar. La descarga se inicia solo al pulsar Instalar.</span></div>
      <span className={`setting-state ${status === 'available' || status === 'current' ? 'state-good' : enabled ? '' : 'state-warn'}`}>{!isDesktop ? 'Solo escritorio' : statusLabel[status]}</span>
    </div>
    <div className="updater-actions">
      <button className="secondary-button" onClick={onCheck} disabled={!canCheck}>{status === 'checking' ? 'Comprobando…' : 'Buscar actualizaciones'}</button>
      {status === 'available' && <button className="primary-button" onClick={onInstall}>Instalar {version}</button>}
    </div>
    {status === 'installing' && progress !== null && <p className="updater-progress">Descargados {(progress / 1024).toFixed(0)} KB; verificando firma…</p>}
    {message && <p className={`updater-message ${status === 'error' ? 'is-error' : ''}`} role="status">{message}</p>}
    {!enabled && <p className="setup-note">El feed de release se habilita en builds firmados una vez configurados los secretos y la clave pública del mirror.</p>}
    {enabled && <p className="setup-note">Los clientes consultan latest.json en GitHub Releases. Solo las releases publicadas son visibles; los borradores no se instalan.</p>}
  </div>
}

export function NativeSettingsPanel({ enabled, onToggle, isDesktop }: { enabled: boolean; onToggle: () => void; isDesktop: boolean }) {
  return <div className="settings-card card native-settings-card">
    <div className="setting-row">
      <div><strong>Notificaciones competitivas</strong><span>Partida encontrada, resultado publicado y torneos que empiezan en los próximos 15 minutos.</span></div>
      <button className={`toggle ${enabled ? 'on' : ''}`} onClick={onToggle} aria-pressed={enabled} aria-label={enabled ? 'Desactivar notificaciones' : 'Activar notificaciones'}><span /></button>
    </div>
    <div className="setting-row">
      <div><strong>Sincronización de eventos</strong><span>Escucha eventos Realtime privados de cola; la consulta cada minuto sigue como respaldo mientras VANTCALL Desktop está abierto.</span></div>
      <span className={`setting-state ${isDesktop ? 'state-good' : 'state-warn'}`}>{isDesktop ? 'Realtime + respaldo' : 'Solo escritorio'}</span>
    </div>
    <div className="setting-row">
      <div><strong>Bandeja del sistema</strong><span>Al cerrar la ventana se oculta en la bandeja; usa “Abrir”, “Buscar partida” o “Salir” desde su menú.</span></div>
      <span className={`setting-state ${isDesktop ? 'state-good' : 'state-warn'}`}>{isDesktop ? 'Activa' : 'Solo escritorio'}</span>
    </div>
  </div>
}

export function AnalyticsSettingsPanel({ enabled, summary, onToggle, onClear, isDesktop }: { enabled: boolean; summary: AnonymousAnalyticsSummary; onToggle: () => void; onClear: () => void; isDesktop: boolean }) {
  return <div className="settings-card card analytics-settings-card">
    <div className="setting-row">
      <div><strong>Analítica anónima</strong><span>Registra solo inicios de sesión de la app y secciones usadas; es opcional y viene desactivada.</span></div>
      <button className={`toggle ${enabled ? 'on' : ''}`} onClick={onToggle} aria-pressed={enabled} aria-label={enabled ? 'Desactivar analítica anónima local' : 'Activar analítica anónima local'}><span /></button>
    </div>
    <div className="setting-row">
      <div><strong>Resumen agregado</strong><span>{summary.sessions} sesiones · {summary.features} usos de funciones. No se guarda ID de cuenta, token o contenido competitivo.</span></div>
      <button className="secondary-button" onClick={onClear} disabled={summary.sessions === 0 && summary.features === 0}>Borrar registros</button>
    </div>
    <div className="setup-note"><strong>{isDesktop ? 'Almacenamiento local SQLite' : 'Vista previa web'}</strong><p>{isDesktop ? 'Los eventos permanecen en este dispositivo y nunca se envían a Supabase ni a otro servidor. Desactivar detiene los siguientes registros; puedes borrar el historial cuando quieras.' : 'Esta vista previa mantiene los eventos solo en memoria temporal. En la app instalada se guardan en SQLite local; no se transmiten a ningún servidor.'}</p></div>
  </div>
}
