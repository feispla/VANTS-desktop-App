import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bell, ChevronDown, CircleHelp, Crown, Gamepad2, LayoutDashboard, LogOut, Menu, Search, Settings, ShieldCheck, Swords, Trophy, UserRound, Users, X, Zap } from 'lucide-react'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import './App.css'
import { fetchMatches, fetchProfile, fetchQueue, fetchRank, fetchTournaments, type CompetitiveRank, type PlayerProfile, type QueueEntry, type RankedMatch, type Tournament } from './lib/api'
import { createSupabaseClient, signInWithDiscord } from './lib/auth'
import { supabaseProjectReady, missingSupabaseSettings } from './lib/config'
import { openLocalDatabase, type LocalDatabase, type LocalNotification } from './lib/database'
import { requestCompetitiveNotificationPermission, sendCompetitiveNotification } from './lib/notifications'
import { createAuthStorage } from './lib/secure-storage'
import { checkForDesktopUpdate, installDesktopUpdate, updaterBuildEnabled, type DesktopDownloadEvent, type DesktopUpdate } from './lib/updater'

type Page = 'dashboard' | 'matches' | 'tournaments' | 'profile' | 'settings'
type Toast = { kind: 'success' | 'error' | 'info'; message: string }
type UpdaterState = 'idle' | 'unavailable' | 'checking' | 'current' | 'available' | 'installing' | 'installed' | 'error'
type Workspace = {
  client: SupabaseClient
  db: LocalDatabase
  session: Session | null
  profile: PlayerProfile | null
  matches: RankedMatch[]
  rank: CompetitiveRank | null
  queue: QueueEntry | null
  tournaments: Tournament[]
  notifications: LocalNotification[]
  errors: string[]
  stale: boolean
}

type ResourceResult<T> = { value: T; error?: string; stale?: boolean }
type NotificationSnapshot = { queue: QueueEntry | null; matches: RankedMatch[]; tournaments: Tournament[] }
type NativeNotificationCandidate = Pick<LocalNotification, 'id' | 'kind' | 'title' | 'body'>

const EMPTY_WORKSPACE: Omit<Workspace, 'client' | 'db'> = {
  session: null, profile: null, matches: [], rank: null, queue: null, tournaments: [],
  notifications: [], errors: [], stale: false,
}

const navItems: { id: Page; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'dashboard', label: 'Inicio', icon: LayoutDashboard },
  { id: 'matches', label: 'Partidas', icon: Swords },
  { id: 'tournaments', label: 'Torneos', icon: Trophy },
  { id: 'profile', label: 'Mi perfil', icon: UserRound },
]

async function withCache<T>(db: LocalDatabase, key: string, userId: string, loader: () => Promise<T>): Promise<ResourceResult<T>> {
  try {
    const value = await loader()
    await db.writeCache(key, userId, value)
    return { value }
  } catch (error) {
    const cached = await db.readCache<T>(key, userId).catch(() => null)
    if (cached !== null) return { value: cached, error: 'Sin conexión: se muestran los últimos datos reales guardados localmente.', stale: true }
    throw error
  }
}

function collectNativeNotifications(previous: NotificationSnapshot | null, current: NotificationSnapshot, now: Date): NativeNotificationCandidate[] {
  const events: NativeNotificationCandidate[] = []
  const isRecent = (value: string | null, windowMs: number) => {
    if (!value) return false
    const timestamp = Date.parse(value)
    const age = now.getTime() - timestamp
    return Number.isFinite(timestamp) && age >= 0 && age <= windowMs
  }

  if (current.queue?.status === 'matched') {
    const transitioned = previous
      ? previous.queue?.status !== 'matched' || previous.queue.createdAt !== current.queue.createdAt
      : isRecent(current.queue.createdAt, 10 * 60_000)
    if (transitioned) events.push({
      id: `queue-found-${current.queue.createdAt ?? 'unknown'}`,
      kind: 'match_found',
      title: 'Partida encontrada',
      body: 'La cola competitiva informa que tu entrada fue emparejada.',
    })
  }

  const publishedOutcomes = ['victory', 'defeat', 'draw']
  for (const match of current.matches) {
    if (!publishedOutcomes.includes(match.outcome)) continue
    const prior = previous?.matches.find((item) => item.id === match.id)
    const changedToPublished = previous
      ? !prior || !publishedOutcomes.includes(prior.outcome)
      : isRecent(match.completedAt || match.createdAt, 5 * 60_000)
    if (!changedToPublished) continue
    const result = match.outcome === 'victory' ? 'Victoria' : match.outcome === 'defeat' ? 'Derrota' : 'Empate'
    events.push({
      id: `match-result-${match.id}-${match.outcome}`,
      kind: 'result_published',
      title: 'Resultado publicado',
      body: `${result} contra ${match.opponent}.`,
    })
  }

  for (const tournament of current.tournaments) {
    if (!tournament.startsAt || ['cancelled', 'closed', 'completed'].includes(tournament.status)) continue
    const startsAt = Date.parse(tournament.startsAt)
    const remaining = startsAt - now.getTime()
    if (!Number.isFinite(startsAt) || remaining <= 0 || remaining > 15 * 60_000) continue
    events.push({
      id: `tournament-start-${tournament.id}-${tournament.startsAt}`,
      kind: 'tournament_start',
      title: 'El torneo empieza pronto',
      body: `${tournament.name} empieza en ${Math.max(1, Math.ceil(remaining / 60_000))} min.`,
    })
  }

  return events
}

