import type { SubtitleMessage } from '@/composables/useSubtitleChannel'

const DB_NAME = 'audio-wowza'
const DB_VERSION = 1
const STORE = 'sessions'
const KEY_LAST = 'lastBroadcast'

export interface StoredBroadcastSession {
  mimeType: string
  buffer: ArrayBuffer
  segments: SubtitleMessage[]
  savedAt: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'))
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE)
      }
    }
  })
}

export async function saveLastBroadcastSession(data: {
  blob: Blob
  segments: SubtitleMessage[]
}): Promise<void> {
  const buffer = await data.blob.arrayBuffer()
  const mimeType = data.blob.type || 'audio/wav'
  const payload: StoredBroadcastSession = {
    mimeType,
    buffer,
    segments: data.segments.map((s) => ({ ...s })),
    savedAt: Date.now(),
  }
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.objectStore(STORE).put(payload, KEY_LAST)
  })
}

export async function loadLastBroadcastSession(): Promise<StoredBroadcastSession | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(KEY_LAST)
    req.onsuccess = () => resolve((req.result as StoredBroadcastSession | undefined) ?? null)
    req.onerror = () => reject(req.error)
  })
}

export async function clearLastBroadcastSession(): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.objectStore(STORE).delete(KEY_LAST)
  })
}
