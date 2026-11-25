import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny'
import type { MediaAsset, MediaType } from '@/types/project'
import { uid } from '@/utils/id'
import { computePeaks } from './waveform'

export class UnsupportedMediaError extends Error {}

const THUMB_W = 192

function canvasToDataUrl(c: HTMLCanvasElement | OffscreenCanvas): Promise<string> {
  if (c instanceof OffscreenCanvas) {
    return c.convertToBlob({ type: 'image/jpeg', quality: 0.7 }).then(
      (b) =>
        new Promise<string>((res, rej) => {
          const r = new FileReader()
          r.onload = () => res(String(r.result))
          r.onerror = () => rej(r.error)
          r.readAsDataURL(b)
        }),
    )
  }
  return Promise.resolve(c.toDataURL('image/jpeg', 0.7))
}

async function importImage(file: File): Promise<Omit<MediaAsset, 'id' | 'storageId'>> {
  const bmp = await createImageBitmap(file).catch(() => {
    throw new UnsupportedMediaError(`"${file.name}" is not a readable image.`)
  })
  const scale = THUMB_W / bmp.width
  const c = document.createElement('canvas')
  c.width = THUMB_W
  c.height = Math.max(1, Math.round(bmp.height * scale))
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  const meta = { name: file.name, type: 'image' as MediaType, size: file.size, mimeType: file.type || 'image/*', width: bmp.width, height: bmp.height, duration: 5, hasAudio: false, thumbnail: c.toDataURL('image/jpeg', 0.7) }
  bmp.close()
  return meta
}

/** Validate a file, read its metadata and make a thumbnail. */
export async function readMedia(file: File): Promise<Omit<MediaAsset, 'id' | 'storageId'>> {
  if (file.type.startsWith('image/')) return importImage(file)

  using input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  if (!(await input.canRead())) throw new UnsupportedMediaError(`"${file.name}" is not a supported or readable media file.`)

  const video = await input.getPrimaryVideoTrack()
  const audio = await input.getPrimaryAudioTrack()
  if (!video && !audio) throw new UnsupportedMediaError(`"${file.name}" contains no audio or video tracks.`)

  if (video && !(await video.canDecode()))
    throw new UnsupportedMediaError(`The video codec (${video.codec ?? 'unknown'}) in "${file.name}" cannot be decoded by this browser. Try Chrome/Edge, or convert the file first.`)
  const audioOk = audio ? await audio.canDecode() : false

  const duration = await input.computeDuration()
  let thumbnail: string | undefined
  let frameRate: number | undefined

  if (video) {
    try {
      const stats = await video.computePacketStats(60)
      frameRate = stats.averagePacketRate || undefined
    } catch {
      /* optional */
    }
    try {
      const sink = new CanvasSink(video, { width: THUMB_W, fit: 'contain' })
      const first = await video.getFirstTimestamp()
      const wrapped = await sink.getCanvas(Math.min(first + 0.5, first + duration / 2))
      if (wrapped) thumbnail = await canvasToDataUrl(wrapped.canvas)
    } catch {
      /* thumbnails are optional */
    }
  }

  return {
    name: file.name,
    type: video ? 'video' : 'audio',
    size: file.size,
    mimeType: file.type || (video ? 'video/*' : 'audio/*'),
    duration,
    width: video?.displayWidth,
    height: video?.displayHeight,
    frameRate: frameRate ? Math.round(frameRate * 100) / 100 : undefined,
    hasAudio: audioOk,
    videoCodec: video?.codec ?? null,
    audioCodec: audio?.codec ?? null,
    thumbnail,
  }
}

export async function importFile(file: File): Promise<{ asset: MediaAsset }> {
  const meta = await readMedia(file)
  if (meta.hasAudio && meta.type !== 'image') meta.peaks = await computePeaks(file)
  const id = uid()
  return { asset: { ...meta, id, storageId: id } }
}
