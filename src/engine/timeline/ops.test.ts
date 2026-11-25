import { beforeEach, describe, expect, it } from 'vitest'
import { setIdGenerator } from '@/utils/id'
import type { MediaAsset, VideoProject } from '@/types/project'
import {
  addClip, addTrack, appendAsset, clipEnd, createClipFromAsset, createEmptyProject, createTextClip, deleteClip,
  duplicateClip, findClip, moveClip, projectDuration, removeTrack, rippleDelete, snapTime, splitAllAt, splitClip,
  trimClip, updateClip, validateProject, closeGaps, cutPoints, cutRange, insertGap, keepRange, mainTrack, moveSegment, splitIntoParts,
} from './ops'
import { videoProjectSchema } from '@/types/project'

const asset: MediaAsset = { id: 'a1', name: 'clip.mp4', type: 'video', duration: 60, size: 1, mimeType: 'video/mp4', hasAudio: true, storageId: 's1' }
const audioAsset: MediaAsset = { id: 'a2', name: 'song.mp3', type: 'audio', duration: 30, size: 1, mimeType: 'audio/mpeg', hasAudio: true, storageId: 's2' }

let project: VideoProject
let videoTrack: string
let audioTrack: string

beforeEach(() => {
  let n = 0
  setIdGenerator(() => `id${++n}`)
  project = { ...createEmptyProject('t'), assets: [asset, audioAsset] }
  videoTrack = project.tracks[0].id
  audioTrack = project.tracks[1].id
})

const clips = (p: VideoProject, trackId = videoTrack) => p.tracks.find((t) => t.id === trackId)!.clips

describe('splitClip', () => {
  it('splits the 60s example at 20s into A(0-20) and B(20-60) referencing the same asset', () => {
    let p = appendAsset(project, videoTrack, asset)
    const id = clips(p)[0].id
    p = splitClip(p, id, 20)
    const [a, b] = clips(p)
    expect(a).toMatchObject({ sourceStart: 0, sourceEnd: 20, timelineStart: 0, mediaId: 'a1' })
    expect(b).toMatchObject({ sourceStart: 20, sourceEnd: 60, timelineStart: 20, mediaId: 'a1' })
    expect(a.id).not.toBe(b.id)
    expect(p.assets).toHaveLength(2) // asset list untouched
  })
  it('accounts for playback rate', () => {
    let p = appendAsset(project, videoTrack, asset)
    p = updateClip(p, clips(p)[0].id, { playbackRate: 2 }) // 30s on timeline
    p = splitClip(p, clips(p)[0].id, 10) // 10s timeline = 20s source
    expect(clips(p)[0].sourceEnd).toBeCloseTo(20)
    expect(clips(p)[1].sourceStart).toBeCloseTo(20)
    expect(clips(p)[1].timelineStart).toBe(10)
  })
  it('ignores splits at / outside the clip edges', () => {
    const p = appendAsset(project, videoTrack, asset)
    const id = clips(p)[0].id
    expect(splitClip(p, id, 0)).toBe(p)
    expect(splitClip(p, id, 60)).toBe(p)
    expect(splitClip(p, id, 99)).toBe(p)
  })
  it('does not mutate the input project', () => {
    const p = appendAsset(project, videoTrack, asset)
    const snapshot = JSON.stringify(p)
    splitClip(p, clips(p)[0].id, 20)
    expect(JSON.stringify(p)).toBe(snapshot)
  })
  it('splitAllAt splits every clip under the playhead across tracks', () => {
    let p = appendAsset(project, videoTrack, asset)
    p = appendAsset(p, audioTrack, audioAsset)
    p = splitAllAt(p, 10)
    expect(clips(p)).toHaveLength(2)
    expect(clips(p, audioTrack)).toHaveLength(2)
  })
})

describe('trimClip', () => {
  it('trims the start and advances sourceStart', () => {
    let p = appendAsset(project, videoTrack, asset)
    p = trimClip(p, clips(p)[0].id, 'start', 5)
    expect(clips(p)[0]).toMatchObject({ timelineStart: 5, sourceStart: 5, sourceEnd: 60 })
  })
  it('trims the end', () => {
    let p = appendAsset(project, videoTrack, asset)
    p = trimClip(p, clips(p)[0].id, 'end', 25)
    expect(clips(p)[0]).toMatchObject({ sourceStart: 0, sourceEnd: 25 })
  })
  it('cannot extend beyond the source media', () => {
    let p = appendAsset(project, videoTrack, asset)
    p = trimClip(p, clips(p)[0].id, 'end', 500)
    expect(clips(p)[0].sourceEnd).toBe(60)
    p = trimClip(p, clips(p)[0].id, 'start', -10)
    expect(clips(p)[0].sourceStart).toBe(0)
  })
  it('keeps a minimum duration', () => {
    let p = appendAsset(project, videoTrack, asset)
    p = trimClip(p, clips(p)[0].id, 'end', 0)
    expect(clipEnd(clips(p)[0])).toBeGreaterThan(0)
  })
})

