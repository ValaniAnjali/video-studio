import { useEffect, useMemo, useRef, type DragEvent } from 'react'
import { Eye, EyeOff, Lock, LockOpen, Magnet, Minus, Pause, Play, Plus, Scissors, Trash2, Volume2, VolumeX, Maximize, ChevronsLeftRight } from 'lucide-react'
import { Button } from '@/components/ui'
import { getAsset, projectDuration, trackAccepts, updateTrack } from '@/engine/timeline/ops'
import { ASSET_DRAG_TYPE } from '@/features/media-library/MediaPanel'
import { useEditor } from '@/store/editorStore'
import { toast } from '@/store/toastStore'
import { cn } from '@/utils/cn'
import type { TimelineTrack, TrackType } from '@/types/project'
import TimelineClip from './timeline/TimelineClip'
import TimelineRuler from './timeline/TimelineRuler'

const LABEL_W = 152
const ROW_H: Record<TrackType, number> = { video: 60, overlay: 52, text: 40, audio: 52 }
const GROUP_ORDER: TrackType[] = ['text', 'overlay', 'video', 'audio']

const TRACK_DOT: Record<TrackType, string> = { video: 'bg-t-video', audio: 'bg-t-audio', text: 'bg-t-text', overlay: 'bg-t-overlay' }

export default function TimelinePanel() {
  const project = useEditor((s) => s.project)!
  const zoom = useEditor((s) => s.zoom)
  const playhead = useEditor((s) => s.playhead)
  const playing = useEditor((s) => s.playing)
  const selectedClipId = useEditor((s) => s.selectedClipId)
  const selectedTrackId = useEditor((s) => s.selectedTrackId)
  const ripple = useEditor((s) => s.ripple)
  const snap = useEditor((s) => s.snap)
  const markIn = useEditor((s) => s.markIn)
  const markOut = useEditor((s) => s.markOut)
  const scrollRef = useRef<HTMLDivElement>(null)
  const st = useEditor.getState

  const duration = projectDuration(project)
  const width = Math.max(duration + 20, 40) * zoom

  // Visual order: text, overlay, video (later tracks on top within a group), audio.
  const rows = useMemo(() => {
    const out: TimelineTrack[] = []
    for (const type of GROUP_ORDER) out.push(...project.tracks.filter((t) => t.type === type).reverse())
    return out
  }, [project.tracks])

  // Keep the playhead in view while playing.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !playing) return
    const x = playhead * zoom
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - LABEL_W - 40) el.scrollLeft = Math.max(0, x - 80)
  }, [playhead, playing, zoom])

  // Ctrl/⌘ + wheel zooms the timeline.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const h = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      st().setZoom(st().zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15))
    }
    el.addEventListener('wheel', h, { passive: false })
    return () => el.removeEventListener('wheel', h)
  }, [st])

  const fit = () => {
    const el = scrollRef.current
    if (el && duration > 0) st().setZoom((el.clientWidth - LABEL_W - 40) / duration)
  }

  const onDrop = (e: DragEvent, track: TimelineTrack) => {
    const id = e.dataTransfer.getData(ASSET_DRAG_TYPE)
    if (!id) return
    e.preventDefault()
    const asset = getAsset(project, id)
    if (!asset) return
    if (!trackAccepts(track.type, asset.type)) return toast.error(`A ${asset.type} can't go on a ${track.type} track.`)
    const rect = e.currentTarget.getBoundingClientRect()
    st().addAssetToTimeline(asset, { trackId: track.id, start: Math.max(0, (e.clientX - rect.left) / zoom) })
  }

  const hasClips = project.tracks.some((t) => t.clips.length)

  return (
    <section className="flex min-h-0 min-w-0 flex-col border-t border-line bg-panel" aria-label="Timeline">
      {/* controls */}
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-line px-3">
        <Button variant="subtle" size="icon" aria-label={playing ? 'Pause' : 'Play'} onClick={() => st().setPlaying(!playing)} disabled={duration <= 0}>
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => st().splitAtPlayhead()} disabled={!hasClips} title="Split at playhead (S)">
          <Scissors size={14} /> Split
        </Button>
        <Button size="sm" variant="ghost" onClick={() => st().deleteSelected()} disabled={!selectedClipId} title="Delete (Del) · Shift+Del ripples">
          <Trash2 size={14} /> Delete
        </Button>
        <span className="mx-1 h-5 w-px bg-line" />
        <Button size="sm" variant="ghost" active={ripple} onClick={() => st().toggleRipple()} title="Ripple: deleting a clip closes the gap">
          <ChevronsLeftRight size={14} /> Ripple
        </Button>
        <Button size="sm" variant="ghost" active={snap} onClick={() => st().toggleSnap()} title="Snap to clip edges and the playhead">
          <Magnet size={14} /> Snap
        </Button>
        <span className="mx-1 h-5 w-px bg-line" />
        {(['video', 'audio', 'overlay'] as const).map((t) => (
          <Button key={t} size="sm" variant="ghost" onClick={() => st().addTrackOfType(t)} title={`Add ${t} track`}>
            <Plus size={12} /> <span className="capitalize">{t}</span>
          </Button>
        ))}
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="icon" variant="ghost" aria-label="Zoom out" onClick={() => st().setZoom(zoom / 1.3)}>
            <Minus size={14} />
          </Button>
          <input type="range" aria-label="Timeline zoom" className="w-24" min={Math.log(8)} max={Math.log(600)} step={0.01} value={Math.log(zoom)} onChange={(e) => st().setZoom(Math.exp(+e.target.value))} />
          <Button size="icon" variant="ghost" aria-label="Zoom in" onClick={() => st().setZoom(zoom * 1.3)}>
            <Plus size={14} />
          </Button>
          <Button size="icon" variant="ghost" aria-label="Fit timeline" onClick={fit} title="Fit to window">
            <Maximize size={14} />
          </Button>
        </div>
      </div>

      {/* tracks */}
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto" data-testid="timeline-scroll">
        <div className="relative" style={{ width: width + LABEL_W, minWidth: '100%' }}>
          <div className="sticky top-0 z-30 flex bg-panel">
            <div className="sticky left-0 z-40 flex h-7 shrink-0 items-center border-b border-r border-line bg-panel px-3 text-[11px] text-muted" style={{ width: LABEL_W }}>
              Tracks
            </div>
            <TimelineRuler width={width} zoom={zoom} duration={duration} />
          </div>

          {rows.map((track) => (
            <div key={track.id} className="flex border-b border-line" style={{ height: ROW_H[track.type] }}>
              <TrackHeader track={track} selected={selectedTrackId === track.id} />
              <div
                data-track-id={track.id}
                data-testid={`track-${track.type}`}
                className={cn('relative bg-bg/60', track.locked && 'bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgba(255,255,255,0.03)_6px_12px)]')}
                style={{ width }}
                onPointerDown={(e) => {
                  if (e.target !== e.currentTarget) return
                  st().select(null)
                  st().selectTrack(null)
                  st().setPlaying(false)
                  st().seek(Math.max(0, (e.clientX - e.currentTarget.getBoundingClientRect().left) / zoom))
                }}
                onDragOver={(e) => e.dataTransfer.types.includes(ASSET_DRAG_TYPE) && (e.preventDefault(), (e.dataTransfer.dropEffect = 'copy'))}
                onDrop={(e) => onDrop(e, track)}
              >
                {track.clips.map((clip) => (
                  <TimelineClip key={clip.id} clip={clip} track={track} asset={clip.text ? undefined : getAsset(project, clip.mediaId)} zoom={zoom} selected={clip.id === selectedClipId} height={ROW_H[track.type]} />
                ))}
              </div>
            </div>
          ))}

          {!hasClips && (
            <div className="pointer-events-none absolute left-[152px] right-0 top-20 text-center text-sm text-muted">Import media on the left, then press Add or drag it onto a track.</div>
          )}

          {/* In / Out range for the cut tools */}
          {markIn !== null && (
            <div className="pointer-events-none absolute bottom-0 top-0 z-10 border-l-2 border-accent bg-accent/15" style={{ left: LABEL_W + markIn * zoom, width: markOut !== null ? (markOut - markIn) * zoom : 0, borderRight: markOut !== null ? '2px solid var(--color-accent)' : undefined }} data-testid="mark-range">
              <span className="absolute left-1 top-8 rounded bg-accent px-1 text-[10px] font-semibold text-accent-fg">{markOut !== null ? 'CUT' : 'IN'}</span>
            </div>
          )}
          {markIn === null && markOut !== null && <div className="pointer-events-none absolute bottom-0 top-0 z-10 border-l-2 border-accent" style={{ left: LABEL_W + markOut * zoom }} />}

          {/* playhead */}
          <div className="pointer-events-none absolute bottom-0 top-0 z-20 w-px bg-accent" style={{ left: LABEL_W + playhead * zoom }} data-testid="playhead">
            <div className="absolute -left-[5px] top-0 h-0 w-0 border-x-[5px] border-t-[8px] border-x-transparent border-t-accent" />
          </div>
        </div>
      </div>
    </section>
  )
}

