/**
 * Smart Export planner: pick the cheapest processing path that still gives a correct file.
 *
 *  - "convert": a single untouched clip (optionally trimmed / muted / resized) goes through
 *    Mediabunny's Conversion, which copies the compressed packets (no quality loss, very fast)
 *    whenever the output container can hold them, and only re-encodes when it has to.
 *  - "render": anything composed (several clips, text, speed, fades, filters, overlays) is
 *    decoded, composited on a canvas and re-encoded. This is never lossless.
 *
 * The planner is a pure function so it is unit-tested without a browser.
 */
import type { ExportSettings, MediaAsset, QualityPreset, TimelineClip, VideoProject } from '@/types/project'
import { clipDuration, getAsset, projectDuration } from '@/engine/timeline/ops'

export type ExportMode = 'convert' | 'render'

export interface ExportPlan {
  mode: ExportMode
  /** Human-readable explanation shown in the export dialog. */
  summary: string
  /** Why the fast path was not possible (empty when mode is "convert"). */
  reasons: string[]
  /** Only for mode "convert". */
  single?: { clip: TimelineClip; asset: MediaAsset; muted: boolean }
  /** True when the output will be re-encoded (so quality is not preserved bit-for-bit). */
  reencodes: boolean
  duration: number
}

export const DEFAULT_SETTINGS: ExportSettings = { format: 'mp4', height: 0, frameRate: 0, quality: 'balanced' }

export function planExport(project: VideoProject, settings: ExportSettings): ExportPlan {
  const duration = projectDuration(project)
  const reasons: string[] = []

  const clips = project.tracks.flatMap((t) => t.clips.map((clip) => ({ clip, track: t })))
  const textClips = clips.filter((c) => c.clip.text)
  const mediaClips = clips.filter((c) => !c.clip.text)

  if (textClips.length) reasons.push('Text overlays must be drawn onto the video.')
  if (mediaClips.length > 1) reasons.push('Several clips are combined on the timeline.')

  const one = mediaClips.length === 1 ? mediaClips[0] : null
  const asset = one ? getAsset(project, one.clip.mediaId) : undefined
  if (one && asset) {
    const { clip, track } = one
    if (asset.type !== 'video') reasons.push('Only video clips can be exported by stream copy.')
    if (clip.playbackRate !== 1) reasons.push('The clip speed was changed.')
    if (clip.opacity !== 1 || clip.fadeIn || clip.fadeOut) reasons.push('Opacity or fades are applied.')
    if ((clip.brightness ?? 1) !== 1 || (clip.contrast ?? 1) !== 1 || (clip.saturation ?? 1) !== 1) reasons.push('Colour adjustments are applied.')
    if (!track.visible) reasons.push('The video track is hidden.')
    if (clip.timelineStart > 1e-3) reasons.push('The clip does not start at 0:00.')
    const audioChanged = clip.volume !== 1 || track.volume !== 1
    const muted = clip.muted || track.muted
    if (audioChanged && !muted) reasons.push('Audio volume was changed.')
    if (settings.frameRate && asset.frameRate && Math.abs(settings.frameRate - asset.frameRate) > 0.5) reasons.push('A different frame rate was chosen.')
  }

  const eligible = reasons.length === 0 && !!one && !!asset
  if (eligible && one && asset) {
    const forced = settings.quality !== 'original' || (settings.height > 0 && asset.height !== settings.height)
    return {
      mode: 'convert',
      duration,
      reasons: [],
      single: { clip: one.clip, asset, muted: one.clip.muted || one.track.muted },
      reencodes: forced,
      summary: forced
        ? 'Single clip: re-encoded at the chosen quality/size. Choose "Original-compatible" and keep the size to skip re-encoding.'
        : 'Fast path: the original video data is copied where the format allows it (no quality loss). Cuts that do not fall on a keyframe are re-encoded only around the cut.',
    }
  }

  return {
    mode: 'render',
    duration,
    reasons,
    reencodes: true,
    summary: 'This project is composed frame by frame and re-encoded. Re-encoding is never completely lossless.',
  }
}

/** Resolve "0 = keep" settings into concrete output numbers (even dimensions for encoders). */
export function resolveOutput(project: VideoProject, settings: ExportSettings) {
  const height = even(settings.height > 0 ? settings.height : project.height)
  const width = even((project.width / project.height) * height)
  const fps = settings.frameRate > 0 ? settings.frameRate : project.frameRate
  return { width, height, fps }
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

export const QUALITY_LEVEL: Record<QualityPreset, 'low' | 'medium' | 'high' | 'very-high'> = {
  small: 'low',
  balanced: 'medium',
  high: 'high',
  original: 'very-high',
}

/** Rough size estimate (MB) for the dialog. Deliberately approximate. */
export function estimateSizeMB(duration: number, width: number, height: number, quality: QualityPreset): number {
  const bitsPerPixel = { small: 0.04, balanced: 0.07, high: 0.11, original: 0.16 }[quality]
  const mbps = (width * height * 30 * bitsPerPixel) / 1e6
  return Math.max(0.1, ((mbps + 0.128) * duration) / 8)
}

export { clipDuration }
