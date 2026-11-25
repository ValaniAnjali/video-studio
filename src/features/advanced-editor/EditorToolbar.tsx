import { Link } from 'react-router-dom'
import { ArrowLeft, Check, Download, FileDown, Loader2, Redo2, Undo2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui'
import { projectToJson } from '@/services/storage'
import { downloadText } from '@/services/projects'
import { useEditor } from '@/store/editorStore'

export default function EditorToolbar({ onExport, onSaveNow }: { onExport: () => void; onSaveNow: () => void }) {
  const name = useEditor((s) => s.project!.name)
  const canUndo = useEditor((s) => s.past.length > 0)
  const canRedo = useEditor((s) => s.future.length > 0)
  const saveState = useEditor((s) => s.saveState)
  const st = useEditor.getState

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-panel px-3">
      <Link to="/" className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted hover:bg-raise hover:text-fg" onClick={onSaveNow}>
        <ArrowLeft size={15} /> Home
      </Link>
      <input
        aria-label="Project name"
        value={name}
        onChange={(e) => st().silent((p) => ({ ...p, name: e.target.value }))}
        className="h-8 w-56 rounded-md border border-transparent bg-transparent px-2 text-sm font-medium hover:border-line focus:border-accent focus:bg-bg focus:outline-none"
      />
      <span className="flex items-center gap-1.5 text-xs text-muted" aria-live="polite">
        {saveState === 'saving' && (
          <>
            <Loader2 size={12} className="animate-spin" /> Saving
          </>
        )}
        {saveState === 'saved' && (
          <>
            <Check size={12} className="text-ok" /> Saved
          </>
        )}
        {saveState === 'dirty' && 'Unsaved changes'}
        {saveState === 'error' && (
          <span className="flex items-center gap-1 text-bad">
            <AlertCircle size={12} /> Save failed
          </span>
        )}
      </span>

      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="icon" aria-label="Undo" title="Undo (Ctrl/⌘ Z)" disabled={!canUndo} onClick={() => st().undo()}>
          <Undo2 size={16} />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Redo" title="Redo (Ctrl/⌘ Shift Z)" disabled={!canRedo} onClick={() => st().redo()}>
          <Redo2 size={16} />
        </Button>
        <Button variant="ghost" size="sm" title="Download the project file (edit only, not the media)" onClick={() => downloadText(projectToJson(st().project!), `${st().project!.name.replace(/[^\w-]+/g, '-')}.videostudio.json`)}>
          <FileDown size={14} /> Backup
        </Button>
        <Button variant="primary" onClick={onExport}>
          <Download size={15} /> Export
        </Button>
      </div>
    </header>
  )
}
