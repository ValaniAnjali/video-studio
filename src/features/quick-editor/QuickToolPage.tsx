import { useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, CheckCircle2, Download, Plus, Trash2, X } from 'lucide-react'
import { PageHeader } from '@/app/Brand'
import { Button, DropZone, Field, Progress, Select } from '@/components/ui'
import { readMedia, UnsupportedMediaError } from '@/engine/media/importer'
import { convertFile } from '@/engine/export/convertExport'
import { ExportCancelled, renderProject } from '@/engine/export/renderExport'
import { createSink, downloadBlob, SaveCancelled, safeName, supportsDiskStreaming, type ContainerKind, type ExportResult } from '@/engine/export/sink'
import { appendAsset, createEmptyProject, updateClip } from '@/engine/timeline/ops'
import { detectCapabilities } from '@/engine/capabilities/browserCapabilities'
import { formatBytes, formatTime } from '@/utils/time'
import { uid } from '@/utils/id'
import { toast } from '@/store/toastStore'
import type { ExportFormat, MediaAsset, QualityPreset } from '@/types/project'
import { toolById } from './tools'

interface Loaded {
  file: File
  asset: MediaAsset
  url: string
}

type Status = { phase: 'idle' } | { phase: 'running'; progress: number; label: string } | { phase: 'done'; results: ExportResult[] } | { phase: 'error'; message: string }

const HEIGHTS = [2160, 1440, 1080, 720, 480, 360]

