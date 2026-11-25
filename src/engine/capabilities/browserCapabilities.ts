import { canEncodeAudio, canEncodeVideo } from 'mediabunny'

export interface BrowserCapabilities {
  webCodecs: boolean
  opfs: boolean
  offlineAudio: boolean
  fileSystemAccess: boolean
  deviceMemoryGB: number | null
  cores: number
  encoders: { h264: boolean; vp9: boolean; av1: boolean; aac: boolean; opus: boolean }
  /** Human-readable blockers; empty when the editor can run fully. */
  problems: string[]
}

let cached: Promise<BrowserCapabilities> | null = null

export function detectCapabilities(): Promise<BrowserCapabilities> {
  cached ??= (async () => {
    const webCodecs = typeof VideoEncoder !== 'undefined' && typeof VideoDecoder !== 'undefined'
    const opfs = typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory
    const safe = async (fn: () => Promise<boolean>) => {
      try {
        return await fn()
      } catch {
        return false
      }
    }
    const [h264, vp9, av1, aac, opus] = webCodecs
      ? await Promise.all([
          safe(() => canEncodeVideo('avc')),
          safe(() => canEncodeVideo('vp9')),
          safe(() => canEncodeVideo('av1')),
          safe(() => canEncodeAudio('aac')),
          safe(() => canEncodeAudio('opus')),
        ])
      : [false, false, false, false, false]
    const problems: string[] = []
    if (!webCodecs) problems.push('This browser does not support WebCodecs. Please use a recent desktop Chrome or Edge.')
    else if (!h264 && !vp9 && !av1) problems.push('No video encoder is available, so exporting will not work in this browser.')
    return {
      webCodecs,
      opfs,
      offlineAudio: typeof OfflineAudioContext !== 'undefined',
      fileSystemAccess: typeof window !== 'undefined' && 'showSaveFilePicker' in window,
      deviceMemoryGB: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
      cores: navigator.hardwareConcurrency ?? 4,
      encoders: { h264, vp9, av1, aac, opus },
      problems,
    }
  })()
  return cached
}
