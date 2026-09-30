import { relaunch } from '@tauri-apps/plugin-process'
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater'

export const updaterBuildEnabled = import.meta.env.VITE_UPDATER_ENABLED === 'true'
export type DesktopUpdate = Update
export type DesktopDownloadEvent = DownloadEvent

export async function checkForDesktopUpdate(): Promise<DesktopUpdate | null> {
  return check({ timeout: 20_000 })
}

export async function installDesktopUpdate(
  update: DesktopUpdate,
  onProgress: (event: DesktopDownloadEvent) => void,
): Promise<void> {
  await update.downloadAndInstall(onProgress, { timeout: 10 * 60_000 })

  // Windows closes the app when the installer starts; macOS and Linux require an explicit relaunch.
  if (!window.navigator.userAgent.toLowerCase().includes('windows')) {
    await relaunch()
  }
}
