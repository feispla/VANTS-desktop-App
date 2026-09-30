import { isTauri } from '@tauri-apps/api/core'
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'

export async function requestCompetitiveNotificationPermission(): Promise<boolean> {
  if (!isTauri()) return false
  if (await isPermissionGranted()) return true
  return (await requestPermission()) === 'granted'
}

export async function sendCompetitiveNotification(title: string, body: string): Promise<boolean> {
  if (!await requestCompetitiveNotificationPermission()) return false
  sendNotification({ title, body })
  return true
}
