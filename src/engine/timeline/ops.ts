/**
 * Pure timeline operations. Every function takes a project and returns a NEW project
 * (never mutating the input), which makes undo/redo trivial and testing easy.
 * The UI never edits clips directly - it calls these.
 */
import type { MediaAsset, TimelineClip, TimelineTrack, TrackType, VideoProject } from '@/types/project'
import { uid } from '@/utils/id'

export const EPS = 1e-6
export const MIN_CLIP_DURATION = 0.05

// ---------- queries ----------

/** Duration of a clip on the timeline (source length divided by speed). */
export const clipDuration = (c: TimelineClip) => (c.sourceEnd - c.sourceStart) / c.playbackRate
export const clipEnd = (c: TimelineClip) => c.timelineStart + clipDuration(c)

export function projectDuration(p: VideoProject): number {
  let max = 0
  for (const t of p.tracks) for (const c of t.clips) max = Math.max(max, clipEnd(c))
  return max
}

export function findClip(p: VideoProject, clipId: string): { track: TimelineTrack; clip: TimelineClip } | null {
  for (const track of p.tracks) {
    const clip = track.clips.find((c) => c.id === clipId)
    if (clip) return { track, clip }
  }
  return null
}

export const getAsset = (p: VideoProject, id: string): MediaAsset | undefined => p.assets.find((a) => a.id === id)

export function trackEnd(track: TimelineTrack): number {
  return track.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0)
}

/** Clips active at a given time on a given track. */
export function clipsAt(track: TimelineTrack, t: number): TimelineClip[] {
  return track.clips.filter((c) => t >= c.timelineStart - EPS && t < clipEnd(c) - EPS)
}

/** Would [start, start+duration) collide with another clip on the track? */
export function overlaps(track: TimelineTrack, start: number, duration: number, ignoreClipId?: string): boolean {
  const end = start + duration
  return track.clips.some((c) => c.id !== ignoreClipId && start < clipEnd(c) - EPS && end > c.timelineStart + EPS)
}

/** Which asset types may be placed on which track type. */
export function trackAccepts(track: TrackType, media: MediaAsset['type'] | 'text'): boolean {
  switch (track) {
    case 'video':
    case 'overlay':
      return media === 'video' || media === 'image'
    case 'audio':
      return media === 'audio'
    case 'text':
      return media === 'text'
  }
}

// ---------- helpers ----------

function mapTracks(p: VideoProject, fn: (t: TimelineTrack) => TimelineTrack): VideoProject {
  return { ...p, tracks: p.tracks.map(fn), updatedAt: Date.now() }
}

function sortClips(clips: TimelineClip[]): TimelineClip[] {
  return [...clips].sort((a, b) => a.timelineStart - b.timelineStart)
}

// ---------- tracks ----------

const DEFAULT_TRACK_NAMES: Record<TrackType, string> = {
  video: 'Video',
  audio: 'Audio',
  text: 'Text',
  overlay: 'Overlay',
}

export function createTrack(type: TrackType, name?: string): TimelineTrack {
  return { id: uid(), name: name ?? DEFAULT_TRACK_NAMES[type], type, clips: [], muted: false, locked: false, visible: true, volume: 1 }
}

export function addTrack(p: VideoProject, type: TrackType, name?: string): VideoProject {
  const count = p.tracks.filter((t) => t.type === type).length
  const track = createTrack(type, name ?? `${DEFAULT_TRACK_NAMES[type]} ${count + 1}`)
  // Visual tracks stack on top (rendered later = on top); we keep array order = z-order bottom -> top.
  return { ...p, tracks: [...p.tracks, track], updatedAt: Date.now() }
}

export function removeTrack(p: VideoProject, trackId: string): VideoProject {
  return { ...p, tracks: p.tracks.filter((t) => t.id !== trackId), updatedAt: Date.now() }
}

export function updateTrack(p: VideoProject, trackId: string, patch: Partial<Omit<TimelineTrack, 'id' | 'clips' | 'type'>>): VideoProject {
  return mapTracks(p, (t) => (t.id === trackId ? { ...t, ...patch } : t))
}