function TrackHeader({ track, selected }: { track: TimelineTrack; selected: boolean }) {
  const st = useEditor.getState
  const hasAudio = track.type !== 'text'
  const visual = track.type !== 'audio'
  const toggle = (patch: Partial<TimelineTrack>) => st().commit((p) => updateTrack(p, track.id, patch))
  return (
    <div
      className={cn('sticky left-0 z-10 flex shrink-0 flex-col justify-center gap-1 border-r border-line bg-panel px-2.5', selected && 'bg-raise')}
      style={{ width: LABEL_W }}
      onPointerDown={() => st().selectTrack(track.id)}
    >
      <div className="flex items-center gap-1.5">
        <span className={cn('h-2 w-2 shrink-0 rounded-full', TRACK_DOT[track.type])} />
        <span className="truncate text-xs font-medium" title={track.name}>
          {track.name}
        </span>
      </div>
      <div className="flex gap-0.5 text-muted">
        {hasAudio && (
          <IconToggle label={track.muted ? 'Unmute track' : 'Mute track'} on={track.muted} onClick={() => toggle({ muted: !track.muted })}>
            {track.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
          </IconToggle>
        )}
        {visual && (
          <IconToggle label={track.visible ? 'Hide track' : 'Show track'} on={!track.visible} onClick={() => toggle({ visible: !track.visible })}>
            {track.visible ? <Eye size={13} /> : <EyeOff size={13} />}
          </IconToggle>
        )}
        <IconToggle label={track.locked ? 'Unlock track' : 'Lock track'} on={track.locked} onClick={() => toggle({ locked: !track.locked })}>
          {track.locked ? <Lock size={13} /> : <LockOpen size={13} />}
        </IconToggle>
      </div>
    </div>
  )
}

function IconToggle({ label, on, onClick, children }: { label: string; on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button aria-label={label} title={label} aria-pressed={on} onPointerDown={(e) => e.stopPropagation()} onClick={onClick} className={cn('grid h-5 w-6 place-items-center rounded hover:bg-bg hover:text-fg', on && 'text-accent')}>
      {children}
    </button>
  )
}