function App() {
  const [page, setPage] = useState<Page>('dashboard')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [initializing, setInitializing] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [authBusy, setAuthBusy] = useState(false)
  const [initError, setInitError] = useState('')
  const [notificationsEnabled, setNotificationsEnabled] = useState(true)
  const [updaterState, setUpdaterState] = useState<UpdaterState>('idle')
  const [updaterVersion, setUpdaterVersion] = useState('')
  const [updaterMessage, setUpdaterMessage] = useState('')
  const [updaterProgress, setUpdaterProgress] = useState<number | null>(null)
  const refreshInFlightRef = useRef(false)
  const notificationEnabledRef = useRef(true)
  const notificationSnapshotRef = useRef<NotificationSnapshot | null>(null)
  const updaterRef = useRef<DesktopUpdate | null>(null)
  const updaterInFlightRef = useRef(false)

  const refresh = useCallback(async (client: SupabaseClient, db: LocalDatabase, session: Session | null, silent = false) => {
    if (refreshInFlightRef.current) return
    refreshInFlightRef.current = true
    if (!silent) setRefreshing(true)
    try {
      const userId = session?.user.id ?? 'public'
      const errors: string[] = []
      const staleFlags: boolean[] = []
      const load = async <T,>(key: string, loader: () => Promise<T>): Promise<T | null> => {
        try {
          const result = await withCache(db, key, userId, loader)
          if (result.error) errors.push(`${key}: ${result.error}`)
          if (result.stale) staleFlags.push(true)
          return result.value
        } catch (error) {
          errors.push(`${key}: ${error instanceof Error ? error.message : 'No se pudieron leer los datos del servicio.'}`)
          return null
        }
      }

      const tournaments = await load('tournaments', () => fetchTournaments(client)) ?? []
      let profile: PlayerProfile | null = null
      let matches: RankedMatch[] = []
      let rank: CompetitiveRank | null = null
      let queue: QueueEntry | null = null

      if (session) {
        profile = await load('profile', () => fetchProfile(client, session.user))
        if (profile) {
          const [loadedMatches, loadedRank, loadedQueue] = await Promise.all([
            load('matches', () => fetchMatches(client, profile as PlayerProfile)),
            load('rank', () => fetchRank(client, profile as PlayerProfile)),
            load('queue', () => fetchQueue(client, profile as PlayerProfile)),
          ])
          matches = loadedMatches ?? []
          rank = loadedRank
          queue = loadedQueue
        }
      }

      const snapshot = { queue, matches, tournaments }
      const previousSnapshot = notificationSnapshotRef.current
      notificationSnapshotRef.current = snapshot
      const notifications: LocalNotification[] = await db.listNotifications().catch(() => [] as LocalNotification[])
      if (!staleFlags.length && !errors.length && isTauri()) {
        for (const candidate of collectNativeNotifications(previousSnapshot, snapshot, new Date())) {
          if (!notificationEnabledRef.current) continue
          if (await db.hasNotification(candidate.id).catch(() => false)) continue
          const notification: LocalNotification = { ...candidate, created_at: new Date().toISOString(), read_at: null }
          try {
            await db.saveNotification(notification)
          } catch {
            continue
          }
          notifications.unshift(notification)
          if (notificationEnabledRef.current) {
            const sent = await sendCompetitiveNotification(notification.title, notification.body).catch(() => false)
            if (!sent) {
              notificationEnabledRef.current = false
              setNotificationsEnabled(false)
              await db.setSetting('notifications_enabled', 'false').catch(() => undefined)
            }
          }
        }
      }
      setWorkspace({ client, db, session, profile, matches, rank, queue, tournaments, notifications, errors, stale: staleFlags.length > 0 })
    } finally {
      refreshInFlightRef.current = false
      if (!silent) setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    let disposed = false
    let unsubscribe: (() => void) | undefined

    async function initialize() {
      if (!supabaseProjectReady) {
        setInitializing(false)
        setInitError(`Falta configurar ${missingSupabaseSettings.join(' y ')}. Copia .env.example a .env.local y completa la clave pública/anon de Supabase.`)
        return
      }
      try {
        const storage = await createAuthStorage()
        const db = await openLocalDatabase()
        const client = createSupabaseClient(storage)
        const savedPage = await db.getSetting('last_page').catch(() => null)
        const savedNotifications = await db.getSetting('notifications_enabled').catch(() => null)
        const notificationsAreEnabled = savedNotifications !== 'false'
        notificationEnabledRef.current = notificationsAreEnabled
        setNotificationsEnabled(notificationsAreEnabled)
        if (savedPage && ['dashboard', 'matches', 'tournaments', 'profile', 'settings'].includes(savedPage)) setPage(savedPage as Page)
        if (disposed) return

        const { data, error } = await client.auth.getSession()
        if (error) throw error
        let activeUserId = data.session?.user.id
        if (data.session) await db.saveSession(data.session.user.id, data.session.expires_at ?? null)
        await refresh(client, db, data.session)
        if (disposed) return
        unsubscribe = client.auth.onAuthStateChange((event, session) => {
          if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
            window.setTimeout(() => {
              if (session) {
                activeUserId = session.user.id
                void db.saveSession(session.user.id, session.expires_at ?? null)
              } else if (event === 'SIGNED_OUT' && activeUserId) {
                const signedOutUserId = activeUserId
                activeUserId = undefined
                void db.clearSession(signedOutUserId)
              }
              void refresh(client, db, session)
            }, 0)
          }
        }).data.subscription.unsubscribe
        setWorkspace((current) => ({
          ...(current ?? { ...EMPTY_WORKSPACE, client, db }), client, db,
          session: data.session,
        }))
      } catch (error) {
        if (!disposed) setInitError(error instanceof Error ? error.message : 'No se pudo inicializar VANTCALL Desktop.')
      } finally {
        if (!disposed) setInitializing(false)
      }
    }

    void initialize()
    return () => { disposed = true; unsubscribe?.() }
  }, [refresh])

  const pollingClient = workspace?.client ?? null
  const pollingDb = workspace?.db ?? null
  const pollingSession = workspace?.session ?? null

  useEffect(() => {
    if (!pollingClient || !pollingDb) return
    const timer = window.setInterval(() => {
      void refresh(pollingClient, pollingDb, pollingSession, true)
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [pollingClient, pollingDb, pollingSession, refresh])

  useEffect(() => {
    if (!isTauri()) return
    let cancelled = false
    let unlisten: (() => void) | undefined
    void listen<string>('tray-action', (event) => {
      if (event.payload !== 'find-match') return
      setPage('dashboard')
      setMobileOpen(false)
      window.setTimeout(() => document.querySelector('.queue-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 220)
    }).then((stopListening) => {
      if (cancelled) stopListening()
      else unlisten = stopListening
    })
    return () => { cancelled = true; unlisten?.() }
  }, [])

  const pageTitle = useMemo(() => ({ dashboard: 'Resumen competitivo', matches: 'Historial de partidas', tournaments: 'Torneos', profile: 'Mi perfil', settings: 'Ajustes' })[page], [page])
  const notify = useCallback((kind: Toast['kind'], message: string) => {
    setToast({ kind, message })
    window.setTimeout(() => setToast(null), 4200)
  }, [])
  const handleCheckForUpdates = useCallback(async (silent = false) => {
    if (!isTauri() || !updaterBuildEnabled) {
      const message = 'El feed firmado se activará cuando se configure el mirror de distribución.'
      setUpdaterState('unavailable')
      setUpdaterMessage(message)
      if (!silent) notify('info', message)
      return
    }
    if (updaterInFlightRef.current) return
    updaterInFlightRef.current = true
    setUpdaterState('checking')
    setUpdaterMessage('')
    setUpdaterProgress(null)
    try {
      const next = await checkForDesktopUpdate()
      const previous = updaterRef.current
      updaterRef.current = next
      if (previous && previous !== next) await previous.close().catch(() => undefined)
      if (next) {
        setUpdaterVersion(next.version)
        setUpdaterState('available')
        setUpdaterMessage(`Versión ${next.version} lista para revisar e instalar.`)
        notify('info', `VANTCALL Desktop ${next.version} está disponible.`)
      } else {
        setUpdaterVersion('')
        setUpdaterState('current')
        setUpdaterMessage('Tienes instalada la versión más reciente publicada.')
        if (!silent) notify('success', 'VANTCALL Desktop está actualizado.')
      }
    } catch (error) {
      setUpdaterState('error')
      setUpdaterMessage(error instanceof Error ? error.message : 'No se pudo consultar el feed firmado.')
      if (!silent) notify('error', 'No se pudo consultar el feed de actualizaciones.')
    } finally {
      updaterInFlightRef.current = false
    }
  }, [notify])
  const handleInstallUpdate = useCallback(async () => {
    const update = updaterRef.current
    if (!update) return
    setUpdaterState('installing')
    setUpdaterProgress(0)
    setUpdaterMessage('Descargando y verificando la firma del instalador…')
    let downloaded = 0
    try {
      await installDesktopUpdate(update, (event: DesktopDownloadEvent) => {
        if (event.event === 'Started') setUpdaterProgress(0)
        if (event.event === 'Progress') {
          downloaded += event.data.chunkLength
          setUpdaterProgress(downloaded)
        }
      })
      updaterRef.current = null
      await update.close().catch(() => undefined)
      setUpdaterVersion('')
      setUpdaterState('installed')
      setUpdaterMessage('Actualización instalada. La aplicación se reiniciará para finalizar.')
      notify('success', 'Actualización instalada correctamente.')
    } catch (error) {
      setUpdaterState('available')
      setUpdaterMessage(error instanceof Error ? error.message : 'No se pudo instalar la actualización firmada.')
      notify('error', 'No se pudo instalar la actualización.')
    }
  }, [notify])
  const handleToggleNotifications = async () => {
    const next = !notificationsEnabled
    if (next && !isTauri()) {
      notify('info', 'Las notificaciones nativas están disponibles en la aplicación de escritorio instalada.')
      return
    }
    if (next && !await requestCompetitiveNotificationPermission().catch(() => false)) {
      notify('error', 'El sistema no concedió permiso para mostrar notificaciones.')
      return
    }
    notificationEnabledRef.current = next
    setNotificationsEnabled(next)
    await workspace?.db.setSetting('notifications_enabled', String(next)).catch(() => undefined)
    notify('success', next ? 'Notificaciones competitivas activadas.' : 'Notificaciones competitivas desactivadas.')
  }
  const navigate = (next: Page) => { setPage(next); setMobileOpen(false); void workspace?.db.setSetting('last_page', next) }

  const handleDiscordLogin = async () => {
    if (!workspace) return
    if (!isTauri()) {
      notify('info', 'El inicio de sesión Discord está disponible al ejecutar la app de escritorio.')
      return
    }
    setAuthBusy(true)
    try {
      await signInWithDiscord(workspace.client)
      notify('success', 'Sesión Discord iniciada.')
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'No se pudo iniciar sesión con Discord.')
    } finally {
      setAuthBusy(false)
    }
  }

  const handleSignOut = async () => {
    if (!workspace) return
    setAuthBusy(true)
    const userId = workspace.session?.user.id
    const { error } = await workspace.client.auth.signOut()
    if (userId) await workspace.db.clearSession(userId).catch(() => undefined)
    setAuthBusy(false)
    if (error) notify('error', error.message)
    else notify('success', 'Sesión cerrada y caché privada local eliminada.')
  }

  useEffect(() => {
    if (!isTauri() || !updaterBuildEnabled) return
    const timer = window.setTimeout(() => { void handleCheckForUpdates(true) }, 4_000)
    return () => window.clearTimeout(timer)
  }, [handleCheckForUpdates])

  useEffect(() => () => { void updaterRef.current?.close().catch(() => undefined) }, [])

  const accountName = workspace?.profile?.display_name || workspace?.profile?.username || String(workspace?.session?.user.user_metadata?.full_name || workspace?.session?.user.user_metadata?.name || '') || 'Cuenta VANTCALL'
  const initials = accountName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'V'
  const dataMode = workspace?.stale ? 'Caché local' : workspace?.errors.length ? 'Conexión limitada' : workspace?.session ? 'Supabase · sesión' : 'Supabase · público'

  if (initializing) return <Splash message="Preparando tu espacio competitivo…" />

  return <div className="app-shell">
    <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
      <div className="brand-row"><div className="brand-mark">V</div><div><strong>VANTCALL</strong><span>DESKTOP</span></div><button className="icon-button close-mobile" onClick={() => setMobileOpen(false)} aria-label="Cerrar menú"><X size={18} /></button></div>
      <div className="profile-mini"><Avatar initials={initials} url={workspace?.profile?.avatar_url || String(workspace?.session?.user.user_metadata?.avatar_url || '')} small /><div className="profile-mini-copy"><strong>{workspace?.session ? accountName : 'Sin iniciar sesión'}</strong><span><span className={`online-dot ${workspace?.session ? '' : 'offline-dot'}`} />{workspace?.session ? 'Cuenta conectada' : 'Conecta Discord'}</span></div><ChevronDown size={16} className="muted" /></div>
      <nav className="main-nav"><p className="nav-label">COMPETIR</p>{navItems.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${page === id ? 'active' : ''}`} onClick={() => navigate(id)}><Icon size={18} /><span>{label}</span>{id === 'matches' && workspace?.matches.length ? <span className="nav-count">{workspace.matches.length}</span> : null}</button>)}<p className="nav-label nav-spacer">CUENTA</p><button className={`nav-item ${page === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')}><Settings size={18} /><span>Ajustes</span></button><button className="nav-item" onClick={() => notify('info', 'La ayuda de VANTCALL se abrirá desde el portal oficial.')}><CircleHelp size={18} /><span>Ayuda</span></button></nav>
      <div className="sidebar-bottom"><div className="pro-card"><div className="pro-icon"><Crown size={18} /></div><div><strong>VANTCALL</strong><p>Tu plataforma competitiva</p></div><ChevronDown size={15} /></div>{workspace?.session ? <button className="nav-item logout" onClick={() => void handleSignOut()} disabled={authBusy}><LogOut size={18} /><span>Cerrar sesión</span></button> : <button className="nav-item logout" onClick={() => void handleDiscordLogin()} disabled={authBusy}><UserRound size={18} /><span>Iniciar con Discord</span></button>}</div>
    </aside>

    <main className="main-content">
      <header className="topbar"><button className="icon-button menu-mobile" onClick={() => setMobileOpen(true)} aria-label="Abrir menú"><Menu size={20} /></button><div className="breadcrumb"><span>VANTCALL</span><span className="slash">/</span><strong>{pageTitle}</strong></div><div className="connection-chip"><span className={`connection-dot ${workspace?.stale ? 'warning' : ''}`} />{dataMode}</div><div className="top-actions"><button className="icon-button" onClick={() => setNotificationsOpen((value) => !value)} aria-label="Notificaciones"><Bell size={19} />{workspace?.notifications.length ? <span className="notification-dot" /> : null}</button><Avatar initials={initials} url={workspace?.profile?.avatar_url || String(workspace?.session?.user.user_metadata?.avatar_url || '')} /></div>{notificationsOpen && <div className="notification-popover"><strong>Notificaciones locales</strong>{workspace?.notifications.length ? workspace.notifications.map((item) => <p key={item.id}><span className="notification-red" />{item.title}<small>{item.body}</small></p>) : <p className="muted-copy">No hay notificaciones guardadas.</p>}</div>}</header>
      <div className="page-wrap">
        {initError && <div className="alert-card" role="alert"><strong>No se pudo conectar</strong><p>{initError}</p><button className="secondary-button" onClick={() => window.location.reload()}>Volver a intentar</button></div>}
        {workspace?.errors.map((error, index) => <div className={`inline-alert ${workspace.stale ? 'is-warning' : ''}`} key={`${index}-${error}`}><ShieldCheck size={16} /><span>{error}</span></div>)}
        {!initError && page === 'dashboard' && <Dashboard workspace={workspace} refreshing={refreshing} onRefresh={() => workspace && void refresh(workspace.client, workspace.db, workspace.session)} onLogin={() => void handleDiscordLogin()} onNavigate={navigate} />}
        {!initError && page === 'matches' && <MatchesPage workspace={workspace} onLogin={() => void handleDiscordLogin()} />}
        {!initError && page === 'tournaments' && <TournamentsPage workspace={workspace} refreshing={refreshing} onRefresh={() => workspace && void refresh(workspace.client, workspace.db, workspace.session)} />}
        {!initError && page === 'profile' && <ProfilePage workspace={workspace} onLogin={() => void handleDiscordLogin()} />}
        {!initError && page === 'settings' && <><SettingsPage workspace={workspace} onLogin={() => void handleDiscordLogin()} onSignOut={() => void handleSignOut()} /><NativeSettingsPanel enabled={notificationsEnabled} onToggle={() => void handleToggleNotifications()} isDesktop={isTauri()} /><UpdaterSettingsPanel enabled={updaterBuildEnabled} isDesktop={isTauri()} status={updaterState} version={updaterVersion} message={updaterMessage} progress={updaterProgress} onCheck={() => void handleCheckForUpdates()} onInstall={() => void handleInstallUpdate()} /></>}
      </div>
    </main>
    {toast && <div className={`toast toast-${toast.kind}`} role="status"><span className="toast-check">{toast.kind === 'error' ? '!' : toast.kind === 'info' ? 'i' : '✓'}</span>{toast.message}</div>}
  </div>
}

function Splash({ message }: { message: string }) { return <div className="splash"><div className="brand-mark">V</div><strong>VANTCALL</strong><span>{message}</span></div> }

function Avatar({ initials, url, small = false }: { initials: string; url?: string; small?: boolean }) {
  return <div className={`avatar ${small ? 'avatar-sm' : ''}`}>{url ? <img src={url} alt="" referrerPolicy="no-referrer" /> : initials}</div>
}

function Dashboard({ workspace, refreshing, onRefresh, onLogin, onNavigate }: { workspace: Workspace | null; refreshing: boolean; onRefresh: () => void; onLogin: () => void; onNavigate: (page: Page) => void }) {
  const profile = workspace?.profile
  const rank = workspace?.rank
  const wins = rank?.wins ?? null
  const losses = rank?.losses ?? null
  const rankedTotal = wins !== null && losses !== null ? wins + losses : null
  const queueError = workspace?.errors.some((error) => error.startsWith('queue:')) ?? false
  const queueLabel = !workspace?.session ? 'Conecta Discord' : !profile ? 'Perfil sin vincular' : workspace.queue?.status === 'matched' ? 'Partida encontrada' : workspace.queue ? 'En cola' : queueError ? 'Estado no disponible' : 'Sin búsqueda activa'
  const queueCopy = workspace?.queue?.status === 'matched' ? 'Supabase informa que tu entrada real ya fue emparejada.' : workspace?.queue ? `Estado real de cola: ${workspace.queue.status}.` : !workspace?.session ? 'Conecta Discord para consultar tu estado personal de cola.' : !profile ? 'Se necesita un perfil de jugador asociado para consultar la cola.' : queueError ? 'No se pudo consultar el estado real de la cola.' : 'No hay una entrada activa en tu cola competitiva.'
  return <>
    <section className="hero-heading"><div><p className="eyebrow">VANTCALL · CIRCUITO COMPETITIVO</p><h1>{profile ? `Buenas, ${profile.display_name || profile.username}` : workspace?.session ? 'Tu cuenta VANTCALL' : 'Compite en VANTCALL'} <span className="wave">✦</span></h1><p className="subtitle">{profile ? 'Tu estado competitivo sincronizado con los datos del proyecto.' : 'Conecta tu cuenta para consultar perfil, rango e historial reales.'}</p></div><button className="secondary-button" onClick={onRefresh} disabled={refreshing}><Search size={16} />{refreshing ? 'Actualizando…' : 'Actualizar datos'}</button></section>
    {!workspace?.session && <section className="auth-banner card"><div><p className="eyebrow">ACCESO SEGURO</p><h2>Vincula tu identidad de jugador</h2><p>Inicia sesión con Discord. El token se guarda cifrado en Stronghold y nunca en localStorage.</p></div><button className="primary-button" onClick={onLogin}><DiscordMark />{`Continuar con Discord`}<span>→</span></button></section>}
    <section className="dashboard-grid"><div className="rank-card card"><div className="card-heading"><div><p className="eyebrow">RANGO VANTS{profile?.main_game ? ` · ${gameName(profile.main_game)}` : ''}</p><h2>{rank?.rank || 'Sin rango registrado'}</h2></div><div className="rank-emblem"><Zap size={27} /></div></div><div className="rank-progress"><div className="progress-label"><span>{rank?.mmr != null ? `${rank.mmr.toLocaleString('es')} MMR` : 'MMR no disponible'}</span><span>{rank?.season || 'Sin temporada activa'}</span></div><div className="rank-progress-placeholder" /><p>{rank ? `${wins ?? '—'} victorias · ${losses ?? '—'} derrotas${rankedTotal ? ` · ${((wins! / rankedTotal) * 100).toFixed(1)}% de victorias` : ''}` : 'El rango aparecerá cuando exista una estadística de temporada para tu perfil.'}</p><p className="progress-note">{rank ? 'El proyecto no publica progreso al siguiente rango.' : ''}</p></div><div className="rank-footer"><span><span className="green-dot" />{rank?.placementDone ? 'Clasificación completada' : rank ? 'Clasificación no publicada' : 'Sin datos de temporada'}</span><button onClick={() => onNavigate('profile')}>Ver perfil <span>→</span></button></div></div>
      <div className="queue-card card"><div className="card-heading"><div><p className="eyebrow">COLA CLASIFICATORIA</p><h2>{queueLabel}</h2></div><Gamepad2 size={24} className="red-icon" /></div><p className="card-copy">{queueCopy}</p><div className="queue-select"><GameBadge game={profile?.main_game ? gameName(profile.main_game) : 'Sin juego configurado'} /><span>{workspace?.queue ? `Creada ${formatDate(workspace.queue.createdAt)}` : 'La cola requiere el servicio oficial de matchmaking'}</span><ChevronDown size={16} /></div><button className="primary-button disabled-button" disabled title="El cliente de escritorio no enviará escrituras a la cola de Supabase."><Swords size={18} />Servicio de cola no disponible<span>—</span></button><div className="queue-meta"><span><ShieldCheck size={14} />Solo lectura; sin escrituras a Supabase</span><span>API pendiente</span></div></div></section>
    <section className="section-header"><div><p className="eyebrow">ACTIVIDAD COMPETITIVA</p><h2>Últimas partidas</h2></div><button className="link-button" onClick={() => onNavigate('matches')}>Ver historial <span>→</span></button></section>
    <div className="table-card card"><div className="table-head"><span>PARTIDA</span><span>RESULTADO</span><span>CAMBIO MMR</span><span>FECHA</span><span /></div>{workspace?.matches.length ? workspace.matches.slice(0, 3).map((match) => <MatchRow key={match.id} match={match} />) : <EmptyState title="Sin partidas registradas" body={profile ? 'No se encontraron partidas clasificatorias asociadas a tu jugador.' : 'Las partidas reales aparecerán aquí después de vincular un perfil.'} />}</div>
    <section className="section-header tournament-header"><div><p className="eyebrow">COMPETICIÓN</p><h2>Torneos del proyecto</h2></div><button className="link-button" onClick={() => onNavigate('tournaments')}>Explorar <span>→</span></button></section>
    <TournamentList tournaments={workspace?.tournaments ?? []} hasError={workspace?.errors.some((error) => error.startsWith('tournaments:')) ?? false} />
  </>
}

function MatchRow({ match }: { match: RankedMatch }) {
  const resultLabel = match.outcome === 'victory' ? 'Victoria' : match.outcome === 'defeat' ? 'Derrota' : match.outcome === 'draw' ? 'Empate' : match.outcome === 'cancelled' ? 'Cancelada' : statusName(match.status)
  const positive = match.mmrChange != null && match.mmrChange > 0
  const mmrLabel = match.mmrChange == null ? '— MMR' : `${match.mmrChange > 0 ? '+' : ''}${match.mmrChange} MMR`
  return <div className="table-row"><div className="match-cell"><div className="game-square">V</div><div><strong>Partida clasificatoria</strong><span>{match.opponent}</span></div></div><div><span className={`result ${match.outcome === 'victory' ? 'win' : match.outcome === 'defeat' || match.outcome === 'cancelled' ? 'loss' : ''}`}>{resultLabel}</span></div><strong className={positive ? 'rating-positive' : match.mmrChange != null && match.mmrChange < 0 ? 'rating-negative' : 'muted'}>{mmrLabel}</strong><span className="muted">{formatDate(match.completedAt || match.createdAt)}</span><span className="more-button" title={match.id}>···</span></div>
}

function TournamentList({ tournaments, hasError }: { tournaments: Tournament[]; hasError: boolean }) {
  if (!tournaments.length) return <div className="tournament-grid"><EmptyState title={hasError ? 'No se pudo consultar torneos' : 'No hay torneos publicados'} body={hasError ? 'Consulta el estado de conexión para ver el error real de Supabase.' : 'La tabla real de torneos no contiene registros disponibles para mostrar.'} /></div>
  return <div className="tournament-grid">{tournaments.slice(0, 3).map((item) => <TournamentCard key={item.id} tournament={item} />)}</div>
}

function TournamentCard({ tournament }: { tournament: Tournament }) {
  const tone = tournament.tier?.toLowerCase().includes('premier') ? 'purple' : 'red'
  const status = tournament.status.replaceAll('_', ' ')
  return <article className="tournament-card card"><div className={`tournament-banner ${tone}`}><Trophy size={27} /><span>{tournament.format.replaceAll('_', ' ')}</span><span className="tournament-status-tag">{statusName(tournament.status)}</span></div><div className="tournament-body"><span className="status-pill">{statusName(tournament.status)}</span><h3>{tournament.name}</h3>{tournament.description && <p className="tournament-description">{tournament.description}</p>}<div className="tournament-meta"><span><Users size={14} /> {tournament.currentParticipants} / {tournament.maxParticipants}</span><strong>{tournament.prizePool || 'Premio no especificado'}</strong></div>{tournament.startsAt && <p className="tournament-date">Inicio: {formatDate(tournament.startsAt)}</p>}<span className="visually-hidden">{status}</span></div></article>
}

function MatchesPage({ workspace, onLogin }: { workspace: Workspace | null; onLogin: () => void }) {
  const matches = workspace?.matches ?? []
  const hasProfile = Boolean(workspace?.session && workspace.profile)
  const hasMatchError = workspace?.errors.some((error) => error.startsWith('matches:')) ?? false
  const countsAvailable = hasProfile && (!hasMatchError || (workspace?.stale && matches.length > 0))
  const wins = matches.filter((match) => match.outcome === 'victory').length
  const completed = matches.filter((match) => ['victory', 'defeat', 'draw'].includes(match.outcome)).length
  const rate = completed ? `${((wins / completed) * 100).toFixed(1)}%` : '—'
  const emptyMessage = !workspace?.session
    ? 'Inicia sesión con Discord para consultar tu historial.'
    : !workspace.profile
      ? 'No se encontró un perfil competitivo vinculado a esta cuenta.'
      : hasMatchError && !workspace.stale
        ? 'No se pudo consultar el historial real; revisa el error de conexión indicado arriba.'
        : 'No se encontraron partidas para este jugador en ranked_matches.'
  return <><section className="hero-heading"><div><p className="eyebrow">COMPETIR</p><h1>Historial de partidas</h1><p className="subtitle">Resultados y cambios de MMR consultados desde Supabase.</p></div>{workspace?.session ? <span className="source-pill">Datos del proyecto</span> : <button className="secondary-button" onClick={onLogin}><DiscordMark /> Conectar Discord</button>}</section><div className="stats-strip"><div><span>PARTIDAS CARGADAS</span><strong>{countsAvailable ? matches.length : '—'}</strong></div><div><span>VICTORIAS</span><strong className="text-green">{countsAvailable ? wins : '—'}</strong></div><div><span>WIN RATE</span><strong>{countsAvailable ? rate : '—'}</strong></div><div><span>ESTADO</span><strong className="stat-caption">{workspace?.errors.length ? 'Con errores' : workspace?.session ? 'Sincronizado' : 'No conectado'}</strong></div></div><div className="table-card card full-table"><div className="table-head"><span>PARTIDA</span><span>RESULTADO</span><span>CAMBIO MMR</span><span>FECHA</span><span /></div>{matches.length ? matches.map((match) => <MatchRow key={match.id} match={match} />) : <EmptyState title="No hay historial disponible" body={emptyMessage} />}</div></>
}

function TournamentsPage({ workspace, refreshing, onRefresh }: { workspace: Workspace | null; refreshing: boolean; onRefresh: () => void }) {
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

function ProfilePage({ workspace, onLogin }: { workspace: Workspace | null; onLogin: () => void }) {
  const profile = workspace?.profile
  const rank = workspace?.rank
  if (!workspace?.session) return <><section className="hero-heading"><div><p className="eyebrow">CUENTA</p><h1>Mi perfil</h1><p className="subtitle">Vincula Discord para buscar el jugador asociado a tu usuario de Supabase.</p></div><button className="primary-button" onClick={onLogin}><DiscordMark />Conectar Discord</button></section><div className="card"><EmptyState title="Perfil privado" body="El perfil competitivo se consulta después de autenticarte. No se inventan datos de usuario." /></div></>
  if (!profile) return <><section className="hero-heading"><div><p className="eyebrow">CUENTA</p><h1>Perfil sin vincular</h1><p className="subtitle">La sesión está activa, pero players.auth_user_id no tiene una fila asociada.</p></div></section><div className="card"><EmptyState title="No se encontró un jugador asociado" body="Comprueba el vínculo de Discord y las políticas de lectura del proyecto. Esta aplicación no crea ni modifica perfiles." /></div></>
  const initials = (profile.display_name || profile.username).split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()
  const total = rank?.wins != null && rank.losses != null ? rank.wins + rank.losses : null
  return <><section className="hero-heading"><div><p className="eyebrow">CUENTA</p><h1>Mi perfil</h1><p className="subtitle">Identidad competitiva asociada a tu cuenta de Discord.</p></div><span className="source-pill">Perfil real de Supabase</span></section><div className="profile-layout"><div className="profile-card card"><div className="profile-cover" /><div className="profile-main"><Avatar initials={initials} url={profile.avatar_url || undefined} /><div><h2>{profile.display_name || profile.username}{profile.verified && <span className="verified">✓</span>}</h2><p>@{profile.username}{profile.country ? ` · ${profile.country}` : ''}</p></div><span className="profile-status"><span className="online-dot" />Conectado</span></div><div className="profile-bio">{profile.bio || 'Este perfil no contiene una biografía.'}</div></div><div className="profile-side card"><p className="eyebrow">RANGO COMPETITIVO</p><div className="profile-rank"><div className="rank-emblem small"><Zap size={19} /></div><div><strong>{rank?.rank || 'Sin rango registrado'}</strong><span>{rank?.mmr != null ? `${rank.mmr.toLocaleString('es')} MMR` : 'MMR no disponible'}</span></div></div><div className="mini-stat-row"><span>{rank?.season || 'Temporada no disponible'}</span><strong>{rank?.placementDone ? 'Clasificado' : 'Sin clasificación'}</strong></div></div></div><div className="section-header"><div><p className="eyebrow">ESTADÍSTICAS</p><h2>Rendimiento registrado</h2></div></div><div className="stats-strip profile-stats"><div><span>PARTIDAS</span><strong>{total ?? '—'}</strong></div><div><span>VICTORIAS</span><strong className="text-green">{rank?.wins ?? '—'}</strong></div><div><span>DERROTAS</span><strong>{rank?.losses ?? '—'}</strong></div><div><span>REGIÓN</span><strong className="stat-caption">{profile.region || '—'}</strong></div></div></>
}

function SettingsPage({ workspace, onLogin, onSignOut }: { workspace: Workspace | null; onLogin: () => void; onSignOut: () => void }) {
  return <><section className="hero-heading"><div><p className="eyebrow">CUENTA</p><h1>Ajustes</h1><p className="subtitle">Configuración local y estado de la conexión a datos reales.</p></div></section><div className="settings-card card"><div className="setting-row"><div><strong>Cuenta Discord</strong><span>{workspace?.session ? `Conectada · ${workspace.profile?.username || 'perfil por vincular'}` : 'No hay una sesión autenticada.'}</span></div>{workspace?.session ? <button className="secondary-button" onClick={onSignOut}>Cerrar sesión</button> : <button className="secondary-button" onClick={onLogin}><DiscordMark /> Conectar</button>}</div><div className="setting-row"><div><strong>Modo sin conexión</strong><span>Las últimas respuestas reales se guardan en SQLite; no se crean datos ficticios.</span></div><span className="setting-state">{workspace?.stale ? 'Caché en uso' : 'Preparado'}</span></div><div className="setting-row"><div><strong>Navegación recordada</strong><span>La última sección abierta se guarda localmente en SQLite.</span></div><span className="setting-state state-good">Activa</span></div><div className="setting-row"><div><strong>Versión del cliente</strong><span>VANTCALL Desktop 0.1.0 · Sprint 1</span></div><span className="setting-state">Tauri 2</span></div><div className="setting-row"><div><strong>Integración Supabase</strong><span>{supabaseProjectReady ? 'Proyecto VANTSBETA · lectura con clave pública y sesión autenticada.' : `Configuración pendiente: ${missingSupabaseSettings.join(', ')}`}</span></div><span className={`setting-state ${supabaseProjectReady ? 'state-good' : 'state-warn'}`}>{supabaseProjectReady ? 'Conectable' : 'Pendiente'}</span></div><div className="setup-note"><strong>Discord OAuth</strong><p>En Supabase Auth activa el proveedor Discord y añade <code>http://localhost:*/**</code> a Redirect URLs. La app intercambia el código PKCE y conserva tokens únicamente en Stronghold; la clave de Discord permanece en Supabase.</p></div></div></>
}

function UpdaterSettingsPanel({ enabled, isDesktop, status, version, message, progress, onCheck, onInstall }: { enabled: boolean; isDesktop: boolean; status: UpdaterState; version: string; message: string; progress: number | null; onCheck: () => void; onInstall: () => void }) {
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

function NativeSettingsPanel({ enabled, onToggle, isDesktop }: { enabled: boolean; onToggle: () => void; isDesktop: boolean }) {
  return <div className="settings-card card native-settings-card">
    <div className="setting-row">
      <div><strong>Notificaciones competitivas</strong><span>Partida encontrada, resultado publicado y torneos que empiezan en los próximos 15 minutos.</span></div>
      <button className={`toggle ${enabled ? 'on' : ''}`} onClick={onToggle} aria-pressed={enabled} aria-label={enabled ? 'Desactivar notificaciones' : 'Activar notificaciones'}><span /></button>
    </div>
    <div className="setting-row">
      <div><strong>Sincronización de eventos</strong><span>Consulta los datos reales cada minuto mientras VANTCALL Desktop está abierto, también en la bandeja. No opera si sales de la aplicación.</span></div>
      <span className={`setting-state ${isDesktop ? 'state-good' : 'state-warn'}`}>{isDesktop ? 'Cada 60 s' : 'Solo escritorio'}</span>
    </div>
    <div className="setting-row">
      <div><strong>Bandeja del sistema</strong><span>Al cerrar la ventana se oculta en la bandeja; usa “Abrir”, “Buscar partida” o “Salir” desde su menú.</span></div>
      <span className={`setting-state ${isDesktop ? 'state-good' : 'state-warn'}`}>{isDesktop ? 'Activa' : 'Solo escritorio'}</span>
    </div>
  </div>
}

function EmptyState({ title, body }: { title: string; body: string }) { return <div className="empty-state"><span className="empty-mark">—</span><strong>{title}</strong><p>{body}</p></div> }
function GameBadge({ game }: { game: string }) { return <span className={`game-badge ${game.toLowerCase().replaceAll(' ', '')}`}>{game}</span> }
function DiscordMark() { return <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19.7 5.3A18.4 18.4 0 0 0 15.2 4l-.6 1.2a16.7 16.7 0 0 0-5.2 0L8.8 4a18.4 18.4 0 0 0-4.5 1.3C1.4 9.5.6 13.6 1 17.6a18.5 18.5 0 0 0 5.5 2.8l1.2-2a12 12 0 0 1-1.9-.9l.5-.4a13.3 13.3 0 0 0 11.4 0l.5.4a12 12 0 0 1-1.9.9l1.2 2a18.5 18.5 0 0 0 5.5-2.8c.5-4.6-.8-8.6-3.3-12.3ZM8.7 14.8c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm6.6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z" /></svg> }
function gameName(value: string | null | undefined): string { if (!value) return 'Sin juego'; return ({ valorant: 'VALORANT', cs2: 'CS2', lol: 'LoL' } as Record<string, string>)[value.toLowerCase()] || value.toUpperCase() }
function statusName(value: string | null): string { if (!value) return 'Estado no publicado'; return ({ waiting: 'En espera', matched: 'Emparejado', cancelled: 'Cancelado', timed_out: 'Expirada', pending: 'Pendiente', in_progress: 'En curso', completed: 'Finalizada', live: 'En vivo', upcoming: 'Próximo', draft: 'Borrador', closed: 'Cerrado', open: 'Abierto' } as Record<string, string>)[value] || value }
function formatDate(value: string | null): string { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date) }

export default App
