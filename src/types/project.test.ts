import { describe, expect, it } from 'vitest'
import { createEmptyProject, appendAsset } from '@/engine/timeline/ops'
import { videoProjectSchema } from './project'
import { projectFromJson, projectToJson } from '@/services/storage'

describe('project format', () => {
  it('round-trips through JSON (the backup format)', () => {
    const p = createEmptyProject('Roundtrip')
    const asset = { id: 'a', name: 'x.mp4', type: 'video' as const, duration: 5, size: 10, mimeType: 'video/mp4', hasAudio: true, storageId: 's' }
    const withClip = appendAsset({ ...p, assets: [asset] }, p.tracks[0].id, asset)
    const again = projectFromJson(projectToJson(withClip))
    expect(again.name).toBe('Roundtrip')
    expect(again.tracks[0].clips.length).toBe(1)
  })

  it('rejects garbage instead of loading it', () => {
    expect(() => projectFromJson('{"hello":1}')).toThrow()
    expect(videoProjectSchema.safeParse(null).success).toBe(false)
  })

  it('contains no processing-library objects (library-independent format)', () => {
    const json = projectToJson(createEmptyProject('x'))
    expect(json).not.toMatch(/ffmpeg|mediabunny/i)
  })
})
