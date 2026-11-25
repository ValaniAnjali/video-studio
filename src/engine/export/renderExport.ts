/**
 * Full composition export: decode -> composite on a canvas -> encode -> mux.
 *
 *  - Video frames are pulled with Mediabunny's CanvasSink (WebCodecs decode), drawn onto one
 *    canvas per output frame and encoded through a CanvasSource (WebCodecs encode).
 *  - Audio is mixed in 5-second windows with an OfflineAudioContext, so memory stays bounded
 *    no matter how long the project is.
 *  - Video and audio are produced concurrently (the muxer needs both tracks to advance).
 *
 * The heavy lifting (decode/encode) runs on the browser's own codec threads; the JS here only
 * schedules work, so the UI stays responsive.
 */
import {
  ALL_FORMATS, AudioBufferSink, AudioBufferSource, BlobSource, CanvasSink, CanvasSource, Input, Output, Quality,
  getFirstEncodableAudioCodec, getFirstEncodableVideoCodec,
  type AudioCodec, type InputAudioTrack, type InputVideoTrack, type VideoCodec, type WrappedCanvas,
} from 'mediabunny'
import type { ExportSettings, MediaAsset, TimelineClip, TimelineTrack, VideoProject } from '@/types/project'
import { clipDuration, clipEnd, clipsAt, getAsset, projectDuration } from '@/engine/timeline/ops'
import { clipOpacityAt, drawFit, drawText, fadeFactor, filterString } from '@/engine/preview/VideoCompositor'
import { QUALITY_LEVEL, resolveOutput } from './ExportPlanner'
import type { ExportSink } from './sink'

export class ExportCancelled extends Error {
  constructor() {
    super('Export cancelled')
    this.name = 'ExportCancelled'
  }
}

export interface RenderArgs {
  project: VideoProject
  settings: ExportSettings
  sink: ExportSink
  /** Resolve the File behind an asset (from memory or local storage). */
  getFile: (asset: MediaAsset) => Promise<File | null>
  signal?: AbortSignal
  onProgress?: (fraction: number, phase: string) => void
}

const AUDIO_RATE = 48_000
const AUDIO_CHANNELS = 2
const AUDIO_WINDOW = 5 // seconds

interface Source {
  asset: MediaAsset
  input: Input
  video: InputVideoTrack | null
  audio: InputAudioTrack | null
  canvasSink?: CanvasSink
  audioSink?: AudioBufferSink
  image?: ImageBitmap
}

/** Feeds frames for one clip in order, so each frame is decoded exactly once. */
class FrameReader {
  private it: AsyncGenerator<WrappedCanvas, void, unknown>
  private cur: WrappedCanvas | null = null
  private next: WrappedCanvas | null = null
  private started = false
  private done = false

  constructor(sink: CanvasSink, start: number, end: number) {
    this.it = sink.canvases(start, end)
  }

  private async pull() {
    const r = await this.it.next()
    if (r.done) {
      this.done = true
      return null
    }
    return r.value
  }

  async frameAt(srcTime: number): Promise<WrappedCanvas | null> {
    if (!this.started) {
      this.started = true
      this.next = await this.pull()
    }
    while (this.next && this.next.timestamp <= srcTime + 1e-4) {
      this.cur = this.next
      this.next = this.done ? null : await this.pull()
    }
    return this.cur ?? this.next
  }

  async close() {
    try {
      await this.it.return()
    } catch {
      /* ignore */
    }
  }
}

function audibleClips(project: VideoProject): { clip: TimelineClip; track: TimelineTrack; asset: MediaAsset }[] {
  const out: { clip: TimelineClip; track: TimelineTrack; asset: MediaAsset }[] = []
  for (const track of project.tracks) {
    if (track.muted || track.volume <= 0) continue
    for (const clip of track.clips) {
      if (clip.text || clip.muted || clip.volume <= 0) continue
      const asset = getAsset(project, clip.mediaId)
      if (asset && asset.hasAudio && asset.type !== 'image') out.push({ clip, track, asset })
    }
  }
  return out
}