// ---------- clips ----------

export function createClipFromAsset(asset: MediaAsset, trackId: string, timelineStart: number): TimelineClip {
  const duration = asset.duration ?? 5
  return {
    id: uid(),
    mediaId: asset.id,
    trackId,
    timelineStart,
    sourceStart: 0,
    sourceEnd: duration,
    playbackRate: 1,
    volume: 1,
    muted: false,
    opacity: 1,
  }
}

export function createTextClip(trackId: string, timelineStart: number, content = 'Your text', duration = 3): TimelineClip {
  return {
    id: uid(),
    mediaId: '',
    trackId,
    timelineStart,
    sourceStart: 0,
    sourceEnd: duration,
    playbackRate: 1,
    volume: 1,
    muted: true,
    opacity: 1,
    text: { content, fontSize: 8, color: '#ffffff', x: 0.5, y: 0.85, bold: true, background: 'rgba(0,0,0,0.45)' },
  }
}

/** Add a clip. Returns the project unchanged if the track is missing, locked or the slot is occupied. */
export function addClip(p: VideoProject, trackId: string, clip: TimelineClip): VideoProject {
  const track = p.tracks.find((t) => t.id === trackId)
  if (!track || track.locked) return p
  const placed: TimelineClip = { ...clip, trackId, timelineStart: Math.max(0, clip.timelineStart) }
  if (overlaps(track, placed.timelineStart, clipDuration(placed))) return p
  return mapTracks(p, (t) => (t.id === trackId ? { ...t, clips: sortClips([...t.clips, placed]) } : t))
}

/** Append an asset at the end of a track. */
export function appendAsset(p: VideoProject, trackId: string, asset: MediaAsset): VideoProject {
  const track = p.tracks.find((t) => t.id === trackId)
  if (!track) return p
  return addClip(p, trackId, createClipFromAsset(asset, trackId, trackEnd(track)))
}

export function deleteClip(p: VideoProject, clipId: string): VideoProject {
  const found = findClip(p, clipId)
  if (!found || found.track.locked) return p
  return mapTracks(p, (t) => (t.id === found.track.id ? { ...t, clips: t.clips.filter((c) => c.id !== clipId) } : t))
}

/** Delete a clip and close the gap: later clips on the same track move left. */
export function rippleDelete(p: VideoProject, clipId: string): VideoProject {
  const found = findClip(p, clipId)
  if (!found || found.track.locked) return p
  const { clip, track } = found
  const end = clipEnd(clip)
  const dur = clipDuration(clip)
  return mapTracks(p, (t) =>
    t.id !== track.id
      ? t
      : {
          ...t,
          clips: t.clips
            .filter((c) => c.id !== clipId)
            .map((c) => (c.timelineStart >= end - EPS ? { ...c, timelineStart: Math.max(0, c.timelineStart - dur) } : c)),
        },
  )
}

/**
 * Split a clip at a timeline time. Source boundaries are divided, so both halves keep
 * referencing the same original asset (nothing is copied).
 */
export function splitClip(p: VideoProject, clipId: string, time: number): VideoProject {
  const found = findClip(p, clipId)
  if (!found || found.track.locked) return p
  const { clip, track } = found
  const end = clipEnd(clip)
  if (time <= clip.timelineStart + MIN_CLIP_DURATION || time >= end - MIN_CLIP_DURATION) return p

  const sourceSplit = clip.sourceStart + (time - clip.timelineStart) * clip.playbackRate
  const a: TimelineClip = { ...clip, sourceEnd: sourceSplit }
  const b: TimelineClip = { ...clip, id: uid(), timelineStart: time, sourceStart: sourceSplit }
  return mapTracks(p, (t) => (t.id === track.id ? { ...t, clips: sortClips(t.clips.flatMap((c) => (c.id === clipId ? [a, b] : [c]))) } : t))
}

/** Split every unlocked clip under the playhead (what editors do for "split at playhead"). */
export function splitAllAt(p: VideoProject, time: number): VideoProject {
  let out = p
  for (const t of p.tracks) for (const c of clipsAt(t, time)) out = splitClip(out, c.id, time)
  return out
}

