/**
 * Editor state. The project (pure data) is the source of truth; every edit is a pure function
 * from engine/timeline/ops applied through `commit`, which records undo history.
 *
 * Drags and slider moves use a "gesture": history is recorded once for the whole gesture
 * instead of once per pointer event.
 */
import { create } from 'zustand'
import type { MediaAsset, TextStyle, TrackType, VideoProject } from '@/types/project'
import {
  addClip, addTrack, clipEnd, closeGaps, cutPoints, cutRange, insertGap, keepRange, mainTrack, moveSegment, splitIntoParts, createClipFromAsset, createTextClip, deleteClip, duplicateClip,
  findClip, overlaps, projectDuration, removeTrack, rippleDelete, splitAllAt, splitClip, trackAccepts, trackEnd,
} from '@/engine/timeline/ops'

const HISTORY_LIMIT = 100

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error'

interface EditorState {
  project: VideoProject | null
  past: VideoProject[]
  future: VideoProject[]
  gestureBase: VideoProject | null

  playhead: number
  /** Bumped when the user (not the player) moves the playhead, so the preview re-seeks. */
  seekNonce: number
  playing: boolean
  selectedClipId: string | null
  selectedTrackId: string | null
  zoom: number // pixels per second
  ripple: boolean
  snap: boolean
  saveState: SaveState
  missingAssetIds: string[]
  /** In/Out marks (timeline seconds) used by the "cut a section" tools. */
  markIn: number | null
  markOut: number | null

  open(project: VideoProject, missing?: string[]): void
  close(): void
  commit(fn: (p: VideoProject) => VideoProject): void
  /** Change the project without touching history (asset import, relink, autosave bookkeeping). */
  silent(fn: (p: VideoProject) => VideoProject): void
  beginGesture(): void
  /** Apply an edit: part of the running gesture if there is one, otherwise its own undo step. */
  edit(fn: (p: VideoProject) => VideoProject): void
  live(fn: (p: VideoProject) => VideoProject): void
  endGesture(): void
  undo(): void
  redo(): void

  seek(t: number): void
  setPlayheadFromPlayer(t: number): void
  setPlaying(v: boolean): void
  select(clipId: string | null): void
  selectTrack(trackId: string | null): void
  setZoom(z: number): void
  toggleRipple(): void
  toggleSnap(): void
  setSaveState(s: SaveState): void
  setMissing(ids: string[]): void

  // skipping around
  skip(delta: number): void
  jumpToCut(direction: -1 | 1): void
  // cut / merge tools
  setMarkIn(t?: number): void
  setMarkOut(t?: number): void
  clearMarks(): void
  cutMarked(opts?: { ripple?: boolean }): boolean
  keepMarked(): boolean
  splitIntoPartsAction(parts: number): void
  closeMainGaps(): void
  moveSegmentAction(clipId: string, direction: -1 | 1): void
  /** Put an asset after the last clip of the main video track (merge), or at the playhead (insert). */
  mergeAsset(asset: MediaAsset, mode: 'append' | 'insert'): void

  // high-level editing actions used by the UI
  splitAtPlayhead(): void
  deleteSelected(ripple?: boolean): void
  duplicateSelected(): void
  addAssetToTimeline(asset: MediaAsset, opts?: { trackId?: string; start?: number }): string | null
  addTextAtPlayhead(content?: string, style?: Partial<TextStyle>): void
  addTrackOfType(type: TrackType): void
  removeTrackById(id: string): void
}