export async function renderProject({ project, settings, sink, getFile, signal, onProgress }: RenderArgs): Promise<void> {
  const duration = projectDuration(project)
  if (duration <= 0) throw new Error('The timeline is empty.')
  const { width, height, fps } = resolveOutput(project, settings)
  const totalFrames = Math.max(1, Math.ceil(duration * fps))
  let failed = false // set when one of the two parallel loops dies, so the other stops too
  const check = () => {
    if (signal?.aborted) throw new ExportCancelled()
    if (failed) throw new ExportCancelled()
  }

  // ---- choose codecs the browser can actually encode ----
  const quality = new Quality(QUALITY_LEVEL[settings.quality])
  const videoPrefs = sink.format.getSupportedVideoCodecs()
  const audioPrefs = sink.format.getSupportedAudioCodecs()
  const videoCodec = await getFirstEncodableVideoCodec(videoPrefs as VideoCodec[], { width, height, quality })
  if (!videoCodec) throw new Error(`This browser cannot encode ${settings.format.toUpperCase()} video at ${width}×${height}. Try a smaller size, the other format, or Chrome/Edge.`)
  const audible = audibleClips(project)
  const audioCodec = audible.length ? await getFirstEncodableAudioCodec(audioPrefs as AudioCodec[], { numberOfChannels: AUDIO_CHANNELS, sampleRate: AUDIO_RATE }) : null
  if (audible.length && !audioCodec) throw new Error('This browser cannot encode audio for this format. Try the other format or Chrome/Edge.')

  // ---- open sources ----
  onProgress?.(0, 'Preparing media')
  const sources = new Map<string, Source>()
  const usedAssets = new Set(project.tracks.flatMap((t) => t.clips.filter((c) => !c.text).map((c) => c.mediaId)))
  try {
    for (const id of usedAssets) {
      check()
      const asset = getAsset(project, id)
      if (!asset) throw new Error('A clip references media that is no longer in the project.')
      const file = await getFile(asset)
      if (!file) throw new Error(`"${asset.name}" is missing. Re-link it in the media panel, then export again.`)
      if (asset.type === 'image') {
        sources.set(id, { asset, input: null as unknown as Input, video: null, audio: null, image: await createImageBitmap(file) })
        continue
      }
      const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
      const video = await input.getPrimaryVideoTrack()
      const audio = await input.getPrimaryAudioTrack()
      const s: Source = { asset, input, video, audio }
      if (video) s.canvasSink = new CanvasSink(video, { width, height, fit: 'contain' })
      if (audio && (await audio.canDecode())) s.audioSink = new AudioBufferSink(audio)
      sources.set(id, s)
    }

    // ---- output ----
    const output = new Output({ format: sink.format, target: sink.target })
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d', { alpha: false })!
    const videoSource = new CanvasSource(canvas, { codec: videoCodec, quality, keyFrameInterval: 2 })
    output.addVideoTrack(videoSource, { frameRate: fps })
    const audioSource = audioCodec ? new AudioBufferSource({ codec: audioCodec, quality: new Quality(settings.quality === 'small' ? 'low' : 'high') }) : null
    if (audioSource) output.addAudioTrack(audioSource)
    await output.start()

    let framesDone = 0
    const readers = new Map<string, FrameReader>()

    const videoLoop = async () => {
      for (let i = 0; i < totalFrames; i++) {
        check()
        const t = i / fps
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, width, height)

        for (const track of project.tracks) {
          if (!track.visible || track.type === 'audio') continue
          for (const clip of clipsAt(track, t)) {
            const opacity = clipOpacityAt(clip, t)
            if (clip.text) {
              drawText(ctx, width, height, clip.text, opacity)
              continue
            }
            const src = sources.get(clip.mediaId)
            if (!src) continue
            const filter = filterString(clip)
            if (src.image) {
              drawFit(ctx, src.image, src.image.width, src.image.height, width, height, opacity, filter)
            } else if (src.canvasSink) {
              let reader = readers.get(clip.id)
              if (!reader) {
                reader = new FrameReader(src.canvasSink, clip.sourceStart, clip.sourceEnd)
                readers.set(clip.id, reader)
              }
              const frame = await reader.frameAt(clip.sourceStart + (t - clip.timelineStart) * clip.playbackRate)
              if (frame) drawFit(ctx, frame.canvas, frame.canvas.width, frame.canvas.height, width, height, opacity, filter)
            }
          }
        }
        // release readers of clips that have ended
        for (const [id, r] of readers) {
          const found = project.tracks.flatMap((tr) => tr.clips).find((c) => c.id === id)
          if (!found || t >= clipEnd(found)) {
            await r.close()
            readers.delete(id)
          }
        }
        await videoSource.add(t, 1 / fps)
        framesDone = i + 1
        if (i % 3 === 0) onProgress?.((framesDone / totalFrames) * 0.97, 'Rendering')
      }
      videoSource.close()
    }

    const audioLoop = async () => {
      if (!audioSource) return
      for (let w0 = 0; w0 < duration - 1e-6; w0 += AUDIO_WINDOW) {
        check()
        const w1 = Math.min(duration, w0 + AUDIO_WINDOW)
        const length = Math.max(1, Math.ceil((w1 - w0) * AUDIO_RATE))
        const offline = new OfflineAudioContext(AUDIO_CHANNELS, length, AUDIO_RATE)
        for (const { clip, track, asset } of audible) {
          const s = sources.get(asset.id)
          if (!s?.audioSink) continue
          const tl0 = Math.max(w0, clip.timelineStart)
          const tl1 = Math.min(w1, clipEnd(clip))
          if (tl1 - tl0 <= 1e-6) continue
          const rate = clip.playbackRate
          const base = clip.volume * track.volume
          const gain = offline.createGain()
          scheduleGain(gain, clip, base, tl0, tl1, w0)
          gain.connect(offline.destination)
          const s0 = clip.sourceStart + (tl0 - clip.timelineStart) * rate
          const s1 = clip.sourceStart + (tl1 - clip.timelineStart) * rate
          for await (const { buffer, timestamp } of s.audioSink.buffers(s0, s1)) {
            let when = clip.timelineStart + (timestamp - clip.sourceStart) / rate - w0
            let offset = 0
            if (when < tl0 - w0) {
              offset = (tl0 - w0 - when) * rate
              when = tl0 - w0
            }
            if (offset >= buffer.duration || when >= tl1 - w0) continue
            const node = offline.createBufferSource()
            node.buffer = buffer
            node.playbackRate.value = rate
            node.connect(gain)
            node.start(when, offset, Math.min(buffer.duration - offset, (tl1 - w0 - when) * rate))
          }
        }
        const rendered = await offline.startRendering()
        await audioSource.add(rendered)
      }
      audioSource.close()
    }

    onProgress?.(0.01, 'Rendering')
    try {
      await Promise.all([videoLoop(), audioLoop()])
      check()
      onProgress?.(0.98, 'Finishing file')
      await output.finalize()
      onProgress?.(1, 'Done')
    } catch (e) {
      failed = true
      for (const r of readers.values()) await r.close()
      try {
        await output.cancel()
      } catch {
        /* ignore */
      }
      await sink.abort()
      throw e
    }
  } finally {
    for (const s of sources.values()) {
      s.image?.close()
      try {
        s.input?.dispose()
      } catch {
        /* ignore */
      }
    }
  }
}

/** Volume + fade automation for one clip inside one audio window (times relative to w0). */
function scheduleGain(gain: GainNode, clip: TimelineClip, base: number, tl0: number, tl1: number, w0: number) {
  const g = gain.gain
  g.setValueAtTime(base * fadeFactor(clip, tl0), tl0 - w0)
  const dur = clipDuration(clip)
  const points: number[] = []
  if (clip.fadeIn) points.push(clip.timelineStart + clip.fadeIn)
  if (clip.fadeOut) points.push(clip.timelineStart + dur - clip.fadeOut)
  points.push(tl1)
  for (const p of points.filter((x) => x > tl0 && x <= tl1).sort((a, b) => a - b)) g.linearRampToValueAtTime(base * fadeFactor(clip, p), p - w0)
}