describe('delete / ripple delete', () => {
  function threeClips() {
    let p = appendAsset(project, videoTrack, asset)
    p = splitClip(p, clips(p)[0].id, 20)
    p = splitClip(p, clips(p)[1].id, 40)
    return p // [0-20][20-40][40-60]
  }
  it('plain delete leaves a gap and keeps the asset', () => {
    let p = threeClips()
    p = deleteClip(p, clips(p)[1].id)
    expect(clips(p).map((c) => c.timelineStart)).toEqual([0, 40])
    expect(p.assets.find((a) => a.id === 'a1')).toBeDefined()
  })
  it('ripple delete of the middle clip leaves NO gap', () => {
    let p = threeClips()
    p = rippleDelete(p, clips(p)[1].id)
    const c = clips(p)
    expect(c).toHaveLength(2)
    expect(clipEnd(c[0])).toBeCloseTo(c[1].timelineStart)
    expect(projectDuration(p)).toBeCloseTo(40)
  })
})

describe('moveClip', () => {
  it('moves within a track', () => {
    let p = appendAsset(project, videoTrack, asset)
    p = moveClip(p, clips(p)[0].id, 10)
    expect(clips(p)[0].timelineStart).toBe(10)
  })
  it('refuses to create overlaps', () => {
    let p = appendAsset(project, videoTrack, asset)
    p = splitClip(p, clips(p)[0].id, 20)
    const before = p
    p = moveClip(p, clips(p)[0].id, 10)
    expect(p).toBe(before)
  })
  it('moves between compatible tracks only', () => {
    let p = appendAsset(project, videoTrack, asset)
    const id = clips(p)[0].id
    expect(moveClip(p, id, 0, audioTrack)).toBe(p)
    p = addTrack(p, 'video')
    const v2 = p.tracks[p.tracks.length - 1].id
    p = moveClip(p, id, 3, v2)
    expect(findClip(p, id)!.track.id).toBe(v2)
    expect(findClip(p, id)!.clip.trackId).toBe(v2)
  })
  it('clamps negative starts to 0', () => {
    let p = appendAsset(project, videoTrack, asset)
    p = moveClip(p, clips(p)[0].id, -5)
    expect(clips(p)[0].timelineStart).toBe(0)
  })
})

describe('add / duplicate / tracks / locking', () => {
  it('duplicates after the original, or at the end when blocked', () => {
    let p = appendAsset(project, videoTrack, asset)
    p = duplicateClip(p, clips(p)[0].id)
    expect(clips(p)).toHaveLength(2)
    expect(clips(p)[1].timelineStart).toBe(60)
    p = duplicateClip(p, clips(p)[0].id) // slot after #1 is taken
    expect(clips(p)[2].timelineStart).toBe(120)
  })
  it('addClip rejects overlaps and locked tracks', () => {
    let p = appendAsset(project, videoTrack, asset)
    expect(addClip(p, videoTrack, createClipFromAsset(asset, videoTrack, 10))).toBe(p)
    p = { ...p, tracks: p.tracks.map((t) => (t.id === videoTrack ? { ...t, locked: true } : t)) }
    expect(addClip(p, videoTrack, createClipFromAsset(asset, videoTrack, 100))).toBe(p)
    expect(deleteClip(p, clips(p)[0].id)).toBe(p)
  })
  it('adds and removes tracks', () => {
    let p = addTrack(project, 'overlay')
    expect(p.tracks.at(-1)!.type).toBe('overlay')
    p = removeTrack(p, p.tracks.at(-1)!.id)
    expect(p.tracks).toHaveLength(3)
  })
  it('text clips carry their own style and can be placed on text tracks', () => {
    const textTrack = project.tracks[2].id
    const p = addClip(project, textTrack, createTextClip(textTrack, 1, 'Hello', 2))
    expect(clips(p, textTrack)[0].text?.content).toBe('Hello')
    expect(projectDuration(p)).toBe(3)
  })
})

describe('snap + validation + schema', () => {
  it('snaps to clip edges and playhead', () => {
    let p = appendAsset(project, videoTrack, asset)
    p = splitClip(p, clips(p)[0].id, 20)
    expect(snapTime(p, 20.05, 0.1, 0)).toBe(20)
    expect(snapTime(p, 30, 0.1, 30.04)).toBe(30.04)
    expect(snapTime(p, 33, 0.1, 0)).toBe(33)
  })
  it('flags empty projects and missing media', () => {
    expect(validateProject(project).some((i) => i.level === 'error')).toBe(true)
    let p = appendAsset(project, videoTrack, asset)
    expect(validateProject(p)).toHaveLength(0)
    p = { ...p, assets: [] }
    expect(validateProject(p).some((i) => /missing media/.test(i.message))).toBe(true)
  })
  it('serialises to JSON that the zod schema accepts (round trip)', () => {
    const p = appendAsset(project, videoTrack, asset)
    const parsed = videoProjectSchema.parse(JSON.parse(JSON.stringify(p)))
    expect(parsed.tracks[0].clips[0].mediaId).toBe('a1')
  })
})

