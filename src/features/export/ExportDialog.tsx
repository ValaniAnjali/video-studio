import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, Zap } from 'lucide-react'
import { Button, Field, Modal, Progress, Select } from '@/components/ui'
import { ensureFile } from '@/engine/media/mediaRegistry'
import { runExport, validateExport } from '@/engine/export/ExportManager'
import { DEFAULT_SETTINGS, estimateSizeMB, planExport, resolveOutput } from '@/engine/export/ExportPlanner'
import { ExportCancelled } from '@/engine/export/renderExport'
import { createSink, downloadBlob, SaveCancelled, supportsDiskStreaming, type ExportResult } from '@/engine/export/sink'
import { projectDuration } from '@/engine/timeline/ops'
import { formatBytes, formatTime } from '@/utils/time'
import type { ExportSettings, QualityPreset, VideoProject } from '@/types/project'

type Phase = { name: 'settings' } | { name: 'running'; progress: number; label: string } | { name: 'done'; result: ExportResult; copied: boolean } | { name: 'error'; message: string }

const QUALITY: { value: QualityPreset; label: string }[] = [
  { value: 'balanced', label: 'Balanced: good quality, reasonable size' },
  { value: 'high', label: 'High quality: larger file' },
  { value: 'small', label: 'Smaller file: more compression' },
  { value: 'original', label: 'Original-compatible: keep size, codec if possible' },
]

export default function ExportDialog({ open, onClose, project }: { open: boolean; onClose: () => void; project: VideoProject }) {
  const [settings, setSettings] = useState<ExportSettings>(DEFAULT_SETTINGS)
  const [phase, setPhase] = useState<Phase>({ name: 'settings' })
  const abortRef = useRef<AbortController | null>(null)

  const close = () => {
    setPhase({ name: 'settings' })
    onClose()
  }

  const plan = useMemo(() => planExport(project, settings), [project, settings])
  const out = resolveOutput(project, settings)
  const duration = projectDuration(project)
  const heavy = out.height >= 2160 || duration > 600
  const running = phase.name === 'running'

  const heights = [
    { value: 0, label: `Project size (${project.height}p)` },
    ...[2160, 1440, 1080, 720, 480].filter((h) => h < project.height).map((h) => ({ value: h, label: `${h}p` })),
  ]

  const start = async () => {
    const ac = new AbortController()
    abortRef.current = ac
    try {
      // The save dialog needs a fresh user gesture, so create the sink before anything slow.
      const sink = await createSink(project.name, settings.format, true)
      const problems = await validateExport(project)
      if (problems.length) {
        await sink.abort()
        setPhase({ name: 'error', message: problems.join(' ') })
        return
      }
      setPhase({ name: 'running', progress: 0, label: 'Starting' })
      const { result, plan: used } = await runExport({
        project,
        settings,
        sink,
        getFile: ensureFile,
        signal: ac.signal,
        onProgress: (p, label) => setPhase({ name: 'running', progress: p, label }),
      })
      if (result.blob) downloadBlob(result.blob, result.filename)
      setPhase({ name: 'done', result, copied: used.mode === 'convert' && !used.reencodes })
    } catch (e) {
      if (e instanceof SaveCancelled || e instanceof ExportCancelled) setPhase({ name: 'settings' })
      else {
        console.error(e)
        setPhase({ name: 'error', message: e instanceof Error ? e.message : 'Export failed.' })
      }
    }
  }

  return (
    <Modal open={open} onClose={close} title="Export video" wide locked={running}>
      {phase.name === 'running' ? (
        <div className="space-y-4">
          <Progress value={phase.progress} label={phase.label} />
          <p className="text-xs text-muted">Keep this tab open. Large projects can take a while because everything is processed on your device.</p>
          <Button onClick={() => abortRef.current?.abort()}>Cancel export</Button>
        </div>
      ) : phase.name === 'done' ? (
        <div className="space-y-4">
          <p className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="text-ok" size={18} /> Export complete
          </p>
          <p className="text-sm text-muted">
            {phase.result.filename} · {formatBytes(phase.result.size)} · {phase.result.savedToDisk ? 'saved to the location you chose' : 'downloaded'}
            {phase.copied && ' · original video data was copied (no re-encode)'}
          </p>
          <div className="flex gap-2">
            {phase.result.blob && <Button onClick={() => downloadBlob(phase.result.blob!, phase.result.filename)}>Download again</Button>}
            <Button variant="primary" onClick={close}>
              Close
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Format">
              <Select value={settings.format} onChange={(format) => setSettings({ ...settings, format })} options={[{ value: 'mp4', label: 'MP4 (works everywhere)' }, { value: 'webm', label: 'WebM (VP9, great for web)' }]} />
            </Field>
            <Field label="Resolution">
              <Select value={settings.height} onChange={(height) => setSettings({ ...settings, height })} options={heights} />
            </Field>
            <Field label="Frame rate">
              <Select value={settings.frameRate} onChange={(frameRate) => setSettings({ ...settings, frameRate })} options={[{ value: 0, label: `Project (${project.frameRate} fps)` }, { value: 24, label: '24 fps' }, { value: 30, label: '30 fps' }, { value: 60, label: '60 fps' }]} />
            </Field>
            <Field label="Quality">
              <Select value={settings.quality} onChange={(quality) => setSettings({ ...settings, quality })} options={QUALITY} />
            </Field>
          </div>

          <div className="rounded-lg border border-line bg-bg p-3.5 text-sm">
            <p className="flex items-center gap-2 font-medium">
              {plan.mode === 'convert' && !plan.reencodes ? <Zap size={15} className="text-ok" /> : <Info size={15} className="text-muted" />}
              {plan.mode === 'convert' ? 'Smart Export: fast path' : 'Smart Export: full render'}
            </p>
            <p className="mt-1 text-xs text-muted">{plan.summary}</p>
            {plan.reasons.length > 0 && (
              <ul className="mt-2 list-inside list-disc text-xs text-muted">
                {plan.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-muted">
              {out.width}×{out.height} · {formatTime(duration, false)} · ≈ {estimateSizeMB(duration, out.width, out.height, settings.quality).toFixed(0)} MB (rough estimate)
            </p>
          </div>

          {heavy && (
            <p className="flex gap-2 text-xs text-warn">
              <AlertTriangle size={14} className="mt-px shrink-0" /> This is a large export (4K or over 10 minutes). It needs a fast computer and plenty of free memory and disk space.
            </p>
          )}
          {!supportsDiskStreaming() && <p className="text-xs text-muted">This browser can't stream to disk, so the file is built in memory first. For very large exports use Chrome or Edge.</p>}
          {phase.name === 'error' && <div className="rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm">{phase.message}</div>}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button variant="primary" disabled={duration <= 0} onClick={() => void start()}>
              {supportsDiskStreaming() ? 'Export & save…' : 'Export & download'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
