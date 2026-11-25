import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { releaseAll } from '@/engine/media/mediaRegistry'
import { projectDuration } from '@/engine/timeline/ops'
import ExportDialog from '@/features/export/ExportDialog'
import MediaPanel from '@/features/media-library/MediaPanel'
import { loadProject, saveProject, StorageQuotaError } from '@/services/storage'
import { restoreMedia } from '@/services/projects'
import { takePendingFiles } from '@/services/handoff'
import { useEditor } from '@/store/editorStore'
import { toast } from '@/store/toastStore'
import EditorToolbar from './EditorToolbar'
import PreviewPanel from './PreviewPanel'
import PropertiesPanel from './PropertiesPanel'
import TimelinePanel from './TimelinePanel'
import { useImport } from './useImport'

const SAVE_DELAY = 700

export default function AdvancedEditorPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const [ready, setReady] = useState(false)
  const [exporting, setExporting] = useState(false)
  const { importFiles } = useImport()
  const project = useEditor((s) => s.project)

  // ---- load project + media ----
  useEffect(() => {
    let cancelled = false
    setReady(false)
    ;(async () => {
      const p = id ? await loadProject(id) : null
      if (cancelled) return
      if (!p) {
        toast.error('That project was not found in this browser.')
        nav('/', { replace: true })
        return
      }
      const missing = await restoreMedia(p)
      if (cancelled) return
      useEditor.getState().open(p, missing)
      setReady(true)
      if (missing.length) toast.error(`${missing.length} media file(s) are missing from browser storage. Use "re-link" in the media panel.`)
      const pending = takePendingFiles()
      if (pending.length) void importFiles(pending, true)
    })().catch((e) => {
      console.error(e)
      toast.error('Could not open the project.')
      nav('/', { replace: true })
    })
    return () => {
      cancelled = true
    }
  }, [id, nav, importFiles])

  // ---- autosave (debounced) ----
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const saveNow = useCallback(async () => {
    clearTimeout(timer.current)
    const { project: p, saveState, setSaveState } = useEditor.getState()
    if (!p || saveState === 'saved') return
    setSaveState('saving')
    try {
      await saveProject(p)
      // If the user kept editing while saving, stay "dirty".
      setSaveState(useEditor.getState().project === p ? 'saved' : 'dirty')
    } catch (e) {
      setSaveState('error')
      toast.error(e instanceof StorageQuotaError ? e.message : 'Could not save the project.')
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    const unsub = useEditor.subscribe((s, prev) => {
      if (s.project && s.project !== prev.project) {
        clearTimeout(timer.current)
        timer.current = setTimeout(() => void saveNow(), SAVE_DELAY)
      }
    })
    const beforeUnload = () => void saveNow()
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      unsub()
      window.removeEventListener('beforeunload', beforeUnload)
      void saveNow()
    }
  }, [ready, saveNow])

  // ---- clean up when leaving the editor ----
  useEffect(
    () => () => {
      useEditor.getState().setPlaying(false)
      useEditor.getState().close()
      releaseAll()
    },
    [],
  )

  // ---- keyboard shortcuts ----
  useEffect(() => {
    if (!ready) return
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('input:not([type=range]):not([type=checkbox]), textarea, select, [contenteditable=true]')) return
      const st = useEditor.getState()
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      const frame = 1 / (st.project?.frameRate ?? 30)
      if (mod && key === 'z') {
        e.preventDefault()
        if (e.shiftKey) st.redo()
        else st.undo()
      } else if (mod && key === 'y') {
        e.preventDefault()
        st.redo()
      } else if (mod && key === 'd') {
        e.preventDefault()
        st.duplicateSelected()
      } else if (mod && key === 's') {
        e.preventDefault()
        void saveNow()
        toast.success('Saved')
      } else if (mod) {
        return
      } else if (key === ' ') {
        e.preventDefault()
        st.setPlaying(!st.playing)
      } else if (key === 'k') {
        st.setPlaying(!st.playing)
      } else if (key === 'j') {
        st.skip(-5)
      } else if (key === 'l') {
        st.skip(5)
      } else if (key === '[') {
        st.jumpToCut(-1)
      } else if (key === ']') {
        st.jumpToCut(1)
      } else if (key === 'i') {
        st.setMarkIn()
      } else if (key === 'o') {
        st.setMarkOut()
      } else if (key === 'x') {
        st.cutMarked({ ripple: true })
      } else if (key === 's') {
        st.splitAtPlayhead()
      } else if (key === 'delete' || key === 'backspace') {
        e.preventDefault()
        st.deleteSelected(e.shiftKey ? true : undefined)
      } else if (key === 'arrowleft') {
        e.preventDefault()
        st.seek(st.playhead - (e.shiftKey ? 1 : frame))
      } else if (key === 'arrowright') {
        e.preventDefault()
        st.seek(Math.min(projectDuration(st.project!), st.playhead + (e.shiftKey ? 1 : frame)))
      } else if (key === 'home') st.seek(0)
      else if (key === 'end') st.seek(projectDuration(st.project!))
      else if (key === '=' || key === '+') st.setZoom(st.zoom * 1.25)
      else if (key === '-') st.setZoom(st.zoom / 1.25)
      else if (key === 'escape') st.select(null)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [ready, saveNow])

  if (!ready || !project) return <div className="grid h-full place-items-center text-sm text-muted">Opening project…</div>

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)] grid-rows-[48px_minmax(0,1fr)_minmax(220px,36%)]">
      <EditorToolbar onExport={() => setExporting(true)} onSaveNow={() => void saveNow()} />
      <div className="grid min-h-0 grid-cols-[250px_minmax(0,1fr)_290px]">
        <MediaPanel />
        <PreviewPanel />
        <PropertiesPanel />
      </div>
      <TimelinePanel />
      <ExportDialog open={exporting} onClose={() => setExporting(false)} project={project} />
    </div>
  )
}
