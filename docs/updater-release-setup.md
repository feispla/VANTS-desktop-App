# Configuración del updater firmado

El código permanece en `feispla/vantcall-desktop-App` (privado). El mirror público `feispla/vantcall-desktop-releases` ya fue creado con un solo archivo `README.md`; todavía no contiene instaladores ni releases. La app consultará:

```text
https://github.com/feispla/vantcall-desktop-releases/releases/latest/download/latest.json
```

El workflow `.github/workflows/updater-draft.yml` compila Windows, Linux y macOS al enviar una etiqueta `v*` y crea una **release en borrador**. Un borrador no es el feed público consumido por los clientes. Una persona responsable debe revisar los assets y sus firmas y pulsar **Publish release** para hacerla pública; el updater solo ve releases publicadas. La publicación de una release requerirá una confirmación independiente cuando haya un borrador revisable.

## Configuración pendiente del propietario

1. Verifica que el mirror `feispla/vantcall-desktop-releases` conserve solo su README hasta preparar la primera distribución. No copies código fuente, historial, issues, proyectos ni archivos del repositorio privado.
2. Genera una clave minisign de Tauri en un equipo de confianza. No generes la clave en Actions ni subas el archivo privado al repositorio:

   ```bash
   npx tauri signer generate -w ~/.tauri/vantcall-desktop.key
   ```

   El comando guarda la clave privada en el archivo indicado e imprime la clave pública. Copia solo esa clave pública (las dos líneas completas) a `~/.tauri/vantcall-desktop.pub`; conserva la clave privada y la contraseña fuera del repositorio. Para obtener una variable de una sola línea, codifica el archivo público:

   ```bash
   base64 -w0 ~/.tauri/vantcall-desktop.pub
   ```

   En macOS, si `base64 -w0` no existe, usa `base64 < ~/.tauri/vantcall-desktop.pub | tr -d '\n'`.
3. En **Settings → Secrets and variables → Actions** de `vantcall-desktop-App`, crea estos secrets: `TAURI_SIGNING_PRIVATE_KEY` (contenido completo del archivo privado), `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` y `MIRROR_PUBLISH_TOKEN`. El token debe ser fine-grained, limitado al repositorio `vantcall-desktop-releases`, con permiso `Contents: Read and write` para crear releases y subir assets. Nunca pegues estos valores en el chat ni los incluyas en commits.
4. En la misma sección, crea la variable (no secret) `VANTCALL_UPDATER_PUBKEY_B64` con la salida Base64 de la clave pública. La clave pública se incrusta en el binario para verificar firmas; no es confidencial.
5. Envía un tag cuyo número coincida con `src-tauri/tauri.conf.json` (`v0.1.0` para la versión actual). Actions producirá un borrador en el mirror. Verifica que `latest.json` incluya URLs de ese mirror y que cada paquete descargable tenga su `.sig`; solicita y obtén confirmación antes de publicar la release.

## Consideraciones

- Tauri verifica la firma del updater antes de instalar. `scripts/prepare-updater-config.mjs` falla si no encuentra una clave pública minisign y nunca lee ni escribe la clave privada.
- Este flujo firma los artefactos del updater, pero **no** configura certificados Apple Developer ID/notarización ni Authenticode para Windows. Eso queda para el Sprint 3; los sistemas operativos pueden mostrar advertencias hasta configurar esos certificados.
- El mirror creado contiene únicamente `README.md`; no se han creado secrets, tags, borradores ni releases. La sesión GitHub disponible aquí no puede administrar Actions Secrets, por lo que el propietario debe configurarlos directamente en GitHub.
