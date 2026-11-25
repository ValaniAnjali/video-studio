/**
 * Drawing helpers shared by the live preview and the exporter, so what you see in the
 * preview is what ends up in the exported file.
 */
import type { TimelineClip, TextStyle } from '@/types/project'
import { clipDuration } from '@/engine/timeline/ops'

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** 0..1 multiplier from the clip's fade in / fade out at a timeline time. */
export function fadeFactor(clip: TimelineClip, t: number): number {
  const local = t - clip.timelineStart
  const dur = clipDuration(clip)
  let f = 1
  if (clip.fadeIn && clip.fadeIn > 0) f = Math.min(f, Math.max(0, local / clip.fadeIn))
  if (clip.fadeOut && clip.fadeOut > 0) f = Math.min(f, Math.max(0, (dur - local) / clip.fadeOut))
  return Math.min(1, Math.max(0, f))
}

export const clipOpacityAt = (clip: TimelineClip, t: number) => clip.opacity * fadeFactor(clip, t)

export function filterString(clip: TimelineClip): string {
  const b = clip.brightness ?? 1
  const c = clip.contrast ?? 1
  const s = clip.saturation ?? 1
  return b === 1 && c === 1 && s === 1 ? 'none' : `brightness(${b}) contrast(${c}) saturate(${s})`
}

/** Draw an image/video frame centred and scaled to fit ("contain") inside the canvas. */
export function drawFit(ctx: Ctx2D, src: CanvasImageSource, sw: number, sh: number, cw: number, ch: number, opacity: number, filter = 'none') {
  if (!sw || !sh || opacity <= 0) return
  const scale = Math.min(cw / sw, ch / sh)
  const w = sw * scale
  const h = sh * scale
  ctx.save()
  ctx.globalAlpha = opacity
  if (filter !== 'none') ctx.filter = filter
  ctx.drawImage(src, (cw - w) / 2, (ch - h) / 2, w, h)
  ctx.restore()
}

export function drawText(ctx: Ctx2D, cw: number, ch: number, text: TextStyle, opacity = 1) {
  if (opacity <= 0 || !text.content) return
  const px = Math.max(8, (text.fontSize / 100) * ch)
  ctx.save()
  ctx.globalAlpha = opacity
  ctx.font = `${text.bold ? 700 : 500} ${px}px ui-sans-serif, system-ui, "Segoe UI", Roboto, Arial, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const lines = text.content.split('\n')
  const lh = px * 1.25
  const widest = Math.max(...lines.map((l) => ctx.measureText(l).width))
  const cx = text.x * cw
  const cy = text.y * ch
  const top = cy - ((lines.length - 1) * lh) / 2
  if (text.background) {
    const padX = px * 0.5
    const padY = px * 0.25
    ctx.fillStyle = text.background
    ctx.fillRect(cx - widest / 2 - padX, top - lh / 2 - padY, widest + padX * 2, lines.length * lh + padY * 2)
  }
  ctx.fillStyle = text.color
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = text.background ? 0 : px * 0.15
  lines.forEach((l, i) => ctx.fillText(l, cx, top + i * lh))
  ctx.restore()
}
