# Pendiente del propietario

Este documento recoge únicamente tareas que requieren una acción autenticada del propietario. **No pegues claves de proveedor en chat, commits, `.env` compartido ni logs.**

## Secrets y Variables de GitHub Actions

Antes de considerar completa la distribución, verifica en **feispla/vantcall-desktop-App → Settings → Secrets and variables → Actions** estos cuatro valores: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `MIRROR_PUBLISH_TOKEN` (Secrets) y `VANTCALL_UPDATER_PUBKEY_B64` (Variable recomendada; el workflow también acepta Secret). La creación y el guardado de `MIRROR_PUBLISH_TOKEN` se completaron en esta sesión; la variable pública y el contenido de la clave privada pasan sus pasos previos. El run `v0.1.0` falló por el CR/LF final de la clave y `v0.1.1` corrigió eso, pero los cuatro jobs ahora fallan en Tauri con `incorrect updater private key password: Wrong password for that key`. Esto confirma que `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` no coincide con la contraseña usada para cifrar la clave privada local. La CLI de GitHub devuelve `403 Resource not accessible by integration` al listar names de secrets/variables y la página autenticada de Settings agotó el tiempo, por lo que no se pudo corregir desde esta sesión. No leas ni copies valores en logs.

**Acción:** sustituye `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` en GitHub por la contraseña exacta de la clave existente (sin regenerar ni rotar la clave). Después abre [el run fallido v0.1.1](https://github.com/feispla/vantcall-desktop-App/actions/runs/36682801564) y usa **Re-run all jobs**. El tag `v0.1.1` ya existe: no lo muevas ni uses force-push. El run falló antes de que se creara un draft, así que al pasar creará el borrador normalmente. El token del mirror aún no llegó a usarse en un upload.

## Supabase Auth — habilitar el retorno nativo de Discord

En el proyecto `VANTSBETA`, abre **Authentication → URL Configuration → Redirect URLs** y agrega exactamente `vants://auth/callback` en la allow-list de redirects adicionales. Supabase documenta esquemas nativos personalizados en [Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls) y [Native Mobile Deep Linking](https://supabase.com/docs/guides/auth/native-mobile-deep-linking).

Confirma que Discord siga configurado con el callback que Supabase muestra para el proyecto, normalmente `https://<project-ref>.supabase.co/auth/v1/callback`. No cambies a una clave OAuth de Discord dentro de la app: la credencial del proveedor permanece en Supabase. El cliente Desktop ya intercambia el código PKCE recibido en el deep link y almacena la sesión en Stronghold.

## Supabase Studio / Stripe — HTTP 401

La captura adjunta muestra que una consulta de Studio intenta `GET https://api.stripe.com/v1/accounts?limit=100` y recibe `401 No autorizado`. Según [la referencia oficial de errores de Stripe](https://docs.stripe.com/api/errors), HTTP 401 indica que no se proporcionó una API key válida; no es un error de RLS ni de la URL/clave de Supabase.

La cuenta Stripe `VANT` está disponible en el conector Stripe de esta sesión, y la Edge Function `stripe-webhook` del proyecto usa un secreto de webhook independiente guardado en Supabase Vault; esa función no llama a `/v1/accounts`. Por eso **no se rotó ni cambió `stripe_webhook_secret` ni se tocó ningún pago**. El propietario debe actualizar la credencial Stripe del conector/integración concreta que origina esa consulta desde su configuración segura y volver a cargar la tabla. No envíes la clave por chat.

## Supabase Advisors — hallazgos existentes

Después de las dos migraciones `queue_events`, el advisor de rendimiento ya no informa ningún hallazgo nuevo en esa tabla. Quedan hallazgos previos del proyecto: `players.own update` usa `auth.uid()` directamente (recomendación de envolverlo en `SELECT`); `current_player_id()` y `log_web_event(...)` son RPC `SECURITY DEFINER` expuestos a `authenticated`, y `current_player_id()` también a `anon`; RLS está activo sin policies en `audit_logs`, `bot_admins`, `postulaciones_auditoria` y `vant_sync_events` (fail-closed); y la protección de contraseñas filtradas está desactivada. `current_player_id()` solo busca el `players.id` cuyo `auth_user_id = auth.uid()`, mientras `log_web_event` exige usuario autenticado, permite una lista cerrada de eventos y limita el payload a 2 KB. No se cambiaron estos objetos: las funciones parecen formar parte del flujo web y revocar permisos o añadir policies podría romperlo. El propietario debería revisarlos con el backend/web antes de ajustar.

Para el ajuste de Auth, revisar **Authentication → Security and Protection → Leaked password protection** y habilitarlo después de evaluar el impacto en el registro y cambio de contraseña. Las advertencias y tablas anteriores existían antes de esta integración; la migración de escritorio no accede a ellas.

## Sprint 6 — credenciales e integraciones de juego

No hay claves Riot o Steam disponibles para el proyecto en el código del cliente, y no se añadieron claves de ejemplo ni respuestas simuladas. La [política oficial de Riot para VALORANT](https://developer.riotgames.com/docs/valorant) indica que las Personal Key Applications no están admitidas; un producto debe registrarse, y los datos de jugadores requieren RSO/opt-in y el aviso correspondiente. Además, la [documentación oficial de Steam Web API](https://steamcommunity.com/dev) no lista un endpoint de historial de partidas CS2 por jugador; obtener una API key por sí sola no habilita esa función. Steam ofrece OpenID para verificar el SteamID, pero eso no concede acceso al historial. Para continuar, el propietario deberá:

1. Registrar el producto VANTCALL en Riot Developer Portal, solicitar el acceso apropiado/RSO para VALORANT y League of Legends, y habilitar el flujo de consentimiento antes de consultar datos individuales. Una vez aprobada, guardar `RIOT_API_KEY` solo como secreto de Supabase Edge Functions. Los endpoints oficiales incluyen VAL-MATCH-V1 (matchlists/matches), VAL-RANKED-V1 (leaderboards) y para LoL Summoner-V4/Match-V5; los stats de agentes se derivan de partidas autorizadas, no de un endpoint oficial independiente.
2. Decidir una fuente autorizada para historial CS2. Steam Web API documenta información de usuario y estadísticas globales, pero no el historial de partidas CS2 individual solicitado; no se implementará scraping ni una API de terceros sin aprobación explícita. Si se usa una API comercial, confirmar proveedor, coste y términos antes de integrar.
3. Confirmar los identificadores verificables y el alcance de consentimiento de cada cuenta antes de añadir botones de vinculación; definir retención y frecuencia de sync antes de programar la Edge Function cada 15 minutos.

Las claves deben permanecer en Supabase Edge Functions; nunca en `VITE_*`, el bundle Tauri, Actions Variables públicas o SQLite. Sin la aprobación Riot, los secretos y una fuente CS2 documentada, no se implementan llamadas de juego que puedan devolver datos inventados o que fallen silenciosamente.

## Firma de instaladores

Windows Authenticode y Apple Developer ID/notarización son opcionales y requieren certificados y credenciales del propietario. Sin los certificados Apple, macOS se firma ad-hoc y puede mostrar la advertencia de desarrollador no verificado. No se compró ningún certificado.

## Revisión de distribución

El run `v0.1.0` falló antes de crear/subir artefactos. El run `v0.1.1` (ID `36682801564`) también falló antes de crear el draft porque el password del secret de Actions no abre la clave existente. Tras corregir ese secret, reejecuta ese run; no muevas el tag. El workflow solo crea **drafts** en `feispla/vantcall-desktop-releases`; no publica la release. El código fuente continúa privado en `feispla/vantcall-desktop-App`.
El draft incluirá `.exe/.msi/.AppImage/.app.tar.gz` con firmas updater generadas por Tauri, y `.dmg.sig`/`.deb.sig` generadas por `tauri signer sign` además de los instaladores correspondientes. `latest.json` debe apuntar únicamente a los paquetes updater y URL del mirror.
