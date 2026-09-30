import { writeFile } from 'node:fs/promises'

const encoded = process.env.VANTCALL_UPDATER_PUBKEY_B64?.trim()
if (!encoded) {
  throw new Error('Falta la variable pública VANTCALL_UPDATER_PUBKEY_B64; no se generará un build sin verificación de firma.')
}

let publicKey
try {
  publicKey = Buffer.from(encoded, 'base64').toString('utf8').trim()
} catch {
  throw new Error('VANTCALL_UPDATER_PUBKEY_B64 no es Base64 válido.')
}

if (!publicKey.startsWith('untrusted comment: minisign public key') || !publicKey.split('\n')[1]?.trim()) {
  throw new Error('La variable no parece contener una clave pública minisign de Tauri válida.')
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

await writeFile(
  new URL('../src-tauri/tauri.updater.generated.conf.json', import.meta.url),
  `${JSON.stringify(config, null, 2)}\n`,
  { mode: 0o600 },
)
console.log('Configuración temporal del updater escrita; clave pública validada y endpoint del mirror configurado.')
