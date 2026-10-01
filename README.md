# VANTCALL Desktop

Cliente premium de escritorio para el circuito competitivo VANTCALL, construido con **Tauri 2, React, TypeScript y Vite**.

## Sprint 1

- Elimina los perfiles, rangos, partidas, colas y torneos ficticios del MVP.
- Lee los datos directamente del proyecto Supabase activo `VANTSBETA` (`qtetsgwwsvqzquxssudj`, región `eu-west-1`) mediante consultas REST `GET` a `players`, `profiles`, `ranked_matches`, `ranked_queue`, `season_player_stats`, `seasons` y `tournaments`.
- Reintentos con espera exponencial, estados de carga/error y caché SQLite para lectura sin conexión.
- Discord OAuth mediante Supabase Auth y flujo PKCE en navegador externo; la sesión de Supabase se guarda en Stronghold, cifrada con una clave de instalación guardada en el llavero nativo del sistema. No se utiliza `localStorage` para credenciales.
- Migraciones SQLite versionadas: `001_initial.sql` para caché/preferencias/notificaciones y `002_anonymous_analytics.sql` para métricas anónimas locales. Los tokens de acceso/refresco no se guardan en SQLite.
- Las pantallas vacías reflejan la respuesta real; no se rellenan con datos de demostración.

**Solo lectura desde el escritorio:** la app no inserta, actualiza ni borra datos de jugador o de matchmaking. La migración de eventos añade una escritura server-side derivada únicamente cuando el servicio existente cambia `ranked_queue`; la aplicación solo lee esa cola de eventos. La cola de juego permanece deshabilitada hasta que exista un endpoint oficial de matchmaking que autorice escrituras. El cierre de sesión limpia metadatos y caché privados locales.

## Sprint 2 — experiencia nativa

- Notificaciones del sistema para una transición real de cola a `matched`, un resultado que se publica/cambia y torneos que empiezan en 15 minutos. La cola utiliza Realtime privado y el cliente conserva el sondeo de 60 segundos como respaldo; resultados y torneos siguen sincronizados mientras está abierto o en la bandeja. Al salir deja de consultar. Se puede desactivar el permiso en Ajustes y cada evento se deduplica en SQLite.
- La X oculta la ventana en la bandeja. El menú ofrece Abrir VANTCALL, Buscar partida (abre el dashboard; no escribe en la cola) y Salir.

## Sprint 3 — Distribución, actualizaciones y firma

- **Updater y builds multiplataforma preparados:** el plugin oficial consulta `https://github.com/feispla/vantcall-desktop-releases/releases/latest/download/latest.json`. El workflow de tags compila Windows, Linux y macOS; crea únicamente borradores en el mirror público de artefactos. El run `v0.1.0` detectó un LF sobrante en el secret Minisign; el run `v0.1.1` validó la clave pública y su formato normalizado, pero los cuatro jobs fallaron porque el password de Actions no coincide con la clave privada cifrada. No se creó ningún draft; cuando el propietario actualice el secret se podrá reejecutar el mismo run. Soporta firmas updater y firma adicional de `.dmg`/`.deb`; firma Windows y firma/notarización macOS requieren credenciales opcionales, y en su ausencia macOS usa ad-hoc. El código fuente permanece privado. Ver `docs/updater-release-setup.md` y `docs/PENDIENTE-OWNER.md`.

## Sprint 4 — Pulido

- Deep links `vants://match/<id>`: abren el historial y enfocan la fila solo si el ID aparece en datos reales sincronizados. La guía `docs/deep-links.md` contiene la integración sugerida; el repo de la web oficial se mantuvo de solo lectura.
- El estado de red se muestra en la interfaz; la última caché real puede seguir mostrándose offline. Tema claro/oscuro persistido en SQLite.
- Analítica anónima opcional: se guarda solo en SQLite del dispositivo, sin IDs de cuenta ni transmisión remota; viene desactivada, puede apagarse o borrarse desde Ajustes.

## Sprint 5 — Supabase y OAuth de escritorio

- `@supabase/supabase-js` se reutiliza mediante el singleton `src/lib/supabase.ts`; `.env.example` usa `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`. `.env` y variantes locales se ignoran en Git. Las consultas siguen limitadas a los nombres/campos existentes en VANTSBETA; no se crean tablas duplicadas para perfiles, partidas o torneos.
- Discord OAuth usa PKCE con callback nativo `vants://auth/callback`; Stronghold conserva los tokens cifrados. Debe añadirse ese URI a Supabase Auth → URL Configuration → Redirect URLs antes de probar un nuevo login. El callback OAuth de Discord sigue siendo el URL de Supabase Auth.
- `supabase/migrations/20260930070203_queue_events_realtime.sql` añade `queue_events` con RLS de lectura propia, enum de juego y eventos derivados de cambios reales en `ranked_queue`; `20260930070332_queue_events_policy_performance.sql` aplica el ajuste recomendado por Supabase para `auth.uid()`. La tabla está en `supabase_realtime`. En el escritorio, los cambios privados refrescan la cola y SQLite mantiene el fallback offline.