export const useEditor = create<EditorState>((set, get) => ({
  project: null,
  past: [],
  future: [],
  gestureBase: null,
  playhead: 0,
  seekNonce: 0,
  playing: false,
  selectedClipId: null,
  selectedTrackId: null,
  zoom: 80,
  ripple: false,
  snap: true,
  saveState: 'saved',
  missingAssetIds: [],
  markIn: null,
  markOut: null,

  open: (project, missing = []) =>
    set({ project, past: [], future: [], gestureBase: null, playhead: 0, seekNonce: 0, playing: false, selectedClipId: null, selectedTrackId: null, saveState: 'saved', missingAssetIds: missing, markIn: null, markOut: null }),
  close: () => set({ project: null, past: [], future: [], gestureBase: null, playing: false, selectedClipId: null }),

  commit: (fn) => {
    const { project, past } = get()
    if (!project) return
    const next = fn(project)
    if (next === project) return
    set({ project: next, past: [...past, project].slice(-HISTORY_LIMIT), future: [], saveState: 'dirty' })
    pruneSelection()
  },
  silent: (fn) => {
    const { project } = get()
    if (!project) return
    const next = fn(project)
    if (next !== project) set({ project: next, saveState: 'dirty' })
  },
  beginGesture: () => set({ gestureBase: get().project }),
  edit: (fn) => (get().gestureBase ? get().live(fn) : get().commit(fn)),
  live: (fn) => {
    const { project } = get()
    if (!project) return
    const next = fn(project)
    if (next !== project) set({ project: next, saveState: 'dirty' })
  },
  endGesture: () => {
    const { gestureBase, project, past } = get()
    if (gestureBase && project && gestureBase !== project) set({ past: [...past, gestureBase].slice(-HISTORY_LIMIT), future: [], gestureBase: null })
    else set({ gestureBase: null })
  },
  undo: () => {
    const { past, future, project } = get()
    if (!project || !past.length) return
    set({ project: past[past.length - 1], past: past.slice(0, -1), future: [project, ...future], saveState: 'dirty' })
    pruneSelection()
  },
  redo: () => {
    const { past, future, project } = get()
    if (!project || !future.length) return
    set({ project: future[0], future: future.slice(1), past: [...past, project], saveState: 'dirty' })
    pruneSelection()
  },

  seek: (t) => set((s) => ({ playhead: Math.max(0, t), seekNonce: s.seekNonce + 1 })),
  setPlayheadFromPlayer: (t) => set({ playhead: t }),
  setPlaying: (v) => set({ playing: v }),
  select: (clipId) => set({ selectedClipId: clipId, selectedTrackId: clipId ? null : get().selectedTrackId }),
  selectTrack: (trackId) => set({ selectedTrackId: trackId, selectedClipId: trackId ? null : get().selectedClipId }),
  setZoom: (z) => set({ zoom: Math.min(600, Math.max(8, z)) }),
  toggleRipple: () => set((s) => ({ ripple: !s.ripple })),
  toggleSnap: () => set((s) => ({ snap: !s.snap })),
  setSaveState: (s) => set({ saveState: s }),
  setMissing: (ids) => set({ missingAssetIds: ids }),

  skip: (delta) => {
    const { project, playhead } = get()
    const dur = project ? projectDuration(project) : 0
    get().seek(Math.min(dur, Math.max(0, playhead + delta)))
  },
  jumpToCut: (direction) => {
    const { project, playhead } = get()
    if (!project) return
    const pts = cutPoints(project)
    const eps = 0.02
    const target = direction > 0 ? pts.find((t) => t > playhead + eps) : [...pts].reverse().find((t) => t < playhead - eps)
    if (target !== undefined) get().seek(target)
  },
  setMarkIn: (t) => {
    const { playhead, markOut } = get()
    const v = t ?? playhead
    set({ markIn: v, markOut: markOut !== null && markOut <= v ? null : markOut })
  },
  setMarkOut: (t) => {
    const { playhead, markIn } = get()
    const v = t ?? playhead
    set({ markOut: v, markIn: markIn !== null && markIn >= v ? null : markIn })
  },
  clearMarks: () => set({ markIn: null, markOut: null }),
  cutMarked: (opts) => {
    const { markIn, markOut, project } = get()
    if (!project || markIn === null || markOut === null || markOut - markIn < 0.1) return false
    const before = project
    get().commit((p) => cutRange(p, markIn, markOut, { ripple: opts?.ripple ?? true }))
    const changed = get().project !== before
    if (changed) {
      set({ markIn: null, markOut: null, selectedClipId: null })
      get().seek(Math.min(markIn, projectDuration(get().project!)))
    }
    return changed
  },
  keepMarked: () => {
    const { markIn, markOut, project } = get()
    if (!project || markIn === null || markOut === null || markOut - markIn < 0.1) return false
    const before = project
    get().commit((p) => keepRange(p, markIn, markOut))
    const changed = get().project !== before
    if (changed) {
      set({ markIn: null, markOut: null, selectedClipId: null })
      get().seek(0)
    }
    return changed
  },
  splitIntoPartsAction: (parts) => {
    const { project, selectedClipId, playhead } = get()
    if (!project) return
    const main = mainTrack(project)
    const sel = selectedClipId ? findClip(project, selectedClipId) : null
    const target = sel?.clip ?? main?.clips.find((c) => c.timelineStart <= playhead && clipEnd(c) > playhead) ?? main?.clips[0]
    if (target) get().commit((p) => splitIntoParts(p, target.id, parts))
  },
  closeMainGaps: () => {
    const main = get().project && mainTrack(get().project!)
    if (main) get().commit((p) => closeGaps(p, main.id))
  },
  moveSegmentAction: (clipId, direction) => get().commit((p) => moveSegment(p, clipId, direction)),
  mergeAsset: (asset, mode) => {
    const { project, playhead } = get()
    if (!project) return
    const main = mainTrack(project)
    if (!main || main.locked || asset.type !== 'video') {
      get().addAssetToTimeline(asset)
      return
    }
    const dur = asset.duration ?? 5
    if (mode === 'append') {
      get().addAssetToTimeline(asset, { trackId: main.id, start: trackEnd(main) })
      return
    }
    // Insert at the playhead as ONE undo step: open a gap, then place the clip in it.
    const clip = createClipFromAsset(asset, main.id, playhead)
    const next = addClip(insertGap(project, playhead, dur), main.id, clip)
    get().commit(() => next)
    set({ selectedClipId: clip.id })
  },

  splitAtPlayhead: () => {
    const { selectedClipId, playhead, project } = get()
    if (!project) return
    // Split the selected clip if the playhead is inside it, otherwise every clip under the playhead.
    const sel = selectedClipId ? findClip(project, selectedClipId) : null
    const inside = sel && playhead > sel.clip.timelineStart && playhead < clipEnd(sel.clip)
    get().commit((p) => (inside ? splitClip(p, selectedClipId!, playhead) : splitAllAt(p, playhead)))
  },
  deleteSelected: (ripple) => {
    const { selectedClipId, ripple: rippleMode } = get()
    if (!selectedClipId) return
    get().commit((p) => ((ripple ?? rippleMode) ? rippleDelete(p, selectedClipId) : deleteClip(p, selectedClipId)))
    set({ selectedClipId: null })
  },
  duplicateSelected: () => {
    const { selectedClipId } = get()
    if (selectedClipId) get().commit((p) => duplicateClip(p, selectedClipId))
  },

  addAssetToTimeline: (asset, opts = {}) => {
    const { project, playhead } = get()
    if (!project) return null
    const wantType: TrackType = asset.type === 'audio' ? 'audio' : asset.type === 'image' ? 'overlay' : 'video'
    const dur = asset.duration ?? 5
    let p = project
    let trackId = opts.trackId
    if (trackId) {
      const t = p.tracks.find((x) => x.id === trackId)
      if (!t || !trackAccepts(t.type, asset.type)) return null
    } else {
      const candidates = p.tracks.filter((t) => t.type === wantType && !t.locked)
      const start = opts.start ?? playhead
      const free = candidates.find((t) => !overlaps(t, start, dur))
      if (free) trackId = free.id
      else {
        p = addTrack(p, wantType)
        trackId = p.tracks[p.tracks.length - 1].id
      }
    }
    const track = p.tracks.find((t) => t.id === trackId)!
    let start = opts.start ?? playhead
    if (overlaps(track, start, dur)) start = trackEnd(track)
    const clip = createClipFromAsset(asset, trackId, start)
    const next = addClip(p, trackId, clip)
    if (next === p) return null
    // First video ever: adopt its size/fps so the project matches the footage.
    let final = next
    if (asset.type === 'video' && asset.width && asset.height && !project.tracks.some((t) => t.clips.length)) {
      final = { ...next, width: even(asset.width), height: even(asset.height), frameRate: asset.frameRate ? Math.round(Math.min(60, Math.max(15, asset.frameRate))) : next.frameRate }
    }
    get().commit(() => final)
    set({ selectedClipId: clip.id })
    return clip.id
  },

  addTextAtPlayhead: (content, style) => {
    const { project, playhead } = get()
    if (!project) return
    let p = project
    let track = p.tracks.find((t) => t.type === 'text' && !t.locked && !overlaps(t, playhead, 3))
    if (!track) {
      p = addTrack(p, 'text')
      track = p.tracks[p.tracks.length - 1]
    }
    const base = createTextClip(track.id, playhead, content ?? 'Your text')
    const clip = style ? { ...base, text: { ...base.text!, ...style } } : base
    const placed = addClip(p, track.id, clip)
    get().commit(() => placed)
    set({ selectedClipId: clip.id })
  },

  addTrackOfType: (type) => get().commit((p) => addTrack(p, type)),
  removeTrackById: (id) => {
    get().commit((p) => removeTrack(p, id))
    set({ selectedTrackId: null })
  },
}))

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

/** Drop selection that no longer exists after an edit/undo. */
function pruneSelection() {
  const { project, selectedClipId, selectedTrackId } = useEditor.getState()
  if (!project) return
  if (selectedClipId && !findClip(project, selectedClipId)) useEditor.setState({ selectedClipId: null })
  if (selectedTrackId && !project.tracks.some((t) => t.id === selectedTrackId)) useEditor.setState({ selectedTrackId: null })
}

export const selectDuration = (s: EditorState) => (s.project ? projectDuration(s.project) : 0)
