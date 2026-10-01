import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bell, ChevronDown, CircleHelp, Crown, LogOut, Menu, Settings, ShieldCheck, X } from 'lucide-react'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link'
import { openUrl } from '@tauri-apps/plugin-opener'
import { fetchMatches, fetchProfile, fetchQueue, fetchRank, fetchTournaments, type CompetitiveRank, type PlayerProfile, type QueueEntry, type RankedMatch } from '../lib/api'
import { friendlyAuthError, handleSupabaseAuthCallback, LoginSupersededError, PROVIDER_LABEL, signInWithProvider, signOutSafely, type LoginProvider } from '../lib/auth'
import { openLocalDatabase, type AnalyticsFeature, type AnonymousAnalyticsSummary, type LocalDatabase, type LocalNotification } from '../lib/database'
import { requestCompetitiveNotificationPermission, sendCompetitiveNotification } from '../lib/notifications'
import { fetchPlan, fetchPlanContent, type PlanContentItem, type PlanTier } from '../lib/plans'
import { createAuthStorage } from '../lib/secure-storage'
import { getSupabaseClient } from '../lib/supabase'
import { missingSupabaseSettings, supabaseProjectReady } from '../lib/config'
import { checkForDesktopUpdate, installDesktopUpdate, updaterBuildEnabled, type DesktopDownloadEvent, type DesktopUpdate } from '../lib/updater'
import { Avatar, Splash } from '../components/ui'
import { DashboardPage } from '../features/dashboard/DashboardPage'
import { LoginOptions } from '../features/auth/LoginOptions'
import { MatchesPage } from '../features/matches/MatchesPage'
import { PlanZonePage } from '../features/plan-zone/PlanZonePage'
import { ProfilePage } from '../features/profile/ProfilePage'
import { SettingsPage } from '../features/settings/SettingsPage'
import { AnalyticsSettingsPanel, NativeSettingsPanel, UpdaterSettingsPanel } from '../features/settings/SettingsPanels'
import { TournamentsPage } from '../features/tournaments/TournamentsPage'
import { navItems } from './navigation'
import type { NotificationSnapshot, Page, Theme, Toast, UpdaterState, Workspace } from './types'
import { collectNativeNotifications, EMPTY_ANALYTICS_SUMMARY, EMPTY_WORKSPACE, withCache } from './workspace'

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
  const [theme, setTheme] = useState<Theme>('dark')
  const [isOnline, setIsOnline] = useState(() => navigator.onLine)
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false)
  const [analyticsSummary, setAnalyticsSummary] = useState<AnonymousAnalyticsSummary>(EMPTY_ANALYTICS_SUMMARY)
  const [focusedMatchId, setFocusedMatchId] = useState<string | null>(null)
  const [updaterState, setUpdaterState] = useState<UpdaterState>('idle')
  const [updaterVersion, setUpdaterVersion] = useState('')
  const [updaterMessage, setUpdaterMessage] = useState('')
  const [updaterProgress, setUpdaterProgress] = useState<number | null>(null)
  const refreshInFlightRef = useRef(false)
  const previousOnlineRef = useRef(isOnline)
  const localDatabaseRef = useRef<LocalDatabase | null>(null)
  const notificationEnabledRef = useRef(true)
  const analyticsEnabledRef = useRef(false)
  const analyticsSessionRecordedRef = useRef(false)
  const deepLinkOpenedRef = useRef(false)
  const lastDeepLinkRef = useRef<{ url: string; at: number } | null>(null)
  const notificationSnapshotRef = useRef<NotificationSnapshot | null>(null)
  const updaterRef = useRef<DesktopUpdate | null>(null)
  const updaterInFlightRef = useRef(false)
  const supabaseClientRef = useRef<SupabaseClient | null>(null)
  const pendingAuthDeepLinksRef = useRef<string[]>([])

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    localDatabaseRef.current = workspace?.db ?? null
  }, [workspace?.db])

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
      let plan: PlanTier = 'free'
      let planContent: PlanContentItem[] = []

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
          // La zona de plan es opcional: un esquema antiguo sin plan_content no debe mostrar errores.
          try {
            plan = await fetchPlan(client, profile as PlayerProfile)
            if (plan !== 'free') planContent = await fetchPlanContent(client)
          } catch {
            planContent = []
          }
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
      setWorkspace({ client, db, session, profile, matches, rank, queue, tournaments, notifications, plan, planContent, errors, stale: staleFlags.length > 0 })
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
        const client = getSupabaseClient(storage)
        const savedPage = await db.getSetting('last_page').catch(() => null)
        const savedNotifications = await db.getSetting('notifications_enabled').catch(() => null)
        const savedTheme = await db.getSetting('theme').catch(() => null)
        const savedAnalytics = await db.getSetting('anonymous_analytics_enabled').catch(() => null)
        const notificationsAreEnabled = savedNotifications !== 'false'
        notificationEnabledRef.current = notificationsAreEnabled
        setNotificationsEnabled(notificationsAreEnabled)
        if (savedTheme === 'dark' || savedTheme === 'light') setTheme(savedTheme)
        const analyticsAreEnabled = savedAnalytics === 'true'
        analyticsEnabledRef.current = analyticsAreEnabled
        setAnalyticsEnabled(analyticsAreEnabled)
        if (analyticsAreEnabled && !analyticsSessionRecordedRef.current) {
          analyticsSessionRecordedRef.current = true
          await db.recordAnalyticsEvent('session_start').catch(() => { analyticsSessionRecordedRef.current = false })
        }
        setAnalyticsSummary(await db.getAnalyticsSummary().catch(() => EMPTY_ANALYTICS_SUMMARY))
        if (!deepLinkOpenedRef.current && savedPage && ['dashboard', 'matches', 'tournaments', 'profile', 'plan', 'settings'].includes(savedPage)) setPage(savedPage as Page)
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
    const client = workspace?.client
    const db = workspace?.db
    const session = workspace?.session
    if (!client || !db || !session) return
    const channel = client
      .channel(`queue-events:${session.user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'queue_events',
        filter: `user_id=eq.${session.user.id}`,
      }, () => {
        void refresh(client, db, session, true)
      })
      .subscribe()
    return () => { void client.removeChannel(channel) }
  }, [workspace?.client, workspace?.db, workspace?.session, refresh])

  useEffect(() => {
    const reconnected = !previousOnlineRef.current && isOnline
    previousOnlineRef.current = isOnline
    if (reconnected && pollingClient && pollingDb) void refresh(pollingClient, pollingDb, pollingSession, true)
  }, [isOnline, pollingClient, pollingDb, pollingSession, refresh])

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

  const pageTitle = useMemo(() => ({ dashboard: 'Resumen competitivo', matches: 'Historial de partidas', tournaments: 'Torneos', profile: 'Mi perfil', plan: 'Zona de plan', settings: 'Ajustes' })[page], [page])
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
  const handleToggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    void workspace?.db.setSetting('theme', next).catch(() => notify('error', 'No se pudo guardar el tema en este dispositivo.'))
  }
  const handleToggleAnalytics = async () => {
    if (!workspace) return
    const next = !analyticsEnabled
    try {
      await workspace.db.setSetting('anonymous_analytics_enabled', String(next))
      analyticsEnabledRef.current = next
      setAnalyticsEnabled(next)
      if (next && !analyticsSessionRecordedRef.current) {
        analyticsSessionRecordedRef.current = true
        await workspace.db.recordAnalyticsEvent('session_start').catch(() => { analyticsSessionRecordedRef.current = false })
      }
      setAnalyticsSummary(await workspace.db.getAnalyticsSummary())
      notify('success', next ? 'Analítica local anónima activada; no se envía al servidor.' : 'Se detuvo el registro de nuevos eventos analíticos.')
    } catch {
      notify('error', 'No se pudo guardar la preferencia analítica en SQLite.')
    }
  }
  const handleClearAnalytics = async () => {
    if (!workspace) return
    try {
      await workspace.db.clearAnalyticsEvents()
      analyticsSessionRecordedRef.current = false
      setAnalyticsSummary(EMPTY_ANALYTICS_SUMMARY)
      notify('success', 'Se borraron todos los eventos analíticos locales.')
    } catch {
      notify('error', 'No se pudieron borrar los registros analíticos locales.')
    }
  }
  const recordFeatureUse = useCallback((feature: AnalyticsFeature) => {
    const db = workspace?.db
    if (!analyticsEnabledRef.current || !db) return
    void db.recordAnalyticsEvent('feature_used', feature)
      .then(() => db.getAnalyticsSummary())
      .then(setAnalyticsSummary)
      .catch(() => undefined)
  }, [workspace?.db])
  const navigate = (next: Page) => {
    setPage(next)
    setMobileOpen(false)
    void workspace?.db.setSetting('last_page', next)
    if (next !== 'plan') recordFeatureUse(next) // la migración SQLite 002 limita las features analíticas
  }
  const handleDeepLink = useCallback((rawUrl: string) => {
    try {
      const url = new URL(rawUrl)
      if (url.protocol !== 'vants:') return
      if (url.hostname.toLowerCase() === 'auth' && url.pathname === '/callback') {
        const previous = lastDeepLinkRef.current
        const now = Date.now()
        if (previous?.url === rawUrl && now - previous.at < 1_500) return
        lastDeepLinkRef.current = { url: rawUrl, at: now }
        deepLinkOpenedRef.current = true
        const client = supabaseClientRef.current
        if (!client) {
          pendingAuthDeepLinksRef.current.push(rawUrl)
          return
        }
        void handleSupabaseAuthCallback(client, rawUrl)
          .catch((error) => notify('error', error instanceof Error ? error.message : 'Falló el retorno OAuth de Discord.'))
        return
      }
      if (url.hostname.toLowerCase() !== 'match') return
      const encodedId = url.pathname.split('/').filter(Boolean)[0]
      if (!encodedId) return
      const matchId = decodeURIComponent(encodedId)
      if (!/^[\w.-]{1,128}$/.test(matchId)) return
      const previous = lastDeepLinkRef.current
      const now = Date.now()
      if (previous?.url === rawUrl && now - previous.at < 1_500) return
      lastDeepLinkRef.current = { url: rawUrl, at: now }
      deepLinkOpenedRef.current = true
      setFocusedMatchId(matchId)
      setPage('matches')
      setMobileOpen(false)
      void localDatabaseRef.current?.setSetting('last_page', 'matches')
      recordFeatureUse('matches')
      notify('info', `Abriendo el historial para la partida ${matchId}…`)
    } catch {
      // Los argumentos de proceso externos no son URLs confiables; los que no se puedan parsear se ignoran.
    }
  }, [notify, recordFeatureUse])

  useEffect(() => {
    supabaseClientRef.current = workspace?.client ?? null
    if (!workspace?.client || !pendingAuthDeepLinksRef.current.length) return
    const pendingUrls = pendingAuthDeepLinksRef.current.splice(0)
    pendingUrls.forEach(handleDeepLink)
  }, [workspace?.client, handleDeepLink])

  useEffect(() => {
    if (!isTauri()) return
    let cancelled = false
    let unlistenOpenUrl: (() => void) | undefined
    let unlistenForwarded: (() => void) | undefined
    const acceptUrls = (urls: string[]) => urls.forEach(handleDeepLink)
    void onOpenUrl(acceptUrls).then((unlisten) => {
      if (cancelled) unlisten()
      else unlistenOpenUrl = unlisten
    }).catch(() => undefined)
    void listen<string>('deep-link-forwarded', (event) => handleDeepLink(event.payload)).then((unlisten) => {
      if (cancelled) unlisten()
      else unlistenForwarded = unlisten
    }).catch(() => undefined)
    void getCurrent().then((urls) => { if (urls) acceptUrls(urls) }).catch(() => undefined)
    return () => {
      cancelled = true
      unlistenOpenUrl?.()
      unlistenForwarded?.()
    }
  }, [handleDeepLink])

  const handleLogin = async (provider: LoginProvider = 'discord') => {
    if (!workspace) return
    const label = PROVIDER_LABEL[provider]
    if (!isTauri()) {
      notify('info', `El inicio de sesión con ${label} está disponible al ejecutar la app de escritorio.`)
      return
    }
    // No se bloquea el botón durante la espera: si el usuario cierra el navegador puede reintentar
    // y el intento nuevo sustituye al anterior.
    setAuthBusy(true)
    window.setTimeout(() => setAuthBusy(false), 1500)
    try {
      await signInWithProvider(workspace.client, provider)
      notify('success', `Sesión iniciada con ${label}.`)
    } catch (error) {
      if (error instanceof LoginSupersededError) return
      notify('error', friendlyAuthError(error))
    }
  }

  const openExternal = (url: string) => {
    if (isTauri()) void openUrl(url).catch(() => notify('error', 'No se pudo abrir el navegador.'))
    else window.open(url, '_blank', 'noopener,noreferrer')
  }

  const handleSignOut = async () => {
    if (!workspace) return
    setAuthBusy(true)
    const userId = workspace.session?.user.id
    await signOutSafely(workspace.client).catch(() => undefined)
    if (userId) await workspace.db.clearSession(userId).catch(() => undefined)
    setAuthBusy(false)
    notify('success', 'Sesión cerrada. Puedes volver a entrar con Discord, Google o Steam.')
  }

  useEffect(() => {
    if (!isTauri() || !updaterBuildEnabled) return
    const timer = window.setTimeout(() => { void handleCheckForUpdates(true) }, 4_000)
    return () => window.clearTimeout(timer)
  }, [handleCheckForUpdates])

  useEffect(() => () => { void updaterRef.current?.close().catch(() => undefined) }, [])

  const accountName = workspace?.profile?.display_name || workspace?.profile?.username || String(workspace?.session?.user.user_metadata?.full_name || workspace?.session?.user.user_metadata?.name || '') || 'Cuenta VANTCALL'
  const initials = accountName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'V'
  const dataMode = !isOnline ? (workspace?.stale ? 'Sin conexión · caché local' : 'Sin conexión') : workspace?.stale ? 'Caché local' : workspace?.errors.length ? 'Conexión limitada' : workspace?.session ? 'Supabase · sesión' : 'Supabase · público'

  if (initializing) return <Splash message="Preparando tu espacio competitivo…" />

  return <div className="app-shell">
    <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
      <div className="brand-row"><div className="brand-mark">V</div><div><strong>VANTCALL</strong><span>DESKTOP</span></div><button className="icon-button close-mobile" onClick={() => setMobileOpen(false)} aria-label="Cerrar menú"><X size={18} /></button></div>
      <div className="profile-mini"><Avatar initials={initials} url={workspace?.profile?.avatar_url || String(workspace?.session?.user.user_metadata?.avatar_url || '')} small /><div className="profile-mini-copy"><strong>{workspace?.session ? accountName : 'Sin iniciar sesión'}</strong><span><span className={`online-dot ${workspace?.session ? '' : 'offline-dot'}`} />{workspace?.session ? (workspace.plan !== 'free' ? `Plan ${workspace.plan.toUpperCase()}` : 'Cuenta conectada') : 'Sin conectar'}</span></div><ChevronDown size={16} className="muted" /></div>
      <nav className="main-nav"><p className="nav-label">COMPETIR</p>{navItems.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${page === id ? 'active' : ''}`} onClick={() => navigate(id)}><Icon size={18} /><span>{label}</span>{id === 'matches' && workspace?.matches.length ? <span className="nav-count">{workspace.matches.length}</span> : null}</button>)}<p className="nav-label nav-spacer">CUENTA</p><button className={`nav-item ${page === 'settings' ? 'active' : ''}`} onClick={() => navigate('settings')}><Settings size={18} /><span>Ajustes</span></button><button className="nav-item" onClick={() => notify('info', 'La ayuda de VANTCALL se abrirá desde el portal oficial.')}><CircleHelp size={18} /><span>Ayuda</span></button></nav>
      <div className="sidebar-bottom"><button className={`pro-card plan-card-${workspace?.plan ?? 'free'}`} onClick={() => navigate('plan')}><div className="pro-icon"><Crown size={18} /></div><div><strong>{workspace?.plan && workspace.plan !== 'free' ? `VANT ${workspace.plan.toUpperCase()}` : 'VANTCALL'}</strong><p>{workspace?.plan && workspace.plan !== 'free' ? 'Abrir zona de plan' : 'Desbloquea tu plan'}</p></div><ChevronDown size={15} /></button>{workspace?.session ? <button className="nav-item logout" onClick={() => void handleSignOut()} disabled={authBusy}><LogOut size={18} /><span>Cerrar sesión</span></button> : <LoginOptions onLogin={(provider) => void handleLogin(provider)} busy={authBusy} compact />}</div>
    </aside>

    <main className="main-content">
      <header className="topbar"><button className="icon-button menu-mobile" onClick={() => setMobileOpen(true)} aria-label="Abrir menú"><Menu size={20} /></button><div className="breadcrumb"><span>VANTCALL</span><span className="slash">/</span><strong>{pageTitle}</strong></div><div className="connection-chip" role="status"><span className={`connection-dot ${!isOnline || workspace?.stale ? 'warning' : ''}`} />{dataMode}</div><div className="top-actions"><button className="icon-button" onClick={() => setNotificationsOpen((value) => !value)} aria-label="Notificaciones"><Bell size={19} />{workspace?.notifications.length ? <span className="notification-dot" /> : null}</button><Avatar initials={initials} url={workspace?.profile?.avatar_url || String(workspace?.session?.user.user_metadata?.avatar_url || '')} /></div>{notificationsOpen && <div className="notification-popover"><strong>Notificaciones locales</strong>{workspace?.notifications.length ? workspace.notifications.map((item) => <p key={item.id}><span className="notification-red" />{item.title}<small>{item.body}</small></p>) : <p className="muted-copy">No hay notificaciones guardadas.</p>}</div>}</header>
      <div className="page-wrap">
        {initError && <div className="alert-card" role="alert"><strong>No se pudo conectar</strong><p>{initError}</p><button className="secondary-button" onClick={() => window.location.reload()}>Volver a intentar</button></div>}
        {workspace?.errors.map((error, index) => <div className={`inline-alert ${workspace.stale ? 'is-warning' : ''}`} key={`${index}-${error}`}><ShieldCheck size={16} /><span>{error}</span></div>)}
        {!initError && page === 'dashboard' && <DashboardPage workspace={workspace} refreshing={refreshing} onRefresh={() => workspace && void refresh(workspace.client, workspace.db, workspace.session)} onLogin={(provider) => void handleLogin(provider)} onNavigate={navigate} />}
        {!initError && page === 'matches' && <MatchesPage workspace={workspace} onLogin={(provider) => void handleLogin(provider)} focusedMatchId={focusedMatchId} onClearFocus={() => setFocusedMatchId(null)} />}
        {!initError && page === 'tournaments' && <TournamentsPage workspace={workspace} refreshing={refreshing} onRefresh={() => workspace && void refresh(workspace.client, workspace.db, workspace.session)} />}
        {!initError && page === 'profile' && <ProfilePage workspace={workspace} onLogin={(provider) => void handleLogin(provider)} />}
        {!initError && page === 'plan' && <PlanZonePage workspace={workspace} onLogin={(provider) => void handleLogin(provider)} authBusy={authBusy} onOpen={openExternal} refreshing={refreshing} onRefresh={() => workspace && void refresh(workspace.client, workspace.db, workspace.session)} />}
        {!initError && page === 'settings' && <><SettingsPage workspace={workspace} onLogin={(provider) => void handleLogin(provider)} onSignOut={() => void handleSignOut()} theme={theme} onToggleTheme={handleToggleTheme} isOnline={isOnline} /><NativeSettingsPanel enabled={notificationsEnabled} onToggle={() => void handleToggleNotifications()} isDesktop={isTauri()} /><AnalyticsSettingsPanel enabled={analyticsEnabled} summary={analyticsSummary} onToggle={() => void handleToggleAnalytics()} onClear={() => void handleClearAnalytics()} isDesktop={isTauri()} /><UpdaterSettingsPanel enabled={updaterBuildEnabled} isDesktop={isTauri()} status={updaterState} version={updaterVersion} message={updaterMessage} progress={updaterProgress} onCheck={() => void handleCheckForUpdates()} onInstall={() => void handleInstallUpdate()} /></>}
      </div>
    </main>
    {toast && <div className={`toast toast-${toast.kind}`} role="status"><span className="toast-check">{toast.kind === 'error' ? '!' : toast.kind === 'info' ? 'i' : '✓'}</span>{toast.message}</div>}
  </div>
}

export default App
