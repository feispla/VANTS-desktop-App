# VANTCALL Desktop

Cliente premium de escritorio para el circuito competitivo VANTCALL, construido con **Tauri 2, React, TypeScript y Vite**.

## Sprint 1

- Elimina los perfiles, rangos, partidas, colas y torneos ficticios del MVP.
- Lee los datos directamente del proyecto Supabase activo `VANTSBETA` (`qtetsgwwsvqzquxssudj`, región `eu-west-1`) mediante consultas REST `GET` a `players`, `profiles`, `ranked_matches`, `ranked_queue`, `season_player_stats`, `seasons` y `tournaments`.
- Reintentos con espera exponencial, estados de carga/error y caché SQLite para lectura sin conexión.
- Discord OAuth mediante Supabase Auth y flujo PKCE en navegador externo; la sesión de Supabase se guarda en Stronghold, cifrada con una clave de instalación guardada en el llavero nativo del sistema. No se utiliza `localStorage` para credenciales.
- Migración SQLite en `src-tauri/migrations/001_initial.sql`: `sessions` (solo metadatos), `matches_cache`, `api_cache`, `settings` y `notifications`. Los tokens de acceso/refresco no se guardan en SQLite.
- Las pantallas vacías reflejan la respuesta real; no se rellenan con datos de demostración.

**Solo lectura sobre Supabase:** este cliente no contiene operaciones de inserción, actualización ni borrado en tablas remotas. La cola de juego queda deshabilitada hasta que exista un endpoint oficial de matchmaking que defina y autorice escrituras. El cierre de sesión limpia metadatos y caché privados locales.

## Sprint 2 — experiencia nativa

- Notificaciones del sistema para una transición real de cola a `matched`, un resultado que se publica/cambia y torneos que empiezan en 15 minutos. El cliente consulta datos cada 60 segundos mientras está abierto o en la bandeja; al salir de la aplicación deja de consultar. Se puede desactivar el permiso en Ajustes y cada evento se deduplica en SQLite.
- La X oculta la ventana en la bandeja. El menú ofrece Abrir VANTCALL, Buscar partida (abre el dashboard; no escribe en la cola) y Salir.
- **Updater preparado, distribución pendiente:** el plugin oficial consulta actualizaciones firmadas desde `https://github.com/feispla/vantcall-desktop-releases/releases/latest/download/latest.json`; los ajustes permiten revisar e instalar y el cliente comprueba el feed al iniciar. `docs/updater-release-setup.md` explica el mirror de artefactos y los secretos necesarios. `.github/workflows/updater-draft.yml` crea únicamente borradores; una persona debe revisarlos y publicarlos. El repositorio de código fuente permanece privado y este cambio no crea el mirror, secretos, tags ni releases.

## Requisitos para conectar datos

1. El cliente ya viene conectado al proyecto VANTSBETA con su clave pública `sb_publishable_...`; `.env.example` documenta el mismo proyecto y se puede copiar a `.env.local` para usar overrides. También admite `VITE_SUPABASE_ANON_KEY` legacy; **nunca uses `service_role` ni `sb_secret_...`**.
2. En Supabase Auth, habilita Discord y configura las credenciales del proveedor. Añade `http://localhost:*/**` a la lista de Redirect URLs de Supabase (el cliente genera un redirect con `/` final). Discord debe tener como callback el URL que muestra Supabase, normalmente `https://<project-ref>.supabase.co/auth/v1/callback`.
3. Verifica que las políticas RLS permitan a un usuario autenticado leer solo su propia fila de `players`/`profiles` y sus estadísticas/partidas/cola, además de permitir la lectura pública prevista para torneos.

El conector de Supabase confirmó que las tablas competitivas `ranked_matches`, `ranked_queue`, `ranked_history`, `season_player_stats`, `seasons` y `tournaments` están actualmente vacías. La UI mostrará estados vacíos hasta que existan registros reales.

La web de VANTS consultada en `feispla/Vants-Avanzadobeta` no expone `/api/me`, `/api/matches`, `/api/queue`, `/api/tournaments` ni `/api/rank`. Su frontend usa otro esquema (`teams`, `match_series`, etc.) y tiene la URL/clave Supabase vacías; `supabase/seed.sql` se identifica como demo/ficticio. Por eso el cliente de escritorio consulta el esquema real de `VANTSBETA` y no usa la semilla de la web.

El proyecto Supabase tiene activa `discord-commands`, pero su implementación solo valida interacciones Discord y devuelve confirmaciones provisionales; no proporciona endpoints para el dashboard. `stripe-webhook` no es pertinente al cliente. Los permisos RLS observados permiten las lecturas públicas previstas y limitan la lectura de cola al jugador actual. La aplicación mantiene la cola en modo GET/solo lectura.

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

## Autenticación segura y datos locales

El proveedor Discord usa Supabase Auth con PKCE. En Tauri, el callback local lo recoge `@fabianlars/tauri-plugin-oauth`; la clave aleatoria de Stronghold se almacena en Keychain/Windows Credential Manager/Secret Service según el sistema. Si el almacén nativo no está disponible, el cliente falla de forma cerrada en vez de persistir tokens en texto plano. En la vista web de desarrollo solo hay almacenamiento en memoria para facilitar el build; la autenticación requiere la app de escritorio.

SQLite conserva datos de caché no sensibles, preferencias y metadatos de sesión; las credenciales OAuth nunca se escriben en SQLite. Los datos persistidos se borran al cerrar sesión.
