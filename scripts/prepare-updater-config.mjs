import { writeFile } from 'node:fs/promises'

const encoded = process.env.VANTCALL_UPDATER_PUBKEY_B64?.trim()
if (!encoded) {
  throw new Error('Falta la variable pública VANTCALL_UPDATER_PUBKEY_B64; no se generará un build sin verificación de firma.')
}

let publicKey
let decodedPublicKey
try {
  publicKey = Buffer.from(encoded, 'base64').toString('utf8').trim()
  decodedPublicKey = Buffer.from(publicKey, 'base64').toString('utf8').trim()
} catch {
  throw new Error('VANTCALL_UPDATER_PUBKEY_B64 no es Base64 válido.')
}

if (!decodedPublicKey.startsWith('untrusted comment: minisign public key') || !decodedPublicKey.split(/\r?\n/)[1]?.trim()) {
  throw new Error('La variable no parece ser el Base64 del archivo .pub generado por Tauri.')
}

const config = {
  bundle: { createUpdaterArtifacts: true },
  plugins: {
    updater: {
      pubkey: publicKey,
      endpoints: [
        'https://github.com/feispla/vantcall-desktop-releases/releases/latest/download/latest.json',
      ],
    },
  },
}

const appleSigningEnabled = process.env.APPLE_SIGNING_ENABLED?.trim() === 'true'
const appleSigningIdentity = process.env.APPLE_SIGNING_IDENTITY?.trim()
if (appleSigningEnabled && !appleSigningIdentity) {
  throw new Error('APPLE_SIGNING_ENABLED=true requiere una identidad Apple Developer ID importada.')
}
config.bundle.macOS = { signingIdentity: appleSigningEnabled ? appleSigningIdentity : '-' }

const windowsThumbprint = process.env.WINDOWS_SIGNING_THUMBPRINT?.trim()
if (windowsThumbprint) {
  const timestampUrl = process.env.WINDOWS_TIMESTAMP_URL?.trim()
  if (!/^[a-f\d]{40,64}$/i.test(windowsThumbprint)) {
    throw new Error('Windows signing certificate thumbprint is not a valid hex fingerprint.')
  }
  if (!timestampUrl || !/^https?:\/\//i.test(timestampUrl)) {
    throw new Error('Set WINDOWS_TIMESTAMP_URL to the timestamp server provided by the code-signing certificate authority.')
  }
  config.bundle.windows = {
    certificateThumbprint: windowsThumbprint,
    digestAlgorithm: 'sha256',
    timestampUrl,
  }
}

await writeFile(
  new URL('../src-tauri/tauri.updater.generated.conf.json', import.meta.url),
  `${JSON.stringify(config, null, 2)}\n`,
  { mode: 0o600 },
)
console.log(`Updater config written; public key validated${windowsThumbprint ? ' and Windows signing configured' : ''}.`)
