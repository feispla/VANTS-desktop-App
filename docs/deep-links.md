# Deep links VANTCALL Desktop

La app instalada registra el esquema `vants://`. La ruta de partida usa exactamente el formato solicitado:

```text
vants://match/12345
```

Al abrirse, VANTCALL Desktop cambia al historial, busca el identificador en los datos ya sincronizados desde Supabase y desplaza la vista hasta la fila si existe. Si el historial real no contiene esa partida, informa que no se encontró; no inventa ni consulta datos adicionales por el enlace. Los IDs pasan por validación y el deep link solo navega dentro de la app.

## Integración sugerida en la web

El repo `feispla/Vants-Avanzadobeta` se mantuvo en modo lectura; esta guía no cambia la web. Un enlace HTML puede apuntar al ID real publicado por el sitio:

```tsx
<a href={`vants://match/${encodeURIComponent(match.id)}`}>
  Abrir en VANTCALL Desktop
</a>
```

La web debe incluir el botón solo donde `match.id` sea un identificador real que el cliente de escritorio pueda leer con sus permisos actuales. Si el navegador o el sistema no tiene la app instalada, conserva en la página una ruta web de respaldo al historial; no intentes redirigir automáticamente ni registrar un protocol handler web sin informar al usuario.

## Prueba por plataforma

Los deep links desktop deben probarse con la app instalada. En Windows puede abrirse `start vants://match/12345`; en Linux, `xdg-open 'vants://match/12345'`. En Windows/Linux el cliente registra el esquema durante desarrollo y usa el plugin single-instance para reenviar una segunda apertura a la ventana ya activa. macOS registra el esquema en el bundle instalado y no admite el registro dinámico de desarrollo descrito por Tauri; prueba desde `/Applications`.

El handler admite solo `vants://match/<id>`; los demás hosts y protocolos se ignoran. No se transmite ningún token o credencial en la URL.
