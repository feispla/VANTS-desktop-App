# VANTCALL Desktop

Cliente de escritorio de VANTCALL para que los jugadores consulten su rango, revisen partidas, encuentren colas y exploren torneos sin abrir el navegador.

## Estado actual

MVP visual y navegable construido con **Tauri 2 + React + TypeScript + Vite**:

- Dashboard con rango Escarlata III, progreso VP y cola de VALORANT.
- Historial de partidas con resultados y rating.
- Explorador de torneos activos.
- Perfil competitivo con estadísticas.
- Ajustes de notificaciones, estado y tema.
- Diseño oscuro de marca: `#E30613` sobre `#0B0B0C`.
- Responsive para ventana estrecha y navegación móvil.
- Estados locales simulados para iniciar/salir de cola y notificaciones.

## Desarrollo

```bash
npm install
npm run dev              # preview web en http://localhost:5173
npm run build            # typecheck + build web
npm run lint             # Oxlint
npm run desktop:dev      # abrir la app Tauri en desarrollo
npm run desktop:build    # generar instaladores para el sistema actual
```

El comando `desktop:dev` y el empaquetado requieren Rust, Cargo y las dependencias nativas de Tauri instaladas en el equipo de desarrollo.

## Próximas integraciones

1. Sustituir los datos demo por la API de `vantcall-esports1.pplx.app`.
2. Añadir OAuth de Discord y almacenamiento seguro de sesión.
3. Persistir caché local con SQLite.
4. Integrar notificaciones nativas y eventos de cola.
5. Conectar Discord, Riot API y Steam según las credenciales de producción.
6. Configurar auto-actualizador y firma de instaladores Windows/macOS.

## Estructura

```text
src/
  App.tsx       # navegación y pantallas del MVP
  App.css       # sistema visual y responsive
  index.css     # estilos globales
src-tauri/
  tauri.conf.json
  src/          # shell nativo Tauri
```

## Repositorio

https://github.com/feispla/vantcall-desktop
