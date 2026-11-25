/**
 * Single-file path built on Mediabunny's Conversion. It copies compressed packets whenever
 * the output container can hold them (no quality loss) and re-encodes only when it must.
 * Used by Smart Export for simple projects and by most Quick Editor tools.
 */
import { ALL_FORMATS, BlobSource, Conversion, Input, Output, Quality, canEncodeAudio, canEncodeVideo, type AudioCodec, type Rotation, type VideoCodec } from 'mediabunny'
import type { QualityPreset } from '@/types/project'
import { ExportCancelled } from './renderExport'
import { QUALITY_LEVEL } from './ExportPlanner'
import type { ExportSink } from './sink'

export interface ConvertJob {
  file: File
  sink: ExportSink
  /** Source-time range to keep. Omit for the whole file. */
  trim?: { start: number; end: number }
  /** Drop the audio track. */
  muteAudio?: boolean
  /** Drop the video track (audio extraction). */
  audioOnly?: boolean
  rotate?: 0 | 90 | 180 | 270
  flip?: boolean
  /** Output height in px, 0 = keep. Width follows the aspect ratio. */
  height?: number
  /** Output fps, 0 = keep. */
  frameRate?: number
  /** "original" lets Mediabunny copy; other presets force a re-encode at that quality. */
  quality?: QualityPreset
  /** For audio-only exports. */
  audioCodec?: AudioCodec
  /**
   * Converter mode: for MP4 output prefer the universally playable H.264 + AAC (re-encoding
   * only if the source uses something else). Skipped silently if the browser can't encode them.
   */
  compat?: boolean
  signal?: AbortSignal
  onProgress?: (fraction: number, phase: string) => void
}

export async function convertFile(job: ConvertJob): Promise<{ copiedVideo: boolean | null }> {
  const { file, sink, signal, onProgress } = job
  if (signal?.aborted) throw new ExportCancelled()
  using input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  const output = new Output({ format: sink.format, target: sink.target })

  const reencode = !!job.quality && job.quality !== 'original'
  const q = job.quality ? new Quality(QUALITY_LEVEL[job.quality]) : undefined

  let videoCodec: VideoCodec | undefined
  let audioCodec: AudioCodec | undefined = job.audioCodec
  if (job.compat && sink.filename.endsWith('.mp4')) {
    if (await canEncodeVideo('avc').catch(() => false)) videoCodec = 'avc'
    if (!audioCodec && (await canEncodeAudio('aac').catch(() => false))) audioCodec = 'aac'
  }

  const conversion = await Conversion.init({
    input,
    output,
    trim: job.trim,
    video: job.audioOnly
      ? { discard: true }
      : {
          height: job.height || undefined,
          rotate: (job.rotate || 0) as Rotation,
          flip: job.flip,
          frameRate: job.frameRate || undefined,
          codec: videoCodec,
          quality: reencode ? q : undefined,
          forceTranscode: reencode || undefined,
        },
    audio: job.muteAudio ? { discard: true } : { codec: audioCodec, quality: reencode ? new Quality(job.quality === 'small' ? 'low' : 'medium') : undefined },
  })

  if (!conversion.isValid) {
    const why = conversion.discardedTracks.map((d) => d.reason).join(', ')
    throw new Error(`This file cannot be converted to ${sink.filename.split('.').pop()?.toUpperCase()} in this browser${why ? ` (${why})` : ''}. Try the other format.`)
  }

  const onAbort = () => void conversion.cancel()
  signal?.addEventListener('abort', onAbort)
  conversion.onProgress = (p) => onProgress?.(p, reencode ? 'Re-encoding' : 'Processing')
  try {
    await conversion.execute()
    onProgress?.(1, 'Done')
  } catch (e) {
    await sink.abort()
    if (signal?.aborted) throw new ExportCancelled()
    throw e
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
  return { copiedVideo: null }
}
