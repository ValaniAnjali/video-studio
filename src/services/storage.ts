/**
 * Local persistence. No server involved.
 *  - IndexedDB: project JSON + preferences (+ media blobs when OPFS is unavailable)
 *  - OPFS (Origin Private File System): the raw imported media files, when supported
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { videoProjectSchema, type VideoProject } from '@/types/project'

interface StudioDB extends DBSchema {
  projects: { key: string; value: VideoProject }
  media: { key: string; value: { blob: Blob; name: string; type: string } }
  prefs: { key: string; value: unknown }
}

let dbPromise: Promise<IDBPDatabase<StudioDB>> | null = null
const db = () =>
  (dbPromise ??= openDB<StudioDB>('video-studio', 1, {
    upgrade(d) {
      d.createObjectStore('projects', { keyPath: 'id' })
      d.createObjectStore('media')
      d.createObjectStore('prefs')
    },
  }))

export class StorageQuotaError extends Error {
  constructor() {
    super('Browser storage is full. Free up disk space or delete old projects, then try again.')
  }
}

const isQuota = (e: unknown) => e instanceof DOMException && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED')

// ---------- projects ----------

export async function saveProject(project: VideoProject): Promise<void> {
  try {
    await (await db()).put('projects', project)
  } catch (e) {
    throw isQuota(e) ? new StorageQuotaError() : e
  }
}

export async function loadProject(id: string): Promise<VideoProject | null> {
  const raw = await (await db()).get('projects', id)
  if (!raw) return null
  const parsed = videoProjectSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

export async function listProjects(): Promise<VideoProject[]> {
  const all = await (await db()).getAll('projects')
  return all
    .map((p) => videoProjectSchema.safeParse(p))
    .flatMap((r) => (r.success ? [r.data] : []))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function deleteProject(project: VideoProject): Promise<void> {
  const d = await db()
  await d.delete('projects', project.id)
  await Promise.all(project.assets.map((a) => deleteMedia(a.storageId)))
}

// ---------- media blobs ----------

async function opfsDir(): Promise<FileSystemDirectoryHandle | null> {
  try {
    if (!navigator.storage?.getDirectory) return null
    const root = await navigator.storage.getDirectory()
    return await root.getDirectoryHandle('media', { create: true })
  } catch {
    return null
  }
}

export async function saveMedia(storageId: string, file: File): Promise<void> {
  const dir = await opfsDir()
  if (dir) {
    try {
      const handle = await dir.getFileHandle(storageId, { create: true })
      const writable = await handle.createWritable()
      await file.stream().pipeTo(writable) // streams: no full in-memory copy
      return
    } catch (e) {
      if (isQuota(e)) throw new StorageQuotaError()
      // Fall through to IndexedDB (e.g. Safari main thread has no createWritable)
    }
  }
  try {
    await (await db()).put('media', { blob: file, name: file.name, type: file.type }, storageId)
  } catch (e) {
    throw isQuota(e) ? new StorageQuotaError() : e
  }
}

export async function loadMedia(storageId: string, fallbackName = 'media', fallbackType = ''): Promise<File | null> {
  const dir = await opfsDir()
  if (dir) {
    try {
      const handle = await dir.getFileHandle(storageId)
      const f = await handle.getFile()
      return new File([f], fallbackName, { type: fallbackType || f.type })
    } catch {
      /* not in OPFS */
    }
  }
  const rec = await (await db()).get('media', storageId)
  return rec ? new File([rec.blob], rec.name, { type: rec.type }) : null
}

export async function deleteMedia(storageId: string): Promise<void> {
  const dir = await opfsDir()
  try {
    await dir?.removeEntry(storageId)
  } catch {
    /* ignore */
  }
  await (await db()).delete('media', storageId)
}

// ---------- prefs ----------

export async function getPref<T>(key: string, fallback: T): Promise<T> {
  try {
    const v = await (await db()).get('prefs', key)
    return (v as T) ?? fallback
  } catch {
    return fallback
  }
}
export async function setPref(key: string, value: unknown): Promise<void> {
  try {
    await (await db()).put('prefs', value, key)
  } catch {
    /* non-critical */
  }
}

/** Ask the browser not to evict our data under storage pressure (best effort). */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.()
    return e ? { usage: e.usage ?? 0, quota: e.quota ?? 0 } : null
  } catch {
    return null
  }
}

// ---------- backup ----------

export function projectToJson(project: VideoProject): string {
  return JSON.stringify(project, null, 2)
}

export function projectFromJson(text: string): VideoProject {
  return videoProjectSchema.parse(JSON.parse(text))
}
