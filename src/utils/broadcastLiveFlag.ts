const KEY = 'wowza-broadcast-live'

export function setBroadcastLive(value: boolean) {
  if (value) {
    localStorage.setItem(KEY, 'true')
  } else {
    localStorage.removeItem(KEY)
  }
}

export function isBroadcastLive(): boolean {
  return localStorage.getItem(KEY) === 'true'
}
