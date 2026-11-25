/**
 * Project-level helpers that combine the importer, local storage and the media registry.
 */
import type { MediaAsset, VideoProject } from '@/types/project'
import { importFile } from '@/engine/media/importer'
import { ensureFile, registerFile } from '@/engine/media/mediaRegistry'
import { createEmptyProject } from '@/engine/timeline/ops'
import { saveMedia, saveProject } from './storage'

export const ASPECTS = {
  '16:9': { label: 'Landscape 16:9', width: 1920, height: 1080 },
  '9:16': { label: 'Vertical 9:16', width: 1080, height: 1920 },
  '1:1': { label: 'Square 1:1', width: 1080, height: 1080 },
  '4:3': { label: 'Classic 4:3', width: 1440, height: 1080 },
} as const
export type AspectKey = keyof typeof ASPECTS

export async function createProject(name: string, aspect: AspectKey = '16:9'): Promise<VideoProject> {
  const a = ASPECTS[aspect]
  const project = createEmptyProject(name.trim() || 'Untitled project', a.width, a.height, 30)
  await saveProject(project)
  return project
}

/** Import one file: validate, read metadata, store locally, register in memory. */
export async function importIntoStorage(file: File): Promise<MediaAsset> {
  const { asset } = await importFile(file)
  registerFile(asset.id, file)
  await saveMedia(asset.storageId, file)
  return asset
}

/** Load the files for a project's assets; returns the ids that could not be found. */
export async function restoreMedia(project: VideoProject): Promise<string[]> {
  const missing: string[] = []
  await Promise.all(
    project.assets.map(async (a) => {
      const f = await ensureFile(a)
      if (!f) missing.push(a.id)
    }),
  )
  return missing
}

export function isMediaFile(f: File) {
  return f.type.startsWith('video/') || f.type.startsWith('audio/') || f.type.startsWith('image/') || /\.(mp4|m4v|mov|webm|mkv|mp3|wav|ogg|m4a|aac|flac|png|jpe?g|webp|gif)$/i.test(f.name)
}

export function downloadText(text: string, filename: string, mime = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
