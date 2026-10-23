// Threads and the outbox on this device. The service worker never sees this
// database. Sign-out deletes it.

import type { OutboxState } from "@/lib/pwa/outbox"
import type { StoredMessage } from "@/lib/pwa/sanitize"

const DB_NAME = "xiryn-offline"
const DB_VERSION = 1

export type StoredThread = {
  threadId: string
  title: string | null
  href: string
  agentName: string
  glyph: string
  preview: string
  activeAt: string
  messages: StoredMessage[]
  savedAt: string
}

export type OutboxRecord = {
  id: string
  threadId: string
  agentId?: string
  text: string
  createdAt: string
  state: OutboxState
  error?: string
}

function unsupported() {
  return typeof indexedDB === "undefined"
}

function request<T>(req: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

const openConnections = new Set<IDBDatabase>()

function track(db: IDBDatabase) {
  openConnections.add(db)
  const drop = () => {
    openConnections.delete(db)
  }
  db.onclose = drop
  // A delete is blocked until every connection closes. This one closes itself.
  db.onversionchange = () => {
    db.close()
    drop()
  }
}

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION)
    open.onupgradeneeded = () => {
      const db = open.result
      if (!db.objectStoreNames.contains("threads")) {
        db.createObjectStore("threads", { keyPath: "threadId" })
      }
      if (!db.objectStoreNames.contains("outbox")) {
        db.createObjectStore("outbox", { keyPath: "id" })
      }
    }
    open.onsuccess = () => {
      track(open.result)
      resolve(open.result)
    }
    open.onerror = () => reject(open.error)
  })
}

function withStore<T>(
  name: "threads" | "outbox",
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T>
) {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(name, mode)
        let settled = false
        const fail = (error: unknown) => {
          if (settled) return
          settled = true
          db.close()
          reject(error)
        }
        tx.oncomplete = () => {
          if (settled) return
          settled = true
          db.close()
          resolve(result)
        }
        tx.onerror = () => fail(tx.error)
        tx.onabort = () => fail(tx.error)
        let result: T
        run(tx.objectStore(name)).then(
          (value) => {
            result = value
          },
          (error) => {
            fail(error)
            try {
              tx.abort()
            } catch {
              // The transaction already finished.
            }
          }
        )
      })
  )
}

export async function listStoredThreads(): Promise<StoredThread[]> {
  if (unsupported()) return []
  try {
    return await withStore("threads", "readonly", (store) => request(store.getAll()))
  } catch {
    return []
  }
}

export async function getStoredThread(threadId: string): Promise<StoredThread | null> {
  if (unsupported()) return null
  try {
    const row = await withStore("threads", "readonly", (store) =>
      request<StoredThread | undefined>(store.get(threadId))
    )
    return row ?? null
  } catch {
    return null
  }
}

export async function saveStoredThread(thread: StoredThread) {
  if (unsupported()) return
  try {
    await withStore("threads", "readwrite", async (store) => {
      const existing = await request<StoredThread | undefined>(store.get(thread.threadId))
      await request(store.put({ ...existing, ...thread, messages: thread.messages }))
      return undefined
    })
  } catch {
    // Private mode and a locked database are not fatal. The server still has the thread.
  }
}

export async function rememberThreadList(
  rows: Array<Omit<StoredThread, "messages" | "savedAt">>
) {
  if (unsupported() || rows.length === 0) return
  try {
    await withStore("threads", "readwrite", async (store) => {
      for (const row of rows) {
        const existing = await request<StoredThread | undefined>(store.get(row.threadId))
        await request(
          store.put({
            savedAt: new Date().toISOString(),
            ...existing,
            ...row,
            messages: existing?.messages ?? [],
          })
        )
      }
      return undefined
    })
  } catch {
    // See saveStoredThread.
  }
}

export async function listOutbox(): Promise<OutboxRecord[]> {
  if (unsupported()) return []
  try {
    const rows = await withStore("outbox", "readonly", (store) =>
      request<OutboxRecord[]>(store.getAll())
    )
    return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  } catch {
    return []
  }
}

export async function saveOutbox(record: OutboxRecord) {
  if (unsupported()) return
  try {
    await withStore("outbox", "readwrite", async (store) => {
      await request(store.put(record))
      return undefined
    })
  } catch {
    // The composer keeps the draft if this throws to the caller. Here a full
    // disk should not take the thread down; the next flush reads what landed.
  }
}

export async function deleteOutbox(id: string) {
  if (unsupported()) return
  try {
    await withStore("outbox", "readwrite", async (store) => {
      await request(store.delete(id))
      return undefined
    })
  } catch {
    // Already gone.
  }
}

export function clearOfflineStore() {
  if (unsupported()) return Promise.resolve()
  return new Promise<void>((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      resolve()
    }
    for (const db of openConnections) {
      try {
        db.close()
      } catch {
        // Already closing.
      }
    }
    openConnections.clear()
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = finish
    req.onerror = finish
    // A blocked delete continues once open connections close on versionchange.
    setTimeout(finish, 2000)
  })
}
