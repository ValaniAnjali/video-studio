import { useState } from 'react'
import { ChevronLeft, ChevronRight, Play, Scissors, SkipBack, SkipForward, Trash2 } from 'lucide-react'
import { Button, Kbd, TextInput } from '@/components/ui'
import { clipDuration, clipEnd, mainTrack, projectDuration, rippleDelete } from '@/engine/timeline/ops'
import { useEditor } from '@/store/editorStore'
import { toast } from '@/store/toastStore'
import { cn } from '@/utils/cn'
import { formatTime } from '@/utils/time'
import { parseTime, ToolSection } from './shared'

export default function CutTab() {
  const project = useEditor((s) => s.project)!
  const playhead = useEditor((s) => s.playhead)
  const markIn = useEditor((s) => s.markIn)
  const markOut = useEditor((s) => s.markOut)
  const selectedClipId = useEditor((s) => s.selectedClipId)
  const st = useEditor.getState
  const [parts, setParts] = useState(3)
  const [goto, setGoto] = useState('')

  const total = projectDuration(project)
  const main = mainTrack(project)
  const segs = main ? [...main.clips].sort((a, b) => a.timelineStart - b.timelineStart) : []
  const hasGaps = segs.some((c, i) => Math.abs(c.timelineStart - (i === 0 ? 0 : clipEnd(segs[i - 1]))) > 0.02)
  const range = markIn !== null && markOut !== null && markOut - markIn >= 0.1 ? markOut - markIn : 0

  const jump = () => {
    const t = parseTime(goto)
    if (t === null) return toast.error('Type a time like 1:23 or 83 (seconds).')
    st().seek(Math.min(total, t))
    setGoto('')
  }

  if (!segs.length) return <p className="p-4 text-sm text-muted">Add a video to the timeline first (Media tab → Add). The cut and split tools appear here.</p>

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <ToolSection title="Skip around" hint="Jump anywhere in the video and come back. Click the ruler or drag the slider too.">
        <div className="grid grid-cols-6 gap-1">
          <Button size="sm" title="Previous cut point ([)" aria-label="Previous cut point" onClick={() => st().jumpToCut(-1)}>
            <SkipBack size={13} />
          </Button>
          <Button size="sm" title="Back 10 s" onClick={() => st().skip(-10)}>
            −10
          </Button>
          <Button size="sm" title="Back 5 s (J)" onClick={() => st().skip(-5)}>
            −5
          </Button>
          <Button size="sm" title="Forward 5 s (L)" onClick={() => st().skip(5)}>
            +5
          </Button>
          <Button size="sm" title="Forward 10 s" onClick={() => st().skip(10)}>
            +10
          </Button>
          <Button size="sm" title="Next cut point (])" aria-label="Next cut point" onClick={() => st().jumpToCut(1)}>
            <SkipForward size={13} />
          </Button>
        </div>
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            jump()
          }}
        >
          <TextInput aria-label="Go to time" placeholder={`Go to time, e.g. ${formatTime(Math.min(total, 75), false)}`} value={goto} onChange={(e) => setGoto(e.target.value)} />
          <Button type="submit" size="sm" className="h-9">
            Go
          </Button>
        </form>
      </ToolSection>

      <ToolSection title="Split" hint="Splitting never deletes anything: the video is just divided into parts you can cut, reorder or keep.">
        <Button className="w-full" onClick={() => st().splitAtPlayhead()}>
          <Scissors size={14} /> Split at playhead <Kbd>S</Kbd>
        </Button>
        <div className="flex items-center gap-1.5 text-sm">
          <span className="text-muted">or into</span>
          <input type="number" aria-label="Number of parts" min={2} max={50} value={parts} onChange={(e) => setParts(Math.max(2, Math.min(50, Math.floor(+e.target.value) || 2)))} className="h-9 w-16 rounded-md border border-line bg-bg px-2 text-center text-sm focus:border-accent focus:outline-none" />
          <span className="text-muted">equal parts</span>
          <Button size="sm" className="ml-auto h-9" aria-label="Split into equal parts" onClick={() => st().splitIntoPartsAction(parts)}>
            Split
          </Button>
        </div>
      </ToolSection>

      <ToolSection title="Cut out a section" hint="Mark where the unwanted part starts and ends, then cut it out. The video before and after join automatically.">
        <div className="grid grid-cols-2 gap-1.5">
          <Button size="sm" onClick={() => st().setMarkIn()} title="Mark In at the playhead (I)">
            Set In <Kbd>I</Kbd>
          </Button>
          <Button size="sm" onClick={() => st().setMarkOut()} title="Mark Out at the playhead (O)">
            Set Out <Kbd>O</Kbd>
          </Button>
        </div>
        <p className="rounded-md bg-bg px-2.5 py-1.5 font-mono text-xs" data-testid="mark-status">
          In {markIn === null ? '--:--' : formatTime(markIn)} · Out {markOut === null ? '--:--' : formatTime(markOut)}
          {range > 0 && <span className="text-accent"> · {range.toFixed(1)} s</span>}
        </p>
        <Button variant="primary" className="w-full" disabled={!range} onClick={() => st().cutMarked({ ripple: true })}>
          <Scissors size={14} /> Cut out section &amp; join <Kbd>X</Kbd>
        </Button>
        <div className="grid grid-cols-2 gap-1.5">
          <Button size="sm" disabled={!range} onClick={() => st().cutMarked({ ripple: false })} title="Remove the section but leave an empty gap">
            Cut, keep gap
          </Button>
          <Button size="sm" disabled={!range} onClick={() => st().keepMarked()} title="Delete everything except the marked section">
            Keep only this
          </Button>
        </div>
        {(markIn !== null || markOut !== null) && (
          <Button size="sm" variant="ghost" onClick={() => st().clearMarks()}>
            Clear marks
          </Button>
        )}
      </ToolSection>

      <ToolSection title={`Parts (${segs.length})`} hint="Click a part to select it. Cut removes it and the parts around it join. Arrows change the order.">
        <ol className="space-y-1.5">
          {segs.map((c, i) => {
            const selected = c.id === selectedClipId
            const active = playhead >= c.timelineStart - 0.001 && playhead < clipEnd(c)
            return (
              <li key={c.id} className={cn('flex items-center gap-1 rounded-lg border bg-panel2 p-1.5', selected ? 'border-accent' : 'border-line')} data-testid="segment">
                <button
                  className="flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-raise"
                  onClick={() => {
                    st().select(c.id)
                    st().seek(c.timelineStart)
                  }}
                  aria-label={`Select part ${i + 1}`}
                >
                  <span className={cn('grid h-5 w-5 shrink-0 place-items-center rounded text-[11px] font-semibold', active ? 'bg-accent text-accent-fg' : 'bg-raise text-muted')}>{i + 1}</span>
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-xs">
                      {formatTime(c.timelineStart, false)} → {formatTime(clipEnd(c), false)}
                    </span>
                    <span className="block text-[11px] text-muted">{clipDuration(c).toFixed(1)} s</span>
                  </span>
                </button>
                <IconBtn label={`Play part ${i + 1}`} onClick={() => (st().select(c.id), st().seek(c.timelineStart), st().setPlaying(true))}>
                  <Play size={12} />
                </IconBtn>
                <IconBtn label={`Move part ${i + 1} earlier`} disabled={i === 0} onClick={() => st().moveSegmentAction(c.id, -1)}>
                  <ChevronLeft size={13} />
                </IconBtn>
                <IconBtn label={`Move part ${i + 1} later`} disabled={i === segs.length - 1} onClick={() => st().moveSegmentAction(c.id, 1)}>
                  <ChevronRight size={13} />
                </IconBtn>
                <IconBtn label={`Cut part ${i + 1}`} danger onClick={() => st().commit((p) => rippleDelete(p, c.id))}>
                  <Trash2 size={12} />
                </IconBtn>
              </li>
            )
          })}
        </ol>
        {hasGaps && (
          <Button size="sm" className="w-full" onClick={() => st().closeMainGaps()}>
            Remove gaps &amp; join parts
          </Button>
        )}
        <p className="text-[11px] text-muted">Cut removes the part and joins its neighbours. Undo: Ctrl/⌘ Z.</p>
      </ToolSection>
    </div>
  )
}

function IconBtn({ label, onClick, disabled, danger, children }: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; children: React.ReactNode }) {
  return (
    <button aria-label={label} title={label} disabled={disabled} onClick={onClick} className={cn('grid h-7 w-7 shrink-0 place-items-center rounded text-muted hover:bg-raise hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent', danger && 'hover:bg-bad/20 hover:text-bad')}>
      {children}
    </button>
  )
}