## Sprint 6 — APIs de juego (bloqueado por acceso/soporte oficial)

- No se incluyeron endpoints ni claves simuladas. Riot requiere registrar el producto y opt-in/RSO para datos individuales; Steam Web API no documenta historial de partidas CS2 por jugador. Se necesita aprobación del propietario para el producto Riot/RSO y decidir una fuente CS2 autorizada antes de añadir vinculación o cron. Detalles y referencias oficiales: [`docs/PENDIENTE-OWNER.md`](docs/PENDIENTE-OWNER.md).

## Requisitos para conectar datos

1. El cliente ya viene conectado al proyecto VANTSBETA con su clave pública `sb_publishable_...`; `.env.example` documenta el mismo proyecto y se puede copiar a `.env.local` para usar overrides. También admite `VITE_SUPABASE_ANON_KEY` legacy; **nunca uses `service_role` ni `sb_secret_...`**.
2. En Supabase Auth, habilita Discord y configura las credenciales del proveedor. Añade `vants://auth/callback` a la lista de Redirect URLs de Supabase. Discord debe tener como callback el URL que muestra Supabase, normalmente `https://<project-ref>.supabase.co/auth/v1/callback`.
3. Verifica que las políticas RLS permitan a un usuario autenticado leer solo su propia fila de `players`/`profiles` y sus estadísticas/partidas/cola, además de permitir la lectura pública prevista para torneos.

El conector de Supabase confirmó que las tablas competitivas `ranked_matches`, `ranked_queue`, `ranked_history`, `season_player_stats`, `seasons` y `tournaments` están actualmente vacías. La UI mostrará estados vacíos hasta que existan registros reales.

La web de VANTS consultada en `feispla/Vants-Avanzadobeta` no expone `/api/me`, `/api/matches`, `/api/queue`, `/api/tournaments` ni `/api/rank`. Su frontend usa otro esquema (`teams`, `match_series`, etc.) y tiene la URL/clave Supabase vacías; `supabase/seed.sql` se identifica como demo/ficticio. Por eso el cliente de escritorio consulta el esquema real de `VANTSBETA` y no usa la semilla de la web.

El proyecto Supabase tiene activa `discord-commands`, pero su implementación solo valida interacciones Discord y devuelve confirmaciones provisionales; no proporciona endpoints para el dashboard. `stripe-webhook` valida webhooks POST usando su propio secreto de Vault y no llama a `GET /v1/accounts`. El screenshot de Supabase Studio muestra un 401 al consultar `https://api.stripe.com/v1/accounts?limit=100`; Stripe define 401 como clave API ausente/no válida, separado de las políticas RLS de Postgres. No se rotó ni modificó ninguna credencial Stripe. Las lecturas RLS de cola siguen limitadas al jugador actual.

## Desarrollo

```bash
npm install
cp .env.example .env.local
# Completa la clave anon/public del proyecto en .env.local
npm run dev
npm run build
npm run lint
npm run desktop:dev
npm run desktop:build
```

El empaquetado Tauri requiere Rust/Cargo y las dependencias nativas del sistema de Tauri. La ventana inicial es de 1280 × 840 y su tamaño mínimo es 1200 × 800. Para el flujo de actualizaciones firmado, consulta [docs/updater-release-setup.md](docs/updater-release-setup.md); los builds locales no habilitan el feed.

### Riot / ValoTracker

The authenticated profile includes `ValoTrackerSync`, which reads the optional Riot account from `user_game_accounts` and links to Tracker.gg and the configured Discord stats channel. Set `VITE_DISCORD_GUILD_ID` and `VITE_DISCORD_VALORANT_STATS_CHANNEL_ID` in `.env.local` to enable the Discord link. If the account table is unavailable, the rest of the real profile still loads and the card explains that no Riot account is linked.

## Autenticación segura y datos locales

El proveedor Discord usa Supabase Auth con PKCE y el deep link nativo `vants://auth/callback`. La clave aleatoria de Stronghold se almacena en Keychain/Windows Credential Manager/Secret Service según el sistema. Si el almacén nativo no está disponible, el cliente falla de forma cerrada en vez de persistir tokens en texto plano. En la vista web de desarrollo solo hay almacenamiento en memoria para facilitar el build; la autenticación requiere la app de escritorio.

SQLite conserva datos de caché no sensibles, preferencias y metadatos de sesión; las credenciales OAuth nunca se escriben en SQLite. Los datos persistidos se borran al cerrar sesión.
