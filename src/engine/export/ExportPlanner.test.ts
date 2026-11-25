import { beforeEach, describe, expect, it } from 'vitest'
import { setIdGenerator } from '@/utils/id'
import type { ExportSettings, MediaAsset, VideoProject } from '@/types/project'
import { addClip, appendAsset, createEmptyProject, createTextClip, trimClip, updateClip, updateTrack } from '@/engine/timeline/ops'
import { estimateSizeMB, planExport, resolveOutput } from './ExportPlanner'

const video: MediaAsset = { id: 'v1', name: 'a.mp4', type: 'video', duration: 60, size: 1, mimeType: 'video/mp4', hasAudio: true, width: 1920, height: 1080, frameRate: 30, storageId: 's' }
const original: ExportSettings = { format: 'mp4', height: 0, frameRate: 0, quality: 'original' }

let base: VideoProject
let vt: string

beforeEach(() => {
  let n = 0
  setIdGenerator(() => `id${++n}`)
  base = { ...createEmptyProject('t'), assets: [video] }
  vt = base.tracks[0].id
})

describe('planExport (Smart Export)', () => {
  it('uses the fast path for one untouched clip', () => {
    const p = appendAsset(base, vt, video)
    const plan = planExport(p, original)
    expect(plan.mode).toBe('convert')
    expect(plan.reencodes).toBe(false)
    expect(plan.reasons).toEqual([])
  })

  it('stays on the fast path for a trimmed, muted clip', () => {
    let p = appendAsset(base, vt, video)
    const id = p.tracks[0].clips[0].id
    p = trimClip(p, id, 'end', 20)
    p = updateClip(p, id, { muted: true })
    const plan = planExport(p, original)
    expect(plan.mode).toBe('convert')
    expect(plan.single?.muted).toBe(true)
  })

  it('marks the fast path as re-encoding when quality or size is changed', () => {
    const p = appendAsset(base, vt, video)
    expect(planExport(p, { ...original, quality: 'small' }).reencodes).toBe(true)
    expect(planExport(p, { ...original, height: 720 }).reencodes).toBe(true)
  })

  it('renders when there are several clips', () => {
    let p = appendAsset(base, vt, video)
    p = appendAsset(p, vt, video)
    const plan = planExport(p, original)
    expect(plan.mode).toBe('render')
    expect(plan.reasons.join(' ')).toMatch(/Several clips/)
  })

  it.each([
    ['speed', (p: VideoProject, id: string) => updateClip(p, id, { playbackRate: 2 }), /speed/],
    ['opacity', (p: VideoProject, id: string) => updateClip(p, id, { opacity: 0.5 }), /Opacity/],
    ['fade', (p: VideoProject, id: string) => updateClip(p, id, { fadeIn: 1 }), /fades/],
    ['colour', (p: VideoProject, id: string) => updateClip(p, id, { brightness: 1.2 }), /Colour/],
    ['volume', (p: VideoProject, id: string) => updateClip(p, id, { volume: 0.5 }), /volume/],
  ])('renders when %s is changed', (_n, edit, re) => {
    let p = appendAsset(base, vt, video)
    p = edit(p, p.tracks[0].clips[0].id)
    const plan = planExport(p, original)
    expect(plan.mode).toBe('render')
    expect(plan.reasons.join(' ')).toMatch(re)
  })

  it('renders when text is added', () => {
    let p = appendAsset(base, vt, video)
    const tt = p.tracks[2].id
    p = addClip(p, tt, createTextClip(tt, 0))
    expect(planExport(p, original).mode).toBe('render')
  })

  it('renders when a hidden track is involved or the clip is offset', () => {
    let p = appendAsset(base, vt, video)
    expect(planExport(updateTrack(p, vt, { visible: false }), original).mode).toBe('render')
    p = { ...base, tracks: base.tracks.map((t) => t) }
    const shifted = addClip(base, vt, { ...appendAsset(base, vt, video).tracks[0].clips[0], timelineStart: 5 })
    expect(planExport(shifted, original).mode).toBe('render')
  })
})

describe('resolveOutput', () => {
  it('keeps the project size and uses even dimensions', () => {
    const p = { ...base, width: 1920, height: 1080 }
    expect(resolveOutput(p, original)).toEqual({ width: 1920, height: 1080, fps: 30 })
  })
  it('scales by height keeping aspect ratio', () => {
    const o = resolveOutput({ ...base, width: 1920, height: 1080 }, { ...original, height: 720, frameRate: 24 })
    expect(o).toEqual({ width: 1280, height: 720, fps: 24 })
  })
  it('never returns odd dimensions', () => {
    const o = resolveOutput({ ...base, width: 1001, height: 563 }, { ...original, height: 333 })
    expect(o.width % 2).toBe(0)
    expect(o.height % 2).toBe(0)
  })
})

describe('estimateSizeMB', () => {
  it('grows with quality and duration', () => {
    expect(estimateSizeMB(60, 1920, 1080, 'high')).toBeGreaterThan(estimateSizeMB(60, 1920, 1080, 'small'))
    expect(estimateSizeMB(120, 1280, 720, 'balanced')).toBeGreaterThan(estimateSizeMB(60, 1280, 720, 'balanced'))
  })
})
