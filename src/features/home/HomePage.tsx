import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, Clapperboard, Download, FolderOpen, Trash2, Upload, Zap } from 'lucide-react'
import { Logo } from '@/app/Brand'
import { Button, DropZone, Field, Modal, Select, TextInput } from '@/components/ui'
import { detectCapabilities, type BrowserCapabilities } from '@/engine/capabilities/browserCapabilities'
import { deleteProject, listProjects, projectFromJson, projectToJson, requestPersistence, saveProject } from '@/services/storage'
import { ASPECTS, createProject, downloadText, isMediaFile, type AspectKey } from '@/services/projects'
import { setPendingFiles } from '@/services/handoff'
import { projectDuration } from '@/engine/timeline/ops'
import { formatTime } from '@/utils/time'
import { toast } from '@/store/toastStore'
import type { VideoProject } from '@/types/project'

export default function HomePage() {
  const nav = useNavigate()
  const [projects, setProjects] = useState<VideoProject[] | null>(null)
  const [caps, setCaps] = useState<BrowserCapabilities | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('My video')
  const [aspect, setAspect] = useState<AspectKey>('16:9')
  const importRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(() => void listProjects().then(setProjects).catch(() => setProjects([])), [])
  useEffect(() => {
    refresh()
    void detectCapabilities().then(setCaps)
    void requestPersistence()
  }, [refresh])

  const create = async (files?: File[]) => {
    const p = await createProject(files?.[0] ? files[0].name.replace(/\.[^.]+$/, '') : name, aspect)
    if (files?.length) setPendingFiles(files)
    nav(`/editor/${p.id}`)
  }

  const importBackup = async (file: File) => {
    try {
      const p = projectFromJson(await file.text())
      await saveProject({ ...p, name: `${p.name} (restored)` })
      toast.success('Project restored. Open it and re-link any media files it asks for.')
      refresh()
    } catch {
      toast.error('That file is not a valid Video Studio project backup.')
    }
  }

  return (
    <div className="page-scroll">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Logo />
        <span className="hidden text-xs text-muted sm:block">100% in your browser · files never leave your device</span>
      </header>

      <main className="mx-auto max-w-6xl px-6 pb-20 pt-8">
        {caps && caps.problems.length > 0 && (
          <div className="mb-6 flex gap-3 rounded-lg border border-warn/40 bg-warn/10 p-4 text-sm">
            <AlertTriangle className="mt-0.5 shrink-0 text-warn" size={18} />
            <div>
              {caps.problems.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>
          </div>
        )}

        <h1 className="max-w-2xl text-4xl font-semibold leading-tight tracking-tight md:text-5xl">Edit video without uploading it anywhere.</h1>
        <p className="mt-4 max-w-xl text-muted">Trim and convert in seconds, or build a multi-track edit with text, audio and fades. Everything runs locally in your browser.</p>

        <div className="mt-10 grid gap-4 md:grid-cols-2">
          <Link to="/quick" className="group rounded-xl border border-line bg-panel p-6 transition-colors hover:border-accent/60">
            <Zap className="text-accent" />
            <h2 className="mt-4 text-xl font-semibold">Quick Editor</h2>
            <p className="mt-1.5 text-sm text-muted">Trim, split, merge, mute, compress, convert, resize and more. One job, a few clicks, no timeline.</p>
            <span className="mt-5 inline-block text-sm text-accent group-hover:underline">Pick a tool →</span>
          </Link>
          <button onClick={() => setCreating(true)} className="group rounded-xl border border-line bg-panel p-6 text-left transition-colors hover:border-accent/60">
            <Clapperboard className="text-accent" />
            <h2 className="mt-4 text-xl font-semibold">Advanced Editor</h2>
            <p className="mt-1.5 text-sm text-muted">Multi-track timeline with video, audio, images and text. Split, trim, fades, colour, undo/redo, autosave.</p>
            <span className="mt-5 inline-block text-sm text-accent group-hover:underline">New project →</span>
          </button>
        </div>

        <DropZone multiple accept="video/*,audio/*,image/*" className="mt-4" onFiles={(f) => (f.some(isMediaFile) ? void create(f.filter(isMediaFile)) : toast.error('Please drop video, audio or image files.'))}>
          <div className="flex flex-col items-center gap-2 text-muted">
            <Upload size={22} />
            <span className="text-sm">
              <span className="text-fg">Drop videos here</span> to start a new Advanced project with them
            </span>
          </div>
        </DropZone>

        <section className="mt-14">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Recent projects</h2>
            <>
              <input ref={importRef} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && void importBackup(e.target.files[0])} />
              <Button size="sm" variant="ghost" onClick={() => importRef.current?.click()}>
                <FolderOpen size={14} /> Restore backup
              </Button>
            </>
          </div>
          {projects === null ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : projects.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line p-8 text-center text-sm text-muted">No projects yet. Projects are saved automatically in this browser.</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((p) => (
                <li key={p.id} className="overflow-hidden rounded-xl border border-line bg-panel">
                  <Link to={`/editor/${p.id}`} className="block">
                    <div className="grid aspect-video place-items-center bg-bg">
                      {p.assets.find((a) => a.thumbnail) ? <img src={p.assets.find((a) => a.thumbnail)!.thumbnail} alt="" className="h-full w-full object-cover" /> : <Clapperboard className="text-line" size={32} />}
                    </div>
                    <div className="p-3">
                      <p className="truncate font-medium">{p.name}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {formatTime(projectDuration(p), false)} · {p.width}×{p.height} · {new Date(p.updatedAt).toLocaleDateString()}
                      </p>
                    </div>
                  </Link>
                  <div className="flex gap-1 border-t border-line p-1.5">
                    <Button size="sm" variant="ghost" onClick={() => downloadText(projectToJson(p), `${p.name.replace(/[^\w-]+/g, '-')}.videostudio.json`)}>
                      <Download size={13} /> Backup
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto text-bad"
                      onClick={async () => {
                        if (!confirm(`Delete "${p.name}" and its stored media? This cannot be undone.`)) return
                        await deleteProject(p)
                        refresh()
                      }}
                    >
                      <Trash2 size={13} /> Delete
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted">Projects live in this browser's storage. Clearing site data deletes them, so use Backup for projects you care about (the backup stores the edit, not the media files).</p>
        </section>
      </main>

      <Modal open={creating} onClose={() => setCreating(false)} title="New project">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            void create()
          }}
        >
          <Field label="Project name">
            <TextInput autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Canvas" hint="Your first video clip will adjust the size automatically.">
            <Select value={aspect} onChange={setAspect} options={(Object.keys(ASPECTS) as AspectKey[]).map((k) => ({ value: k, label: `${ASPECTS[k].label} (${ASPECTS[k].width}×${ASPECTS[k].height})` }))} />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Create project
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