export default function QuickToolPage() {
  const { tool: toolId } = useParams()
  const tool = toolById(toolId)
  const nav = useNavigate()
  const [loaded, setLoaded] = useState<Loaded[]>([])
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<Status>({ phase: 'idle' })
  const abortRef = useRef<AbortController | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  // tool parameters
  const [trim, setTrim] = useState<[number, number]>([0, 0])
  const [cuts, setCuts] = useState<number[]>([])
  const [format, setFormat] = useState<ExportFormat>('mp4')
  const [audioFmt, setAudioFmt] = useState<'wav' | 'ogg'>('wav')
  const [height, setHeight] = useState(0)
  const [quality, setQuality] = useState<QualityPreset>('balanced')
  const [rotate, setRotate] = useState<0 | 90 | 180 | 270>(90)
  const [flip, setFlip] = useState(false)
  const [speed, setSpeed] = useState(2)

  const first = loaded[0]
  const dur = first?.asset.duration ?? 0

  useEffect(() => () => loaded.forEach((l) => URL.revokeObjectURL(l.url)), [loaded])
  useEffect(() => () => abortRef.current?.abort(), [])

  // Keep preview playback inside the chosen trim range.
  useEffect(() => {
    const v = videoRef.current
    if (!v || tool?.id !== 'trim') return
    const h = () => {
      if (v.currentTime >= trim[1] - 0.02) v.pause()
    }
    v.addEventListener('timeupdate', h)
    return () => v.removeEventListener('timeupdate', h)
  }, [tool?.id, trim, first])

  const needsAudio = tool?.id === 'extract'
  const accept = needsAudio ? 'video/*,audio/*' : 'video/*'

  const onFiles = async (files: File[]) => {
    setLoading(true)
    setStatus({ phase: 'idle' })
    const out: Loaded[] = tool?.multiple ? [...loaded] : []
    for (const file of files) {
      try {
        const meta = await readMedia(file)
        if (meta.type === 'image') throw new UnsupportedMediaError('Images are not supported in this tool.')
        if (meta.type === 'audio' && !needsAudio) throw new UnsupportedMediaError('This tool needs a video file.')
        out.push({ file, asset: { ...meta, id: uid(), storageId: '' }, url: URL.createObjectURL(file) })
      } catch (e) {
        toast.error(e instanceof Error ? e.message : `Could not read ${file.name}.`)
      }
    }
    setLoaded(out)
    if (out[0]) {
      const d = out[0].asset.duration ?? 0
      setTrim([0, d])
      setCuts([])
      setFormat(out[0].file.type.includes('webm') ? 'webm' : 'mp4')
      if (tool?.id === 'convert') setFormat(out[0].file.type.includes('webm') ? 'mp4' : 'webm')
      if (tool?.id === 'compress') setQuality('small')
    }
    setLoading(false)
  }

  const heightOptions = useMemo(() => {
    const src = first?.asset.height ?? 1080
    return [{ value: 0, label: `Original${first?.asset.height ? ` (${first.asset.height}p)` : ''}` }, ...HEIGHTS.filter((h) => h < src).map((h) => ({ value: h, label: `${h}p` }))]
  }, [first])

  if (!tool || tool.comingSoon) return <Navigate to="/quick" replace />

  const current = () => videoRef.current?.currentTime ?? 0

  const run = async () => {
    if (!first) return
    const ac = new AbortController()
    abortRef.current = ac
    const kind: ContainerKind = tool.id === 'extract' ? audioFmt : format
    const base = safeName(first.file.name)
    const onProgress = (p: number, label: string) => setStatus({ phase: 'running', progress: p, label })
    setStatus({ phase: 'running', progress: 0, label: 'Starting' })
    try {
      const caps = await detectCapabilities()
      if (caps.problems.length) throw new Error(caps.problems[0])
      const results: ExportResult[] = []
      const common = { signal: ac.signal, onProgress }

      if (tool.id === 'split') {
        const bounds = [0, ...[...cuts].sort((a, b) => a - b), dur]
        const segs = bounds.slice(0, -1).map((s, i) => [s, bounds[i + 1]] as const).filter(([s, e]) => e - s > 0.1)
        for (const [i, [s, e]] of segs.entries()) {
          const sink = await createSink(`${base}-part${i + 1}`, kind, false)
          await convertFile({ file: first.file, sink, trim: { start: s, end: e }, quality: 'original', ...common, onProgress: (p, l) => onProgress((i + p) / segs.length, `${l} (part ${i + 1}/${segs.length})`) })
          results.push(await sink.finish())
        }
      } else if (tool.id === 'merge' || tool.id === 'speed') {
        const sink = await createSink(`${base}-${tool.id === 'merge' ? 'merged' : `${speed}x`}`, kind, true)
        const v = first.asset
        let p = createEmptyProject('Quick', even(v.width ?? 1920), even(v.height ?? 1080), Math.round(Math.min(60, Math.max(15, v.frameRate ?? 30))))
        const vt = p.tracks[0].id
        const files = new Map<string, File>()
        const picks = tool.id === 'merge' ? loaded : [first]
        for (const l of picks) {
          p = { ...p, assets: [...p.assets, l.asset] }
          p = appendAsset(p, vt, l.asset)
          files.set(l.asset.id, l.file)
        }
        if (tool.id === 'speed') p = updateClip(p, p.tracks[0].clips[0].id, { playbackRate: speed })
        await renderProject({ project: p, settings: { format, height, frameRate: 0, quality }, sink, getFile: async (a) => files.get(a.id) ?? null, ...common })
        results.push(await sink.finish())
      } else {
        const suffix = ({ trim: 'trimmed', mute: 'muted', extract: 'audio', compress: 'compressed', convert: 'converted', rotate: 'rotated', resize: `${height}p` } as Record<string, string>)[tool.id] ?? 'edited'
        const sink = await createSink(`${base}-${suffix}`, kind, true)
        await convertFile({
          file: first.file,
          sink,
          trim: tool.id === 'trim' ? { start: trim[0], end: trim[1] } : undefined,
          muteAudio: tool.id === 'mute',
          audioOnly: tool.id === 'extract',
          audioCodec: tool.id === 'extract' ? (audioFmt === 'wav' ? 'pcm-s16' : 'opus') : undefined,
          rotate: tool.id === 'rotate' ? rotate : undefined,
          flip: tool.id === 'rotate' ? flip : undefined,
          height: tool.id === 'compress' || tool.id === 'resize' ? height : 0,
          quality: tool.id === 'compress' || tool.id === 'resize' ? quality : 'original',
          compat: tool.id === 'convert',
          ...common,
        })
        results.push(await sink.finish())
      }

      for (const r of results) if (r.blob) downloadBlob(r.blob, r.filename)
      setStatus({ phase: 'done', results })
    } catch (e) {
      if (e instanceof SaveCancelled || e instanceof ExportCancelled) setStatus({ phase: 'idle' })
      else {
        console.error(e)
        setStatus({ phase: 'error', message: e instanceof Error ? e.message : 'Something went wrong.' })
      }
    }
  }

  const running = status.phase === 'running'
  const canRun = !!first && !running && (tool.id !== 'merge' || loaded.length >= 2) && (tool.id !== 'split' || cuts.length > 0) && (tool.id !== 'trim' || trim[1] - trim[0] > 0.1) && (tool.id !== 'extract' || first.asset.hasAudio)
  const showFormat = tool.id !== 'extract' && tool.id !== 'rotate'
  const showHeight = ['compress', 'resize', 'merge', 'speed'].includes(tool.id)
  const showQuality = ['compress', 'merge', 'speed'].includes(tool.id)

  return (
    <div className="flex h-full flex-col">
      <PageHeader back="/quick" title={tool.name} />
      <div className="page-scroll flex-1">
        <div className="mx-auto grid max-w-6xl gap-6 px-6 py-8 lg:grid-cols-[1fr_340px]">
          {/* left: file + preview */}
          <section>
            {!first ? (
              <DropZone multiple={!!tool.multiple} accept={accept} onFiles={(f) => void onFiles(f)} className="min-h-72">
                <div className="text-muted">
                  <p className="text-base text-fg">{loading ? 'Reading file…' : `Drop ${tool.multiple ? 'two or more videos' : needsAudio ? 'a video or audio file' : 'a video'} here`}</p>
                  <p className="mt-1 text-sm">or click to browse · {tool.note}</p>
                </div>
              </DropZone>
            ) : (
              <div className="space-y-3">
                <div className="overflow-hidden rounded-xl border border-line bg-black">
                  {first.asset.type === 'audio' ? (
                    <audio src={first.url} controls className="w-full" />
                  ) : (
                    <video ref={videoRef} key={first.url} src={first.url} controls playsInline className="max-h-[56vh] w-full" />
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                  <span className="text-fg">{first.file.name}</span>
                  <span>{formatBytes(first.file.size)}</span>
                  <span>{formatTime(dur, false)}</span>
                  {first.asset.width && (
                    <span>
                      {first.asset.width}×{first.asset.height}
                    </span>
                  )}
                  {first.asset.frameRate && <span>{first.asset.frameRate} fps</span>}
                  <span>{first.asset.videoCodec ?? first.asset.audioCodec}</span>
                  {!first.asset.hasAudio && <span className="text-warn">no audio</span>}
                  {!tool.multiple && (
                    <button className="ml-auto text-accent hover:underline" onClick={() => (setLoaded([]), setStatus({ phase: 'idle' }))}>
                      Choose another file
                    </button>
                  )}
                </div>

                {tool.id === 'trim' && (
                  <div className="space-y-3 rounded-xl border border-line bg-panel p-4">
                    <Range label="Start" value={trim[0]} max={dur} onChange={(v) => setTrim([Math.min(v, trim[1] - 0.1), trim[1]])} onSet={() => setTrim([Math.min(current(), trim[1] - 0.1), trim[1]])} />
                    <Range label="End" value={trim[1]} max={dur} onChange={(v) => setTrim([trim[0], Math.max(v, trim[0] + 0.1)])} onSet={() => setTrim([trim[0], Math.max(current(), trim[0] + 0.1)])} />
                    <p className="text-xs text-muted">Keeping {formatTime(trim[1] - trim[0])} of {formatTime(dur)}.</p>
                  </div>
                )}

                {tool.id === 'split' && (
                  <div className="space-y-3 rounded-xl border border-line bg-panel p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">Split points</p>
                      <Button size="sm" onClick={() => setCuts((c) => (current() > 0.1 && current() < dur - 0.1 && !c.some((x) => Math.abs(x - current()) < 0.1) ? [...c, current()].sort((a, b) => a - b) : c))}>
                        <Plus size={13} /> Add at current time
                      </Button>
                    </div>
                    {cuts.length === 0 ? (
                      <p className="text-xs text-muted">Play or scrub the video, then add split points. {cuts.length + 1} file(s) will be created.</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {cuts.map((c) => (
                          <li key={c} className="flex items-center justify-between rounded-md bg-bg px-3 py-1.5 text-sm">
                            <button className="font-mono hover:text-accent" onClick={() => videoRef.current && (videoRef.current.currentTime = c)}>
                              {formatTime(c)}
                            </button>
                            <button className="text-muted hover:text-bad" aria-label="Remove split point" onClick={() => setCuts(cuts.filter((x) => x !== c))}>
                              <X size={14} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {cuts.length > 0 && <p className="text-xs text-muted">{cuts.length + 1} files will be created.</p>}
                  </div>
                )}

                {tool.id === 'merge' && (
                  <div className="space-y-2 rounded-xl border border-line bg-panel p-4">
                    <p className="text-sm font-medium">Order ({loaded.length} clips)</p>
                    {loaded.map((l, i) => (
                      <div key={l.asset.id} className="flex items-center gap-2 rounded-md bg-bg px-3 py-1.5 text-sm">
                        <span className="w-5 text-muted">{i + 1}</span>
                        <span className="flex-1 truncate">{l.file.name}</span>
                        <span className="font-mono text-xs text-muted">{formatTime(l.asset.duration ?? 0, false)}</span>
                        <button disabled={i === 0} className="text-muted hover:text-fg disabled:opacity-30" aria-label="Move up" onClick={() => setLoaded(move(loaded, i, -1))}>
                          <ArrowUp size={14} />
                        </button>
                        <button disabled={i === loaded.length - 1} className="text-muted hover:text-fg disabled:opacity-30" aria-label="Move down" onClick={() => setLoaded(move(loaded, i, 1))}>
                          <ArrowDown size={14} />
                        </button>
                        <button className="text-muted hover:text-bad" aria-label="Remove" onClick={() => setLoaded(loaded.filter((x) => x !== l))}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                    <DropZone multiple accept="video/*" onFiles={(f) => void onFiles(f)} className="p-4">
                      <span className="text-sm text-muted">+ Add more videos</span>
                    </DropZone>
                    {loaded.length < 2 && <p className="text-xs text-warn">Add at least two videos.</p>}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* right: options + run */}
          <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
            <div className="space-y-4 rounded-xl border border-line bg-panel p-4">
              <p className="text-sm font-semibold">Output</p>

              {tool.id === 'extract' && (
                <Field label="Audio format" hint={audioFmt === 'wav' ? 'Lossless, large files.' : 'Opus in an Ogg file: small and good quality.'}>
                  <Select value={audioFmt} onChange={setAudioFmt} options={[{ value: 'wav', label: 'WAV' }, { value: 'ogg', label: 'Ogg (Opus)' }]} />
                </Field>
              )}

              {tool.id === 'rotate' && (
                <>
                  <Field label="Rotate (clockwise)">
                    <Select value={rotate} onChange={setRotate} options={[{ value: 90, label: '90°' }, { value: 180, label: '180°' }, { value: 270, label: '270°' }, { value: 0, label: 'None' }]} />
                  </Field>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={flip} onChange={(e) => setFlip(e.target.checked)} /> Mirror horizontally
                  </label>
                  <Field label="Container">
                    <Select value={format} onChange={setFormat} options={[{ value: 'mp4', label: 'MP4' }, { value: 'webm', label: 'WebM' }]} />
                  </Field>
                </>
              )}

              {tool.id === 'speed' && (
                <Field label={`Speed: ${speed}×`} hint="Audio pitch changes with speed.">
                  <input type="range" min={0.25} max={4} step={0.25} value={speed} onChange={(e) => setSpeed(+e.target.value)} className="w-full" />
                </Field>
              )}

              {showFormat && (
                <Field label="Format">
                  <Select value={format} onChange={setFormat} options={[{ value: 'mp4', label: 'MP4 (H.264/AAC)' }, { value: 'webm', label: 'WebM (VP9/Opus)' }]} />
                </Field>
              )}
              {showHeight && (
                <Field label="Resolution">
                  <Select value={height} onChange={setHeight} options={heightOptions} />
                </Field>
              )}
              {showQuality && (
                <Field label="Quality">
                  <Select value={quality} onChange={setQuality} options={[{ value: 'high', label: 'High quality' }, { value: 'balanced', label: 'Balanced' }, { value: 'small', label: 'Smaller file' }]} />
                </Field>
              )}

              <p className="text-xs text-muted">{tool.note}</p>
              {tool.id === 'extract' && first && !first.asset.hasAudio && <p className="text-xs text-warn">This file has no audio track.</p>}

              {running ? (
                <div className="space-y-3">
                  <Progress value={status.progress} label={status.label} />
                  <Button className="w-full" onClick={() => abortRef.current?.abort()}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button variant="primary" className="w-full" disabled={!canRun} onClick={() => void run()}>
                  <Download size={15} /> {supportsDiskStreaming() && tool.id !== 'split' ? 'Process & save…' : 'Process & download'}
                </Button>
              )}
            </div>

            {status.phase === 'error' && <div className="rounded-xl border border-bad/40 bg-bad/10 p-4 text-sm">{status.message}</div>}

            {status.phase === 'done' && (
              <div className="space-y-2 rounded-xl border border-ok/40 bg-ok/10 p-4 text-sm">
                <p className="flex items-center gap-2 font-medium">
                  <CheckCircle2 size={16} className="text-ok" /> Done
                </p>
                {status.results.map((r) => (
                  <div key={r.filename} className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs">
                      {r.filename} · {formatBytes(r.size)}
                      {first && ` (was ${formatBytes(first.file.size)})`}
                    </span>
                    {r.blob ? (
                      <Button size="sm" onClick={() => downloadBlob(r.blob!, r.filename)}>
                        Download again
                      </Button>
                    ) : (
                      <span className="text-xs text-muted">saved</span>
                    )}
                  </div>
                ))}
                <Button size="sm" variant="ghost" onClick={() => nav('/quick')}>
                  Pick another tool
                </Button>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}

function Range({ label, value, max, onChange, onSet }: { label: string; value: number; max: number; onChange: (v: number) => void; onSet: () => void }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="font-mono">{formatTime(value)}</span>
      </div>
      <div className="flex items-center gap-3">
        <input type="range" aria-label={label} min={0} max={max} step={0.01} value={value} onChange={(e) => onChange(+e.target.value)} className="flex-1" />
        <Button size="sm" onClick={onSet}>
          Use current
        </Button>
      </div>
    </div>
  )
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

function move<T>(arr: T[], i: number, d: number): T[] {
  const out = [...arr]
  ;[out[i], out[i + d]] = [out[i + d], out[i]]
  return out
}
