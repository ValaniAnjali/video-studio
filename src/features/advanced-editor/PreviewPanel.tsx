import { useEffect, useRef } from 'react'
import { FastForward, Pause, Play, Rewind, SkipBack, SkipForward } from 'lucide-react'
import { Button } from '@/components/ui'
import { PreviewEngine } from '@/engine/preview/PreviewEngine'
import { projectDuration } from '@/engine/timeline/ops'
import { useEditor } from '@/store/editorStore'
import { formatTime } from '@/utils/time'

export default function PreviewPanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<PreviewEngine | null>(null)
  const project = useEditor((s) => s.project)!
  const playhead = useEditor((s) => s.playhead)
  const seekNonce = useEditor((s) => s.seekNonce)
  const playing = useEditor((s) => s.playing)
  const duration = projectDuration(project)

  useEffect(() => {
    const engine = new PreviewEngine(canvasRef.current!, useEditor.getState().project!)
    engine.onTime = (t) => useEditor.getState().setPlayheadFromPlayer(t)
    engine.onEnded = () => useEditor.getState().setPlaying(false)
    engineRef.current = engine
    void engine.seek(useEditor.getState().playhead)
    return () => {
      engine.dispose()
      engineRef.current = null
    }
  }, [])

  useEffect(() => engineRef.current?.setProject(project), [project])
  useEffect(() => void engineRef.current?.seek(useEditor.getState().playhead), [seekNonce])
  useEffect(() => {
    if (playing) engineRef.current?.play()
    else engineRef.current?.pause()
  }, [playing])

  const st = useEditor.getState()
  return (
    <section className="flex min-h-0 min-w-0 flex-col bg-bg" aria-label="Preview">
      {/* The canvas is absolutely centred so its intrinsic size can never stretch the layout. */}
      <div className="relative min-h-0 flex-1 p-3">
        <div className="relative h-full w-full">
          <canvas ref={canvasRef} className="absolute inset-0 m-auto max-h-full max-w-full bg-black shadow-[0_0_0_1px_var(--color-line)]" style={{ aspectRatio: `${project.width} / ${project.height}` }} />
        </div>
      </div>
      <div className="flex h-11 shrink-0 items-center gap-2 border-t border-line px-3">
        <Button variant="ghost" size="icon" aria-label="Go to start" onClick={() => st.seek(0)}>
          <SkipBack size={15} />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Back 5 seconds" title="Back 5 s (J)" onClick={() => st.skip(-5)}>
          <Rewind size={15} />
        </Button>
        <Button variant="subtle" size="icon" aria-label={playing ? 'Pause' : 'Play'} onClick={() => st.setPlaying(!playing)} disabled={duration <= 0}>
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </Button>
        <Button variant="ghost" size="icon" aria-label="Forward 5 seconds" title="Forward 5 s (L)" onClick={() => st.skip(5)}>
          <FastForward size={15} />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Go to end" onClick={() => st.seek(duration)}>
          <SkipForward size={15} />
        </Button>
        <span className="font-mono text-xs tabular-nums">
          {formatTime(playhead)} <span className="text-muted">/ {formatTime(duration)}</span>
        </span>
        <input
          type="range"
          aria-label="Seek"
          className="ml-2 flex-1"
          min={0}
          max={Math.max(duration, 0.01)}
          step={0.01}
          value={Math.min(playhead, duration)}
          onChange={(e) => useEditor.getState().seek(+e.target.value)}
        />
        <span className="hidden font-mono text-xs text-muted md:block">
          {project.width}×{project.height} · {project.frameRate}fps
        </span>
      </div>
    </section>
  )
}
