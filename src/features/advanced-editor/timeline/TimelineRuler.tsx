import { useRef, type PointerEvent } from 'react'
import { useEditor } from '@/store/editorStore'
import { formatTime } from '@/utils/time'

const STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800]

/** Time ruler. Press and drag anywhere on it to scrub the playhead. */
export default function TimelineRuler({ width, zoom, duration }: { width: number; zoom: number; duration: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const step = STEPS.find((s) => s * zoom >= 80) ?? STEPS[STEPS.length - 1]
  const count = Math.ceil(width / zoom / step) + 1

  const scrub = (e: PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect()
    useEditor.getState().seek(Math.max(0, (e.clientX - rect.left) / zoom))
  }

  return (
    <div
      ref={ref}
      className="relative h-7 cursor-col-resize select-none border-b border-line bg-panel"
      style={{ width, backgroundImage: `repeating-linear-gradient(to right, #3a4150 0 1px, transparent 1px ${(step * zoom) / 5}px)`, backgroundSize: '100% 6px', backgroundPosition: 'bottom', backgroundRepeat: 'no-repeat' }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        useEditor.getState().setPlaying(false)
        scrub(e)
      }}
      onPointerMove={(e) => e.buttons === 1 && scrub(e)}
      aria-label="Timeline ruler"
    >
      {Array.from({ length: count }, (_, i) => i * step).map((t) => (
        <div key={t} className="absolute top-0 h-full border-l border-[#4a5263] pl-1 text-[10px] leading-6 text-muted" style={{ left: t * zoom }}>
          {formatTime(t, step < 1)}
        </div>
      ))}
      {/* end-of-project marker */}
      {duration > 0 && <div className="absolute top-0 h-full border-l border-dashed border-muted/60" style={{ left: duration * zoom }} />}
    </div>
  )
}
