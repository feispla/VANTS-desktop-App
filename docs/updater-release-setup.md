# Configuración del updater firmado

El código permanece en `feispla/vantcall-desktop-App` (privado). El mirror público `feispla/vantcall-desktop-releases` ya existe y solo contiene su `README.md`; aún no tiene instaladores ni releases. La app consultará:

```text
https://github.com/feispla/vantcall-desktop-releases/releases/latest/download/latest.json
```

El workflow `.github/workflows/updater-draft.yml` compila Windows, Linux y macOS al enviar una etiqueta `v*`, y crea únicamente una **release en borrador** en el mirror. La matriz corre secuencialmente porque `tauri-action` fusiona los destinos de cada plataforma en `latest.json`; así se evitan carreras de reemplazo entre jobs. Tauri firma los paquetes de actualización `.exe`, `.msi`, `.AppImage` y `.app.tar.gz`; un paso adicional firma los instaladores `.dmg` y `.deb` y adjunta sus `.sig` al borrador. Solo los bundles updater nativos se enumeran en `latest.json`. Los borradores no se entregan al público ni son consumidos por el updater. Una persona responsable revisa assets y firmas y publica la release en una acción separada; este trabajo no publica instaladores.

## Updater: clave minisign y mirror

1. Genera una clave minisign de Tauri en un equipo de confianza. No generes la clave privada en Actions ni la subas al repositorio:

   ```bash
   npx tauri signer generate -w ~/.tauri/vantcall-desktop.key
   ```

   El comando guarda la privada en `~/.tauri/vantcall-desktop.key` y genera `~/.tauri/vantcall-desktop.key.pub`. Ese `.pub` ya es el valor Base64 de la clave pública que Tauri debe integrar en la configuración. Para la variable de GitHub, codifica el contenido del archivo una vez más:

   ```bash
   base64 -w0 ~/.tauri/vantcall-desktop.key.pub
   ```

   En macOS, si `base64 -w0` no existe, usa `base64 < ~/.tauri/vantcall-desktop.key.pub | tr -d '\n'`. El workflow quita esa capa externa y conserva el valor `.pub` para Tauri; no codifiques manualmente la clave privada.
2. En **Settings → Secrets and variables → Actions** del repositorio privado, configura los secrets `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` y `MIRROR_PUBLISH_TOKEN`. El token fine-grained de 90 días quedó guardado como secret `MIRROR_PUBLISH_TOKEN`, limitado al repositorio `vantcall-desktop-releases` con `Contents: Read and write`; no pegues secretos en el chat ni en commits. El workflow elimina CR/LF sobrantes de la clave antes de llamar a Tauri: el archivo generado debe aportarse como una sola cadena, sin codificarlo de nuevo.
3. Preferiblemente crea la variable (no secreta) `VANTCALL_UPDATER_PUBKEY_B64` con la salida Base64 de la clave pública. Si ya la guardaste como Actions Secret con ese nombre, el workflow también acepta esa ubicación. La clave se incorpora al binario para validar firmas y no es confidencial.

## Firma Authenticode de Windows

Tauri puede firmar Windows cuando se aporte un certificado real de **code signing** (no SSL). Obtén un `.pfx` de la autoridad certificadora elegida, con su password y URL de timestamp. En **Actions → Secrets** crea `WINDOWS_CERTIFICATE` (PFX codificado en Base64) y `WINDOWS_CERTIFICATE_PASSWORD`. En **Actions → Variables** crea `WINDOWS_TIMESTAMP_URL` con la URL timestamp suministrada por la autoridad y `WINDOWS_SIGNING_ENABLED=true`.

El workflow importa el PFX en el certificado de usuario del runner, lee el thumbprint de su clave privada y genera un overlay temporal Tauri con `sha256` y esa URL. El PFX se borra del disco temporal después de importarse; los valores del certificado nunca se escriben al repo. Mientras la variable no sea exactamente `true`, Windows compila sin certificado. Si se habilita sin los secrets o timestamp requeridos, ese job falla claramente.

## Firma y notarización de macOS

Para distribuir fuera de App Store se necesita un certificado **Developer ID Application** asociado a una cuenta Apple Developer de pago. La documentación oficial de Tauri indica actualmente USD 99/año y que el certificado se debe crear/exportar desde un equipo Apple; no se ha comprado una cuenta ni certificado desde este trabajo. Exporta el certificado como `.p12` y codifícalo en Base64. En **Actions → Secrets** crea `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `KEYCHAIN_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD` (contraseña específica de app) y `APPLE_TEAM_ID`. En **Actions → Variables**, crea `APPLE_SIGNING_ENABLED=true` solo tras verificar que todos esos valores son válidos.

El runner macOS importa el certificado en un keychain temporal, identifica `Developer ID Application`, firma y envía el bundle a notarización con las credenciales Apple. Si `APPLE_SIGNING_ENABLED` no es exactamente `true`, los secretos Apple se excluyen del paso de build y Tauri usa la identidad ad-hoc `-`; no hay notarización y macOS puede pedir al usuario permitir la aplicación desde Privacidad y seguridad. El owner debe guardar esos secretos directamente en GitHub; nunca enviarlos por chat. Consulta la [guía oficial de firma macOS de Tauri](https://v2.tauri.app/distribute/sign/macos/).

## Publicación futura

El tag `v0.1.0` falló antes de subir artefactos: Windows/Linux reportaron `Invalid symbol 10, offset 348` por un CR/LF final en el secret Minisign; macOS intentó importar un `APPLE_CERTIFICATE` vacío. El workflow actual normaliza la clave y separa los pasos Apple. El run [v0.1.1](https://github.com/feispla/vantcall-desktop-App/actions/runs/36682801564) validó la clave pública y la clave privada normalizada en los cuatro runners, pero todos fallaron con `incorrect updater private key password: Wrong password for that key`. No hay draft en el mirror. El propietario debe corregir el secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` con la contraseña exacta de la clave existente y luego usar **Re-run all jobs** sobre ese run; no muevas el tag ni uses force-push. Una vez verde, Actions producirá únicamente un borrador. Revisa instaladores, firmas `.sig` y `latest.json`; esta guía no autoriza publicar.

La firma Minisign del updater es independiente de la firma de código Apple/Windows. La configuración privada de Actions no se lee ni se imprime en logs. El run actual ya confirma que el password guardado en GitHub no corresponde a la clave cifrada. No publiques ningún borrador sin revisión humana explícita.