/** Split one clip into `parts` pieces of equal length. Each piece still references the same media. */
export function splitIntoParts(p: VideoProject, clipId: string, parts: number): VideoProject {
  const found = findClip(p, clipId)
  const n = Math.floor(parts)
  if (!found || found.track.locked || n < 2) return p
  const { clip, track } = found
  const start = clip.timelineStart
  const step = clipDuration(clip) / n
  if (step < MIN_CLIP_DURATION * 2) return p
  let out = p
  for (let i = 1; i < n; i++) {
    const t = start + i * step
    const hit = out.tracks.find((x) => x.id === track.id)!.clips.find((c) => c.timelineStart <= t + EPS && clipEnd(c) > t + EPS)
    if (hit) out = splitClip(out, hit.id, t)
  }
  return out
}

/**
 * Remove the timeline range [start, end) from every unlocked track (or only `trackIds`).
 * Clips crossing an edge are split, clips fully inside are deleted. With `ripple`, everything
 * after the range moves left, so the video before and after the cut joins seamlessly.
 */
export function cutRange(p: VideoProject, start: number, end: number, opts: { ripple?: boolean; trackIds?: string[] } = {}): VideoProject {
  if (!(end - start > MIN_CLIP_DURATION)) return p
  const len = end - start
  const keep = (c: TimelineClip) => clipDuration(c) >= MIN_CLIP_DURATION
  return mapTracks(p, (t) => {
    if (t.locked || (opts.trackIds && !opts.trackIds.includes(t.id))) return t
    const out: TimelineClip[] = []
    for (const c of t.clips) {
      const cs = c.timelineStart
      const ce = clipEnd(c)
      if (ce <= start + EPS) out.push(c)
      else if (cs >= end - EPS) out.push(opts.ripple ? { ...c, timelineStart: Math.max(0, cs - len) } : c)
      else {
        const left: TimelineClip | null = cs < start ? { ...c, sourceEnd: c.sourceStart + (start - cs) * c.playbackRate } : null
        const right: TimelineClip | null = ce > end ? { ...c, id: left ? uid() : c.id, timelineStart: opts.ripple ? start : end, sourceStart: c.sourceStart + (end - cs) * c.playbackRate } : null
        if (left && keep(left)) out.push(left)
        if (right && keep(right)) out.push(right)
      }
    }
    return { ...t, clips: sortClips(out) }
  })
}

/** Keep only [start, end): everything outside is removed and the rest slides to 0. */
export function keepRange(p: VideoProject, start: number, end: number): VideoProject {
  const total = projectDuration(p)
  let out = p
  if (end < total - EPS) out = cutRange(out, end, total + 1, { ripple: false })
  if (start > EPS) out = cutRange(out, 0, start, { ripple: true })
  return out
}

/** Slide every clip on a track left so there are no gaps (the first clip moves to 0). */
export function closeGaps(p: VideoProject, trackId: string): VideoProject {
  const track = p.tracks.find((t) => t.id === trackId)
  if (!track || track.locked) return p
  let cursor = 0
  const clips = sortClips(track.clips).map((c) => {
    const moved = { ...c, timelineStart: cursor }
    cursor += clipDuration(c)
    return moved
  })
  return mapTracks(p, (t) => (t.id === trackId ? { ...t, clips } : t))
}

/** Swap a clip with its neighbour on the same track (-1 earlier, +1 later); the pair keeps its total span. */
export function moveSegment(p: VideoProject, clipId: string, direction: -1 | 1): VideoProject {
  const found = findClip(p, clipId)
  if (!found || found.track.locked) return p
  const sorted = sortClips(found.track.clips)
  const i = sorted.findIndex((c) => c.id === clipId)
  const j = i + direction
  if (j < 0 || j >= sorted.length) return p
  const [first, second] = i < j ? [sorted[i], sorted[j]] : [sorted[j], sorted[i]]
  const gap = second.timelineStart - clipEnd(first)
  const nSecond = { ...second, timelineStart: first.timelineStart }
  const nFirst = { ...first, timelineStart: first.timelineStart + clipDuration(second) + gap }
  return mapTracks(p, (t) => (t.id === found.track.id ? { ...t, clips: sortClips(t.clips.map((c) => (c.id === nSecond.id ? nSecond : c.id === nFirst.id ? nFirst : c))) } : t))
}

