export const RIOT_HANDLE_PATTERN = /^[^\s#]{3,16}#[A-Za-z0-9]{3,5}$/

export function validateRiotHandle(handle: string): boolean {
  return RIOT_HANDLE_PATTERN.test(handle.trim())
}

export function getTrackerUrl(handle: string): string {
  return `https://tracker.gg/valorant/profile/riot/${encodeURIComponent(handle.trim())}`
}
