import { memo, useMemo, type PointerEvent } from 'react'
import { clipDuration, clipEnd, moveClip, snapTime, trimClip } from '@/engine/timeline/ops'
import { useEditor } from '@/store/editorStore'
import { cn } from '@/utils/cn'
import type { MediaAsset, TimelineClip as Clip, TimelineTrack } from '@/types/project'

const SNAP_PX = 8

const COLORS: Record<TimelineTrack['type'], string> = {
  video: 'bg-t-video/25 border-t-video',
  audio: 'bg-t-audio/20 border-t-audio',
  text: 'bg-t-text/25 border-t-text',
  overlay: 'bg-t-overlay/25 border-t-overlay',
}
const WAVE: Record<TimelineTrack['type'], string> = { video: 'text-t-video', audio: 'text-t-audio', text: 'text-t-text', overlay: 'text-t-overlay' }

function Waveform({ peaks, from, to, width }: { peaks: number[]; from: number; to: number; width: number }) {
  const d = useMemo(() => {
    const bars = Math.max(8, Math.min(700, Math.floor(width / 3)))
    const a = Math.floor(from * peaks.length)
    const b = Math.max(a + 1, Math.ceil(to * peaks.length))
    const slice = peaks.slice(a, b)
    let path = ''
    for (let i = 0; i < bars; i++) {
      const lo = Math.floor((i / bars) * slice.length)
      const hi = Math.max(lo + 1, Math.floor(((i + 1) / bars) * slice.length))
      let m = 0
      for (let k = lo; k < hi; k++) m = Math.max(m, slice[k] ?? 0)
      const h = Math.max(1, m * 46)
      path += `M${i + 0.5} ${50 - h}V${50 + h}`
    }
    return { path, bars }
  }, [peaks, from, to, width])
  return (
    <svg className="absolute inset-0 h-full w-full opacity-70" viewBox={`0 0 ${d.bars} 100`} preserveAspectRatio="none" aria-hidden="true">
      <path d={d.path} stroke="currentColor" strokeWidth="0.7" fill="none" />
    </svg>
  )
}

interface Props {
  clip: Clip
  track: TimelineTrack
  asset?: MediaAsset
  zoom: number
  selected: boolean
  height: number
}

function TimelineClipView({ clip, track, asset, zoom, selected, height }: Props) {
  const dur = clipDuration(clip)
  const width = Math.max(4, dur * zoom)
  const label = clip.text ? clip.text.content.replace(/\n/g, ' ') : (asset?.name ?? 'Missing media')
  const showWave = !!asset?.peaks && (asset.type === 'audio' || (asset.type === 'video' && (asset.duration ?? 0) > 0))
  const total = asset?.duration ?? 0

  // ---- drag to move (also across tracks) ----
  const onBodyDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const st = useEditor.getState()
    st.select(clip.id)
    if (track.locked) return
    const startX = e.clientX
    const startY = e.clientY
    const origStart = clip.timelineStart
    let moved = false
    st.beginGesture()

    const onMove = (ev: globalThis.PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) < 3 && Math.abs(ev.clientY - startY) < 3) return
      moved = true
      const s = useEditor.getState()
      let ns = origStart + (ev.clientX - startX) / zoom
      if (s.snap && s.project) {
        const th = SNAP_PX / zoom
        const a = snapTime(s.project, ns, th, s.playhead, clip.id)
        const b = snapTime(s.project, ns + dur, th, s.playhead, clip.id) - dur
        ns = Math.abs(a - ns) <= Math.abs(b - ns) ? a : b
      }
      const el = document.elementsFromPoint(ev.clientX, ev.clientY).find((n) => (n as HTMLElement).dataset?.trackId) as HTMLElement | undefined
      s.live((p) => moveClip(p, clip.id, ns, el?.dataset.trackId ?? track.id))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      useEditor.getState().endGesture()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  // ---- drag an edge to trim ----
  const onEdgeDown = (edge: 'start' | 'end') => (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const st = useEditor.getState()
    st.select(clip.id)
    if (track.locked) return
    const startX = e.clientX
    const origEdge = edge === 'start' ? clip.timelineStart : clipEnd(clip)
    st.beginGesture()
    const onMove = (ev: globalThis.PointerEvent) => {
      const s = useEditor.getState()
      let t = origEdge + (ev.clientX - startX) / zoom
      if (s.snap && s.project) t = snapTime(s.project, t, SNAP_PX / zoom, s.playhead, clip.id)
      s.live((p) => trimClip(p, clip.id, edge, t))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      useEditor.getState().endGesture()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div
      role="button"
      aria-label={`${track.name} clip ${label}`}
      aria-pressed={selected}
      data-clip-id={clip.id}
      onPointerDown={onBodyDown}
      className={cn('absolute top-1 overflow-hidden rounded-md border text-[11px] shadow-sm', COLORS[track.type], selected ? 'z-10 ring-2 ring-accent' : 'hover:brightness-125', track.locked ? 'cursor-not-allowed opacity-60' : 'cursor-grab active:cursor-grabbing')}
      style={{ left: clip.timelineStart * zoom, width, height: height - 8 }}
    >
      {asset?.thumbnail && asset.type !== 'audio' && <div className="absolute inset-0 opacity-50" style={{ backgroundImage: `url(${asset.thumbnail})`, backgroundSize: 'auto 100%', backgroundRepeat: 'repeat-x' }} />}
      {showWave && total > 0 && <div className={cn('absolute inset-x-0 bottom-0 h-1/2', WAVE[track.type])}><Waveform peaks={asset!.peaks!} from={clip.sourceStart / total} to={clip.sourceEnd / total} width={width} /></div>}
      <span className="pointer-events-none absolute left-1.5 top-0.5 max-w-[calc(100%-12px)] truncate rounded bg-black/55 px-1 py-px leading-4 text-white">{label}</span>
      {clip.playbackRate !== 1 && <span className="pointer-events-none absolute bottom-0.5 right-1.5 rounded bg-black/60 px-1 text-[10px] text-white">{clip.playbackRate.toFixed(2)}×</span>}
      {/* trim handles */}
      <div onPointerDown={onEdgeDown('start')} className="absolute inset-y-0 left-0 z-20 w-2 cursor-ew-resize bg-white/0 hover:bg-white/40" aria-label="Trim start" />
      <div onPointerDown={onEdgeDown('end')} className="absolute inset-y-0 right-0 z-20 w-2 cursor-ew-resize bg-white/0 hover:bg-white/40" aria-label="Trim end" />
    </div>
  )
}

export default memo(TimelineClipView)
