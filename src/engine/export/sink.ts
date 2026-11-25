/**
 * Where an export is written. Prefers streaming straight to a file the user picks
 * (File System Access API, Chromium) so big exports never sit fully in RAM; otherwise
 * collects into memory and hands back a Blob to download.
 */
import { BufferTarget, Mp4OutputFormat, OggOutputFormat, StreamTarget, WavOutputFormat, WebMOutputFormat, type OutputFormat, type Target } from 'mediabunny'

export type ContainerKind = 'mp4' | 'webm' | 'wav' | 'ogg'

export interface ExportResult {
  filename: string
  size: number
  /** Present when the file was kept in memory. */
  blob?: Blob
  savedToDisk: boolean
}

export interface ExportSink {
  target: Target
  format: OutputFormat
  filename: string
  /** Call after output.finalize(). */
  finish(): Promise<ExportResult>
  /** Call when the export failed or was cancelled. */
  abort(): Promise<void>
}

interface SaveHandle {
  createWritable(): Promise<FileSystemWritableFileStream>
  getFile(): Promise<File>
}
type SavePicker = (o: { suggestedName: string; types?: { description: string; accept: Record<string, string[]> }[] }) => Promise<SaveHandle>

const MIME: Record<ContainerKind, { ext: string; mime: string; label: string }> = {
  mp4: { ext: 'mp4', mime: 'video/mp4', label: 'MP4 video' },
  webm: { ext: 'webm', mime: 'video/webm', label: 'WebM video' },
  wav: { ext: 'wav', mime: 'audio/wav', label: 'WAV audio' },
  ogg: { ext: 'ogg', mime: 'audio/ogg', label: 'Ogg audio' },
}

export const supportsDiskStreaming = () => typeof window !== 'undefined' && 'showSaveFilePicker' in window

export function formatFor(kind: ContainerKind): OutputFormat {
  switch (kind) {
    case 'mp4':
      return new Mp4OutputFormat()
    case 'webm':
      return new WebMOutputFormat()
    case 'wav':
      return new WavOutputFormat()
    case 'ogg':
      return new OggOutputFormat()
  }
}

export class SaveCancelled extends Error {
  constructor() {
    super('Save cancelled')
    this.name = 'SaveCancelled'
  }
}

/**
 * Create a sink. MUST be called directly from a click handler when preferDisk is true
 * (the browser only allows the save dialog during a user gesture).
 */
export async function createSink(baseName: string, kind: ContainerKind, preferDisk: boolean): Promise<ExportSink> {
  const info = MIME[kind]
  const filename = `${safeName(baseName)}.${info.ext}`
  const format = formatFor(kind)

  if (preferDisk && supportsDiskStreaming()) {
    let handle: SaveHandle
    try {
      handle = await (window as unknown as { showSaveFilePicker: SavePicker }).showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: info.label, accept: { [info.mime]: [`.${info.ext}`] } }],
      })
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw new SaveCancelled()
      throw e
    }
    const writable = await handle.createWritable()
    return {
      target: new StreamTarget(writable as unknown as WritableStream, { chunked: true }),
      format,
      filename,
      async finish() {
        const f = await handle.getFile()
        return { filename: f.name, size: f.size, savedToDisk: true }
      },
      async abort() {
        try {
          await writable.abort()
        } catch {
          /* already closed */
        }
      },
    }
  }

  const target = new BufferTarget()
  return {
    target,
    format,
    filename,
    async finish() {
      const blob = new Blob([target.buffer!], { type: info.mime })
      return { filename, size: blob.size, blob, savedToDisk: false }
    },
    async abort() {
      /* nothing to clean up: memory is released with the target */
    },
  }
}

export const safeName = (s: string) => s.replace(/\.[^.]+$/, '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'video'

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