/** Open a gap of `duration` seconds at `time` on all unlocked tracks (splitting clips that span it). */
export function insertGap(p: VideoProject, time: number, duration: number): VideoProject {
  let out = splitAllAt(p, time)
  out = mapTracks(out, (t) => (t.locked ? t : { ...t, clips: t.clips.map((c) => (c.timelineStart >= time - EPS ? { ...c, timelineStart: c.timelineStart + duration } : c)) }))
  return out
}

/** Every clip start/end on the timeline, sorted and de-duplicated: the "cut points" you can skip between. */
export function cutPoints(p: VideoProject): number[] {
  const pts = new Set<number>([0])
  for (const t of p.tracks) for (const c of t.clips) (pts.add(Math.round(c.timelineStart * 1000) / 1000), pts.add(Math.round(clipEnd(c) * 1000) / 1000))
  return [...pts].sort((a, b) => a - b)
}

/** The track the Cut/Merge tools work on: the first video track that has clips (else the first video track). */
export function mainTrack(p: VideoProject): TimelineTrack | undefined {
  return p.tracks.find((t) => t.type === 'video' && t.clips.length) ?? p.tracks.find((t) => t.type === 'video')
}

/**
 * Trim one edge of a clip to a timeline time. The edge is clamped so that the clip
 * stays inside its source media and keeps a minimum duration.
 */
export function trimClip(p: VideoProject, clipId: string, edge: 'start' | 'end', time: number): VideoProject {
  const found = findClip(p, clipId)
  if (!found || found.track.locked) return p
  const { clip, track } = found
  const asset = getAsset(p, clip.mediaId)
  const sourceLimit = clip.text || asset?.type === 'image' ? Infinity : (asset?.duration ?? Infinity)
  const rate = clip.playbackRate
  const end = clipEnd(clip)
  let next: TimelineClip

  if (edge === 'start') {
    const minStart = Math.max(0, clip.timelineStart - clip.sourceStart / rate) // cannot reveal before source 0
    const t = Math.min(Math.max(time, minStart), end - MIN_CLIP_DURATION)
    next = { ...clip, timelineStart: t, sourceStart: clip.sourceStart + (t - clip.timelineStart) * rate }
  } else {
    const maxEnd = clip.timelineStart + (sourceLimit - clip.sourceStart) / rate
    const t = Math.max(Math.min(time, maxEnd), clip.timelineStart + MIN_CLIP_DURATION)
    next = { ...clip, sourceEnd: clip.sourceStart + (t - clip.timelineStart) * rate }
  }
  if (overlaps(track, next.timelineStart, clipDuration(next), clipId)) return p
  return mapTracks(p, (t) => (t.id === track.id ? { ...t, clips: t.clips.map((c) => (c.id === clipId ? next : c)) } : t))
}

/**
 * Move a clip (optionally to another compatible track). No-op if the target slot is
 * occupied, so the timeline can never contain overlapping clips on one track.
 */
export function moveClip(p: VideoProject, clipId: string, newStart: number, newTrackId?: string): VideoProject {
  const found = findClip(p, clipId)
  if (!found) return p
  const { clip, track } = found
  const target = p.tracks.find((t) => t.id === (newTrackId ?? track.id))
  if (!target || target.locked || track.locked) return p
  if (target.id !== track.id && target.type !== track.type) {
    // allow video <-> overlay swaps
    const visual = (t: TrackType) => t === 'video' || t === 'overlay'
    if (!(visual(target.type) && visual(track.type))) return p
  }
  const start = Math.max(0, newStart)
  if (overlaps(target, start, clipDuration(clip), clipId)) return p
  const moved: TimelineClip = { ...clip, timelineStart: start, trackId: target.id }
  return mapTracks(p, (t) => {
    if (t.id === track.id && t.id === target.id) return { ...t, clips: sortClips(t.clips.map((c) => (c.id === clipId ? moved : c))) }
    if (t.id === track.id) return { ...t, clips: t.clips.filter((c) => c.id !== clipId) }
    if (t.id === target.id) return { ...t, clips: sortClips([...t.clips, moved]) }
    return t
  })
}

