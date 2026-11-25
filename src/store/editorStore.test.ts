import { beforeEach, describe, expect, it } from 'vitest'
import { setIdGenerator } from '@/utils/id'
import type { MediaAsset } from '@/types/project'
import { createEmptyProject, projectDuration } from '@/engine/timeline/ops'
import { useEditor } from './editorStore'

const video: MediaAsset = { id: 'v1', name: 'a.mp4', type: 'video', duration: 60, size: 1, mimeType: 'video/mp4', hasAudio: true, width: 1280, height: 720, frameRate: 25, storageId: 's' }
const audio: MediaAsset = { id: 'a1', name: 'a.mp3', type: 'audio', duration: 10, size: 1, mimeType: 'audio/mpeg', hasAudio: true, storageId: 's2' }

const st = () => useEditor.getState()
const clips = () => st().project!.tracks.flatMap((t) => t.clips)

beforeEach(() => {
  let n = 0
  setIdGenerator(() => `id${++n}`)
  st().open({ ...createEmptyProject('t'), assets: [video, audio] })
})

describe('editor store', () => {
  it('adopts the first video size and frame rate', () => {
    st().addAssetToTimeline(video)
    expect(st().project!.width).toBe(1280)
    expect(st().project!.height).toBe(720)
    expect(st().project!.frameRate).toBe(25)
  })

  it('puts audio on an audio track and video on a video track', () => {
    st().addAssetToTimeline(video)
    st().addAssetToTimeline(audio)
    const types = st().project!.tracks.filter((t) => t.clips.length).map((t) => t.type)
    expect(types).toEqual(['video', 'audio'])
  })

  it('creates another track instead of overlapping', () => {
    st().addAssetToTimeline(video, { start: 0 })
    st().addAssetToTimeline(video, { start: 10 })
    expect(st().project!.tracks.filter((t) => t.type === 'video').length).toBe(2)
  })

  it('undo and redo restore the project', () => {
    st().addAssetToTimeline(video)
    st().seek(20)
    st().splitAtPlayhead()
    expect(clips().length).toBe(2)
    st().undo()
    expect(clips().length).toBe(1)
    st().redo()
    expect(clips().length).toBe(2)
    expect(projectDuration(st().project!)).toBe(60)
  })

  it('a gesture is ONE undo step however many live updates it has', () => {
    st().addAssetToTimeline(video)
    const id = clips()[0].id
    const before = st().past.length
    st().beginGesture()
    for (const v of [0.9, 0.8, 0.7, 0.5]) st().live((p) => ({ ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (c.id === id ? { ...c, opacity: v } : c)) })) }))
    st().endGesture()
    expect(st().past.length).toBe(before + 1)
    expect(clips()[0].opacity).toBe(0.5)
    st().undo()
    expect(clips()[0].opacity).toBe(1)
  })

  it('a gesture with no change leaves no history', () => {
    st().addAssetToTimeline(video)
    const before = st().past.length
    st().beginGesture()
    st().endGesture()
    expect(st().past.length).toBe(before)
  })

  it('ripple delete closes the gap, plain delete keeps it', () => {
    st().addAssetToTimeline(video, { start: 0 })
    const first = clips()[0].id
    st().seek(30)
    st().splitAtPlayhead() // 0-30 | 30-60
    st().select(first)
    st().deleteSelected(true)
    expect(clips().length).toBe(1)
    expect(clips()[0].timelineStart).toBe(0)
  })

  it('selection is cleared when the selected clip is undone away', () => {
    st().addAssetToTimeline(video)
    expect(st().selectedClipId).not.toBeNull()
    st().undo()
    expect(st().selectedClipId).toBeNull()
  })

  it('adds text on a text track at the playhead', () => {
    st().seek(2)
    st().addTextAtPlayhead('Hello', { fontSize: 10 })
    const text = clips().find((c) => c.text)!
    expect(text.text!.content).toBe('Hello')
    expect(text.text!.fontSize).toBe(10)
    expect(text.timelineStart).toBe(2)
  })

  describe('skip, mark and cut', () => {
    const spans = () => clips().filter((c) => !c.text).map((c) => [c.timelineStart, c.timelineStart + (c.sourceEnd - c.sourceStart) / c.playbackRate])

    it('skip moves the playhead and clamps to the project', () => {
      st().addAssetToTimeline(video)
      st().seek(10)
      st().skip(5)
      expect(st().playhead).toBe(15)
      st().skip(-100)
      expect(st().playhead).toBe(0)
      st().skip(1000)
      expect(st().playhead).toBe(60)
    })

    it('jumpToCut hops between cut points in both directions', () => {
      st().addAssetToTimeline(video)
      st().seek(20)
      st().splitAtPlayhead()
      st().seek(40)
      st().splitAtPlayhead()
      st().seek(0)
      st().jumpToCut(1)
      expect(st().playhead).toBe(20)
      st().jumpToCut(1)
      expect(st().playhead).toBe(40)
      st().jumpToCut(-1)
      expect(st().playhead).toBe(20)
    })

    it('mark In/Out then cut removes the section and joins the sides in ONE undo step', () => {
      st().addAssetToTimeline(video)
      const before = st().past.length
      st().seek(10)
      st().setMarkIn()
      st().seek(25)
      st().setMarkOut()
      expect(st().cutMarked({ ripple: true })).toBe(true)
      expect(spans()).toEqual([[0, 10], [10, 45]])
      expect(st().past.length).toBe(before + 1)
      expect(st().markIn).toBeNull()
      st().undo()
      expect(spans()).toEqual([[0, 60]])
    })

    it('cutMarked does nothing without a valid range', () => {
      st().addAssetToTimeline(video)
      st().seek(10)
      st().setMarkIn()
      expect(st().cutMarked()).toBe(false)
      st().seek(10.05)
      st().setMarkOut()
      expect(st().cutMarked()).toBe(false)
      expect(spans()).toEqual([[0, 60]])
    })

    it('setting Out before In clears the stale mark instead of making a negative range', () => {
      st().seek(30)
      st().setMarkIn()
      st().seek(10)
      st().setMarkOut()
      expect(st().markOut).toBe(10)
      expect(st().markIn).toBeNull()
    })

    it('split into 3 parts then cutting the middle one joins parts 1 and 3', () => {
      st().addAssetToTimeline(video)
      st().splitIntoPartsAction(3)
      expect(spans()).toEqual([[0, 20], [20, 40], [40, 60]])
      const middle = clips()[1].id
      st().select(middle)
      st().deleteSelected(true)
      expect(spans()).toEqual([[0, 20], [20, 40]])
      expect(clips().map((c) => [c.sourceStart, c.sourceEnd])).toEqual([[0, 20], [40, 60]])
    })

    it('keepMarked keeps only the section', () => {
      st().addAssetToTimeline(video)
      st().seek(10)
      st().setMarkIn()
      st().seek(30)
      st().setMarkOut()
      expect(st().keepMarked()).toBe(true)
      expect(spans()).toEqual([[0, 20]])
      expect(clips()[0].sourceStart).toBe(10)
    })
  })

  describe('merge', () => {
    const video2: MediaAsset = { ...video, id: 'v2', name: 'b.mp4', duration: 10 }
    const order = () => clips().map((c) => [c.mediaId, c.timelineStart])

    it('append joins a second video after the first on the same track', () => {
      st().silent((p) => ({ ...p, assets: [...p.assets, video2] }))
      st().addAssetToTimeline(video)
      st().mergeAsset(video2, 'append')
      expect(order()).toEqual([['v1', 0], ['v2', 60]])
      expect(st().project!.tracks.filter((t) => t.type === 'video').length).toBe(1)
    })

    it('insert opens a gap at the playhead (one undo step)', () => {
      st().silent((p) => ({ ...p, assets: [...p.assets, video2] }))
      st().addAssetToTimeline(video)
      const before = st().past.length
      st().seek(20)
      st().mergeAsset(video2, 'insert')
      expect(order()).toEqual([['v1', 0], ['v2', 20], ['v1', 30]])
      expect(st().past.length).toBe(before + 1)
      st().undo()
      expect(order()).toEqual([['v1', 0]])
    })

    it('cut a section of video 1, then append video 2: everything is contiguous', () => {
      st().silent((p) => ({ ...p, assets: [...p.assets, video2] }))
      st().addAssetToTimeline(video)
      st().seek(10)
      st().setMarkIn()
      st().seek(20)
      st().setMarkOut()
      st().cutMarked()
      st().mergeAsset(video2, 'append')
      expect(order()).toEqual([['v1', 0], ['v1', 10], ['v2', 50]])
    })
  })
})
