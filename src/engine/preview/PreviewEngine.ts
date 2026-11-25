/**
 * Live preview: composites the timeline onto a canvas using HTMLVideoElement / ImageBitmap
 * and plays audio through HTMLMediaElements. It never exports anything - it only *reads*
 * the project model, so the editing model stays the single source of truth.
 *
 * Preview audio is limited to 100% volume (browser media elements cap at 1.0); boosts above
 * 100% are applied in the exported file.
 */
import type { MediaAsset, TimelineClip, TimelineTrack, VideoProject } from '@/types/project'
import { clipsAt, getAsset, projectDuration } from '@/engine/timeline/ops'
import { getFile, getUrl } from '@/engine/media/mediaRegistry'
import { clipOpacityAt, drawFit, drawText, fadeFactor, filterString } from './VideoCompositor'

type MediaEl = HTMLVideoElement | HTMLAudioElement

const MAX_PREVIEW_WIDTH = 960
const DRIFT = 0.3 // seconds of allowed drift before re-seeking a playing element

export class PreviewEngine {
  onTime: (t: number) => void = () => {}
  onEnded: () => void = () => {}

  private ctx: CanvasRenderingContext2D
  private project: VideoProject
  private els = new Map<string, MediaEl>() // key: clip id
  private images = new Map<string, ImageBitmap>() // key: asset id
  private loadingImages = new Set<string>()
  private time = 0
  private playing = false
  private raf = 0
  private wallStart = 0
  private timeStart = 0
  private renderToken = 0
  private disposed = false

  private canvas: HTMLCanvasElement

