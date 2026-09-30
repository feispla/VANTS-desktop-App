import { invoke, isTauri } from '@tauri-apps/api/core'
import { appDataDir, join } from '@tauri-apps/api/path'
import { Stronghold, type Store } from '@tauri-apps/plugin-stronghold'

export interface AuthStorage {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

const memory = new Map<string, string>()
let strongholdStore: Store | undefined
let strongholdVault: Stronghold | undefined

export async function createAuthStorage(): Promise<AuthStorage> {
  if (!isTauri()) {
    return {
      async getItem(key) { return memory.get(key) ?? null },
      async setItem(key, value) { memory.set(key, value) },
      async removeItem(key) { memory.delete(key) },
    }
  }

  const password = await invoke<string>('get_or_create_vault_password')
  const vaultPath = await join(await appDataDir(), 'secure-session.hold')
  strongholdVault = await Stronghold.load(vaultPath, password)

  let client
  try {
    client = await strongholdVault.loadClient('vantcall-auth')
  } catch {
    client = await strongholdVault.createClient('vantcall-auth')
  }
  strongholdStore = client.getStore()

  return {
    async getItem(key) {
      const bytes = await strongholdStore?.get(key)
      return bytes ? new TextDecoder().decode(bytes) : null
    },
    async setItem(key, value) {
      if (!strongholdStore || !strongholdVault) throw new Error('El almacén seguro no está inicializado.')
      await strongholdStore.insert(key, Array.from(new TextEncoder().encode(value)))
      await strongholdVault.save()
    },
    async removeItem(key) {
      if (!strongholdStore || !strongholdVault) return
      await strongholdStore.remove(key)
      await strongholdVault.save()
    },
  }
}
