/**
 * In-memory registry of the File objects behind assets, plus cached object URLs.
 * Files are lazily restored from local storage after a page refresh.
 */
import type { MediaAsset } from '@/types/project'
import { loadMedia } from '@/services/storage'

const files = new Map<string, File>() // key: asset.id
const urls = new Map<string, string>()

export function registerFile(assetId: string, file: File) {
  files.set(assetId, file)
}

export async function ensureFile(asset: MediaAsset): Promise<File | null> {
  const hit = files.get(asset.id)
  if (hit) return hit
  const f = await loadMedia(asset.storageId, asset.name, asset.mimeType)
  if (f) files.set(asset.id, f)
  return f
}

export const getFile = (assetId: string) => files.get(assetId) ?? null

export function getUrl(assetId: string): string | null {
  const cached = urls.get(assetId)
  if (cached) return cached
  const f = files.get(assetId)
  if (!f) return null
  const u = URL.createObjectURL(f)
  urls.set(assetId, u)
  return u
}

/** Revoke object URLs and drop files (call when a project closes). */
export function releaseAll() {
  for (const u of urls.values()) URL.revokeObjectURL(u)
  urls.clear()
  files.clear()
}