/** Duplicate right after the original if there is space, otherwise at the track end. */
export function duplicateClip(p: VideoProject, clipId: string): VideoProject {
  const found = findClip(p, clipId)
  if (!found || found.track.locked) return p
  const { clip, track } = found
  const dur = clipDuration(clip)
  const start = overlaps(track, clipEnd(clip), dur) ? trackEnd(track) : clipEnd(clip)
  return addClip(p, track.id, { ...clip, id: uid(), timelineStart: start })
}

export function updateClip(p: VideoProject, clipId: string, patch: Partial<Omit<TimelineClip, 'id' | 'trackId' | 'mediaId'>>): VideoProject {
  const found = findClip(p, clipId)
  if (!found) return p
  const next = { ...found.clip, ...patch }
  // Changing speed changes the clip length - refuse if that would collide.
  if (patch.playbackRate !== undefined && overlaps(found.track, next.timelineStart, clipDuration(next), clipId)) return p
  return mapTracks(p, (t) => (t.id === found.track.id ? { ...t, clips: t.clips.map((c) => (c.id === clipId ? next : c)) } : t))
}

export function updateText(p: VideoProject, clipId: string, patch: Partial<NonNullable<TimelineClip['text']>>): VideoProject {
  const found = findClip(p, clipId)
  if (!found?.clip.text) return p
  return updateClip(p, clipId, { text: { ...found.clip.text, ...patch } })
}

/** Set a text clip's duration on the timeline. */
export function setTextDuration(p: VideoProject, clipId: string, seconds: number): VideoProject {
  const found = findClip(p, clipId)
  if (!found?.clip.text) return p
  return trimClip(p, clipId, 'end', found.clip.timelineStart + Math.max(MIN_CLIP_DURATION, seconds))
}

// ---------- snapping ----------

/** Snap `time` to 0, the playhead or any clip edge within `threshold` seconds. */
export function snapTime(p: VideoProject, time: number, threshold: number, playhead: number, ignoreClipId?: string): number {
  const points = [0, playhead]
  for (const t of p.tracks)
    for (const c of t.clips) {
      if (c.id === ignoreClipId) continue
      points.push(c.timelineStart, clipEnd(c))
    }
  let best = time
  let bestDist = threshold
  for (const pt of points) {
    const d = Math.abs(pt - time)
    if (d < bestDist) {
      best = pt
      bestDist = d
    }
  }
  return best
}

// ---------- validation ----------

export interface ValidationIssue {
  level: 'error' | 'warning'
  message: string
}

export function validateProject(p: VideoProject): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (projectDuration(p) <= 0) issues.push({ level: 'error', message: 'The timeline is empty.' })
  for (const t of p.tracks) {
    const sorted = sortClips(t.clips)
    for (let i = 0; i < sorted.length; i++) {
      const c = sorted[i]
      if (!c.text && !getAsset(p, c.mediaId)) issues.push({ level: 'error', message: `A clip on "${t.name}" references missing media.` })
      if (c.sourceEnd - c.sourceStart <= 0) issues.push({ level: 'error', message: `A clip on "${t.name}" has zero length.` })
      if (i > 0 && clipEnd(sorted[i - 1]) > c.timelineStart + 1e-3) issues.push({ level: 'error', message: `Clips overlap on "${t.name}".` })
    }
  }
  return issues
}

export function createEmptyProject(name = 'Untitled project', width = 1920, height = 1080, frameRate = 30): VideoProject {
  const now = Date.now()
  return {
    version: 1,
    id: uid(),
    name,
    width,
    height,
    frameRate,
    assets: [],
    tracks: [createTrack('video', 'Video 1'), createTrack('audio', 'Audio 1'), createTrack('text', 'Text 1')],
    createdAt: now,
    updatedAt: now,
  }
}
