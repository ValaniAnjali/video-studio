export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

/** 83.5 -> "01:23.5"  (or "1:01:23" for hours) */
export function formatTime(seconds: number, withFraction = true): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const f = Math.floor((seconds % 1) * 10)
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m).padStart(2, '0')
  const base = `${h > 0 ? h + ':' : ''}${mm}:${String(s).padStart(2, '0')}`
  return withFraction ? `${base}.${f}` : base
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return '–'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024
    i++
  }
  return `${bytes.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

/** Snap a time to the project's frame grid. */
export const snapToFrame = (t: number, fps: number) => Math.round(t * fps) / fps