  constructor(canvas: HTMLCanvasElement, project: VideoProject) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    this.project = project
    this.resize()
    this.draw()
  }

  get currentTime() {
    return this.time
  }

  setProject(project: VideoProject) {
    const sizeChanged = project.width !== this.project.width || project.height !== this.project.height
    this.project = project
    if (sizeChanged) this.resize()
    this.prune()
    if (this.playing) return // next tick picks up changes
    void this.renderPaused()
  }

  async seek(t: number) {
    this.time = Math.max(0, t)
    if (this.playing) {
      this.timeStart = this.time
      this.wallStart = performance.now()
      return
    }
    await this.renderPaused()
  }

  play() {
    if (this.playing || this.disposed) return
    const dur = projectDuration(this.project)
    if (dur <= 0) return this.onEnded()
    if (this.time >= dur - 0.01) this.time = 0
    this.playing = true
    this.timeStart = this.time
    this.wallStart = performance.now()
    this.raf = requestAnimationFrame(this.tick)
  }

  pause() {
    if (!this.playing) return
    this.playing = false
    cancelAnimationFrame(this.raf)
    for (const el of this.els.values()) el.pause()
    void this.renderPaused()
  }

  dispose() {
    this.disposed = true
    this.playing = false
    cancelAnimationFrame(this.raf)
    for (const el of this.els.values()) {
      el.pause()
      el.removeAttribute('src')
      el.load()
    }
    this.els.clear()
    for (const b of this.images.values()) b.close()
    this.images.clear()
  }

  // ---------- internals ----------

  private resize() {
    const { width, height } = this.project
    const scale = Math.min(1, MAX_PREVIEW_WIDTH / width)
    this.canvas.width = Math.max(2, Math.round(width * scale))
    this.canvas.height = Math.max(2, Math.round(height * scale))
  }

  private prune() {
    const live = new Set(this.project.tracks.flatMap((t) => t.clips.map((c) => c.id)))
    for (const [id, el] of this.els) {
      if (!live.has(id)) {
        el.pause()
        el.removeAttribute('src')
        el.load()
        this.els.delete(id)
      }
    }
  }

  private elementFor(clip: TimelineClip, asset: MediaAsset): MediaEl | null {
    let el = this.els.get(clip.id)
    if (el) return el
    const url = getUrl(asset.id)
    if (!url) return null
    if (asset.type === 'video') {
      const v = document.createElement('video')
      v.playsInline = true
      v.preload = 'auto'
      v.crossOrigin = 'anonymous'
      el = v
    } else if (asset.type === 'audio') {
      el = document.createElement('audio')
      el.preload = 'auto'
    } else return null
    el.src = url
    this.els.set(clip.id, el)
    return el
  }

  private imageFor(asset: MediaAsset): ImageBitmap | null {
    const hit = this.images.get(asset.id)
    if (hit) return hit
    const file = getFile(asset.id)
    if (file && !this.loadingImages.has(asset.id)) {
      this.loadingImages.add(asset.id)
      createImageBitmap(file)
        .then((b) => {
          this.images.set(asset.id, b)
          if (!this.playing) this.draw()
        })
        .catch(() => {})
    }
    return null
  }

  private srcTime(clip: TimelineClip, t: number) {
    return clip.sourceStart + (t - clip.timelineStart) * clip.playbackRate
  }

  private activeClips(t: number): { track: TimelineTrack; clip: TimelineClip; asset: MediaAsset | undefined }[] {
    const out: { track: TimelineTrack; clip: TimelineClip; asset: MediaAsset | undefined }[] = []
    for (const track of this.project.tracks)
      for (const clip of clipsAt(track, t)) out.push({ track, clip, asset: clip.text ? undefined : getAsset(this.project, clip.mediaId) })
    return out
  }

  private tick = () => {
    if (!this.playing) return
    const t = this.timeStart + (performance.now() - this.wallStart) / 1000
    const dur = projectDuration(this.project)
    if (t >= dur) {
      this.time = dur
      this.pause()
      this.onTime(this.time)
      this.onEnded()
      return
    }
    this.time = t
    this.syncPlaying(t)
    this.draw()
    this.onTime(t)
    this.raf = requestAnimationFrame(this.tick)
  }

  private syncPlaying(t: number) {
    const active = new Set<string>()
    for (const { track, clip, asset } of this.activeClips(t)) {
      if (!asset) continue
      const el = this.elementFor(clip, asset)
      if (!el) continue
      active.add(clip.id)
      const want = this.srcTime(clip, t)
      el.playbackRate = Math.min(16, Math.max(0.0625, clip.playbackRate))
      el.muted = clip.muted || track.muted
      el.volume = Math.min(1, Math.max(0, clip.volume * track.volume * fadeFactor(clip, t)))
      if (el.paused) {
        el.currentTime = want
        void el.play().catch(() => {})
      } else if (Math.abs(el.currentTime - want) > DRIFT) {
        el.currentTime = want
      }
    }
    for (const [id, el] of this.els) if (!active.has(id) && !el.paused) el.pause()
  }

  /** Paused: seek every active element to the playhead, wait for frames, then draw. */
  private async renderPaused() {
    const token = ++this.renderToken
    const t = this.time
    const waits: Promise<void>[] = []
    const active = new Set<string>()
    for (const { clip, asset } of this.activeClips(t)) {
      if (!asset) continue
      const el = this.elementFor(clip, asset)
      if (!el) continue
      active.add(clip.id)
      el.pause()
      const want = this.srcTime(clip, t)
      if (Math.abs(el.currentTime - want) > 0.02 || el.readyState < 2) waits.push(seekTo(el, want))
    }
    for (const [id, el] of this.els) if (!active.has(id)) el.pause()
    if (waits.length) await Promise.all(waits)
    if (token === this.renderToken && !this.disposed) this.draw()
  }

  private draw() {
    const { ctx, canvas } = this
    const cw = canvas.width
    const ch = canvas.height
    const t = this.time
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, cw, ch)
    for (const track of this.project.tracks) {
      if (!track.visible || track.type === 'audio') continue
      for (const clip of clipsAt(track, t)) {
        const opacity = clipOpacityAt(clip, t)
        if (clip.text) {
          drawText(ctx, cw, ch, clip.text, opacity)
          continue
        }
        const asset = getAsset(this.project, clip.mediaId)
        if (!asset) continue
        const filter = filterString(clip)
        if (asset.type === 'image') {
          const bmp = this.imageFor(asset)
          if (bmp) drawFit(ctx, bmp, bmp.width, bmp.height, cw, ch, opacity, filter)
        } else if (asset.type === 'video') {
          const el = this.els.get(clip.id) as HTMLVideoElement | undefined
          if (el && el.readyState >= 2) drawFit(ctx, el, el.videoWidth, el.videoHeight, cw, ch, opacity, filter)
        }
      }
    }
  }
}

function seekTo(el: MediaEl, time: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      el.removeEventListener('seeked', finish)
      el.removeEventListener('error', finish)
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(finish, 800)
    el.addEventListener('seeked', finish)
    el.addEventListener('error', finish)
    try {
      el.currentTime = time
    } catch {
      finish()
    }
  })
}