describe('cut / merge workflow', () => {
  const total = (p: VideoProject) => projectDuration(p)

  it('split in 3, cut the middle part, outer parts join (the user story)', () => {
    let p = appendAsset(project, videoTrack, asset) // 0-60
    p = splitIntoParts(p, clips(p)[0].id, 3) // 0-20 | 20-40 | 40-60
    expect(clips(p).map((c) => [c.timelineStart, clipEnd(c)])).toEqual([[0, 20], [20, 40], [40, 60]])
    p = rippleDelete(p, clips(p)[1].id)
    expect(clips(p).map((c) => [c.timelineStart, clipEnd(c)])).toEqual([[0, 20], [20, 40]])
    expect(clips(p).map((c) => [c.sourceStart, c.sourceEnd])).toEqual([[0, 20], [40, 60]])
    expect(total(p)).toBe(40)
    expect(validateProject(p).filter((i) => i.level === 'error')).toEqual([])
  })

  it('cutRange removes a middle section and joins the sides (ripple)', () => {
    let p = appendAsset(project, videoTrack, asset)
    p = cutRange(p, 10, 25, { ripple: true })
    expect(clips(p).map((c) => [c.timelineStart, clipEnd(c), c.sourceStart, c.sourceEnd])).toEqual([[0, 10, 0, 10], [10, 45, 25, 60]])
    expect(total(p)).toBe(45)
  })

  it('cutRange without ripple leaves a gap', () => {
    let p = appendAsset(project, videoTrack, asset)
    p = cutRange(p, 10, 25)
    expect(clips(p).map((c) => c.timelineStart)).toEqual([0, 25])
    expect(total(p)).toBe(60)
  })

  it('cutRange keeps audio in sync because it cuts every track', () => {
    let p = appendAsset(project, videoTrack, asset)
    p = appendAsset(p, audioTrack, audioAsset) // 0-30
    p = cutRange(p, 10, 20, { ripple: true })
    expect(clips(p, audioTrack).map((c) => [c.timelineStart, clipEnd(c)])).toEqual([[0, 10], [10, 30 - 10]])
  })

  it('cutRange spanning several clips deletes the ones fully inside', () => {
    let p = appendAsset(project, videoTrack, asset)
    p = splitIntoParts(p, clips(p)[0].id, 4) // 15s each
    p = cutRange(p, 10, 50, { ripple: true })
    expect(total(p)).toBe(20)
    expect(clips(p).every((c, i, a) => i === 0 || Math.abs(c.timelineStart - clipEnd(a[i - 1])) < 1e-6)).toBe(true)
  })

  it('keepRange keeps only the chosen section, starting at 0', () => {
    let p = appendAsset(project, videoTrack, asset)
    p = keepRange(p, 10, 30)
    expect(clips(p).map((c) => [c.timelineStart, clipEnd(c), c.sourceStart, c.sourceEnd])).toEqual([[0, 20, 10, 30]])
  })

  it('closeGaps joins clips that were cut without ripple', () => {
    let p = appendAsset(project, videoTrack, asset)
    p = cutRange(p, 10, 25)
    p = closeGaps(p, videoTrack)
    expect(clips(p).map((c) => [c.timelineStart, clipEnd(c)])).toEqual([[0, 10], [10, 45]])
  })

  it('moveSegment reorders neighbours without overlap', () => {
    let p = appendAsset(project, videoTrack, asset)
    p = splitIntoParts(p, clips(p)[0].id, 3)
    const second = clips(p)[1]
    p = moveSegment(p, second.id, -1)
    expect(clips(p).map((c) => [c.sourceStart, c.timelineStart])).toEqual([[20, 0], [0, 20], [40, 40]])
    expect(validateProject(p).filter((i) => i.level === 'error')).toEqual([])
  })

  it('insertGap opens room inside a clip for a merge-in-the-middle', () => {
    let p = appendAsset(project, videoTrack, asset)
    p = insertGap(p, 30, 10)
    expect(clips(p).map((c) => [c.timelineStart, clipEnd(c)])).toEqual([[0, 30], [40, 70]])
  })

  it('cutPoints lists every boundary and mainTrack finds the video track', () => {
    let p = appendAsset(project, videoTrack, asset)
    p = splitIntoParts(p, clips(p)[0].id, 3)
    expect(cutPoints(p)).toEqual([0, 20, 40, 60])
    expect(mainTrack(p)?.id).toBe(videoTrack)
  })

  it('locked tracks are not cut', () => {
    let p = appendAsset(project, videoTrack, asset)
    p = { ...p, tracks: p.tracks.map((t) => (t.id === videoTrack ? { ...t, locked: true } : t)) }
    expect(cutRange(p, 10, 20, { ripple: true }).tracks).toEqual(p.tracks)
  })
})
