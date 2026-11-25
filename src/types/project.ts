/**
 * Project data model.
 *
 * IMPORTANT: this format is deliberately independent of any processing library.
 * It describes clips, tracks and times (in seconds) - never FFmpeg commands or
 * Mediabunny objects - so the engine can be swapped without breaking saved projects.
 */
import { z } from 'zod'

export const MEDIA_TYPES = ['video', 'audio', 'image'] as const
export const TRACK_TYPES = ['video', 'audio', 'text', 'overlay'] as const

export type MediaType = (typeof MEDIA_TYPES)[number]
export type TrackType = (typeof TRACK_TYPES)[number]

export const mediaAssetSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(MEDIA_TYPES),
  duration: z.number().nonnegative().optional(),
  size: z.number().nonnegative(),
  mimeType: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
  frameRate: z.number().optional(),
  hasAudio: z.boolean().default(false),
  videoCodec: z.string().nullable().optional(),
  audioCodec: z.string().nullable().optional(),
  /** Key under which the raw file lives in local storage (OPFS / IndexedDB). */
  storageId: z.string(),
  /** Small JPEG data URL used by the media library and timeline. */
  thumbnail: z.string().optional(),
  /** Normalised (0..1) audio peaks across the whole file, used to draw waveforms. */
  peaks: z.array(z.number()).optional(),
})

export const textStyleSchema = z.object({
  content: z.string(),
  fontSize: z.number().positive(), // as % of project height
  color: z.string(),
  x: z.number(), // 0..1 centre position
  y: z.number(), // 0..1 centre position
  bold: z.boolean().default(true),
  background: z.string().optional(),
})

export const timelineClipSchema = z.object({
  id: z.string(),
  /** Empty string for text clips. */
  mediaId: z.string(),
  trackId: z.string(),
  /** Position on the timeline (seconds). */
  timelineStart: z.number().nonnegative(),
  /** Portion of the source that is used (seconds). */
  sourceStart: z.number().nonnegative(),
  sourceEnd: z.number().nonnegative(),
  playbackRate: z.number().positive(),
  volume: z.number().min(0).max(2),
  muted: z.boolean(),
  opacity: z.number().min(0).max(1).default(1),
  /** Fade in/out lengths in seconds (applied to picture and sound). */
  fadeIn: z.number().min(0).optional(),
  fadeOut: z.number().min(0).optional(),
  /** Simple colour adjustments, 1 = unchanged. */
  brightness: z.number().min(0).max(3).optional(),
  contrast: z.number().min(0).max(3).optional(),
  saturation: z.number().min(0).max(3).optional(),
  text: textStyleSchema.optional(),
})

export const timelineTrackSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(TRACK_TYPES),
  clips: z.array(timelineClipSchema),
  muted: z.boolean(),
  locked: z.boolean(),
  visible: z.boolean(),
  volume: z.number().min(0).max(2),
})

export const videoProjectSchema = z.object({
  version: z.literal(1),
  id: z.string(),
  name: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  frameRate: z.number().positive(),
  assets: z.array(mediaAssetSchema),
  tracks: z.array(timelineTrackSchema),
  createdAt: z.number(),
  updatedAt: z.number(),
})

export type MediaAsset = z.infer<typeof mediaAssetSchema>
export type TextStyle = z.infer<typeof textStyleSchema>
export type TimelineClip = z.infer<typeof timelineClipSchema>
export type TimelineTrack = z.infer<typeof timelineTrackSchema>
export type VideoProject = z.infer<typeof videoProjectSchema>

export type ExportFormat = 'mp4' | 'webm'
export type QualityPreset = 'balanced' | 'high' | 'small' | 'original'

export interface ExportSettings {
  format: ExportFormat
  /** Output height in px; 0 = keep the project size. Width follows the aspect ratio. */
  height: number
  frameRate: number
  quality: QualityPreset
}
