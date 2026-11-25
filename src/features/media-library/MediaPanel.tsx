import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Film, Image as ImageIcon, Layers, Music, Plus, Scissors, Trash2, Type, Upload, Volume2, type LucideIcon } from 'lucide-react'
import { Button, DropZone } from '@/components/ui'
import { registerFile } from '@/engine/media/mediaRegistry'
import AudioTab from '@/features/advanced-editor/tools/AudioTab'
import CutTab from '@/features/advanced-editor/tools/CutTab'
import MergeTab from '@/features/advanced-editor/tools/MergeTab'
import { useImport } from '@/features/advanced-editor/useImport'
import { deleteMedia, saveMedia } from '@/services/storage'
import { useEditor } from '@/store/editorStore'
import { toast } from '@/store/toastStore'
import { cn } from '@/utils/cn'
import { formatBytes, formatTime } from '@/utils/time'
import type { MediaAsset, TextStyle } from '@/types/project'

export const ASSET_DRAG_TYPE = 'application/x-videostudio-asset'

type Tab = 'media' | 'cut' | 'merge' | 'audio' | 'text'
const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: 'media', label: 'Media', icon: Film },
  { id: 'cut', label: 'Cut & Split', icon: Scissors },
  { id: 'merge', label: 'Merge', icon: Layers },
  { id: 'audio', label: 'Audio', icon: Volume2 },
  { id: 'text', label: 'Text', icon: Type },
]

const TEXT_PRESETS: { label: string; hint: string; content: string; style: Partial<TextStyle> }[] = [
  { label: 'Title', hint: 'Large, centred', content: 'Your title', style: { fontSize: 14, y: 0.5, background: undefined } },
  { label: 'Caption', hint: 'Bottom, with background', content: 'Your caption', style: { fontSize: 6, y: 0.88, background: 'rgba(0,0,0,0.55)' } },
  { label: 'Lower third', hint: 'Name & role', content: 'Name\nRole', style: { fontSize: 5, x: 0.2, y: 0.82, background: 'rgba(255,106,61,0.85)' } },
]

/** Left side of the editor: one panel whose tools adapt to the video you imported. */
export default function MediaPanel() {
  const project = useEditor((s) => s.project)!
  const hasClips = project.tracks.some((t) => t.clips.length > 0)
  const [tab, setTab] = useState<Tab>(hasClips ? 'cut' : 'media')

  // The moment the first clip lands on the timeline, show the cut/split tools.
  const hadClips = useRef(hasClips)
  useEffect(() => {
    if (hasClips && !hadClips.current) setTab('cut')
    hadClips.current = hasClips
  }, [hasClips])

  return (
    <aside className="flex min-h-0 min-w-0 flex-col border-r border-line bg-panel" aria-label="Media library and tools">
      <div className="grid shrink-0 grid-cols-5 border-b border-line" role="tablist">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            aria-label={label}
            title={label}
            onClick={() => setTab(id)}
            className={cn('flex flex-col items-center gap-1 py-2 text-[10px] leading-none', tab === id ? 'border-b-2 border-accent text-fg' : 'border-b-2 border-transparent text-muted hover:text-fg')}
          >
            <Icon size={16} />
            <span className="max-w-full truncate px-0.5">{label === 'Cut & Split' ? 'Cut' : label}</span>
          </button>
        ))}
      </div>

      {tab === 'media' && <MediaTab />}
      {tab === 'cut' && <CutTab />}
      {tab === 'merge' && <MergeTab />}
      {tab === 'audio' && <AudioTab />}
      {tab === 'text' && <TextTab />}
    </aside>
  )
}

function TextTab() {
  return (
    <div className="space-y-2 p-3">
      <p className="px-1 pb-1 text-xs text-muted">Adds text at the playhead. Edit the words and style in the right panel.</p>
      {TEXT_PRESETS.map((p) => (
        <button key={p.label} onClick={() => useEditor.getState().addTextAtPlayhead(p.content, p.style)} className="flex w-full items-center gap-3 rounded-lg border border-line bg-panel2 p-3 text-left hover:border-accent/60">
          <Type size={18} className="text-t-text" />
          <span>
            <span className="block text-sm font-medium">{p.label}</span>
            <span className="block text-xs text-muted">{p.hint}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

function MediaTab() {
  const project = useEditor((s) => s.project)!
  const missing = useEditor((s) => s.missingAssetIds)
  const { importFiles, importing } = useImport()
  const relinkId = useRef<string | null>(null)
  const relinkInput = useRef<HTMLInputElement>(null)

  const used = (id: string) => project.tracks.some((t) => t.clips.some((c) => c.mediaId === id))

  const remove = async (a: MediaAsset) => {
    if (used(a.id)) return toast.error('Remove this media from the timeline first.')
    useEditor.getState().silent((p) => ({ ...p, assets: p.assets.filter((x) => x.id !== a.id) }))
    await deleteMedia(a.storageId)
  }

  const relink = async (file: File) => {
    const id = relinkId.current
    const asset = project.assets.find((a) => a.id === id)
    if (!asset) return
    registerFile(asset.id, file)
    await saveMedia(asset.storageId, file)
    useEditor.getState().setMissing(useEditor.getState().missingAssetIds.filter((x) => x !== asset.id))
    useEditor.getState().seek(useEditor.getState().playhead)
    toast.success(`Re-linked ${asset.name}`)
  }

  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
      <DropZone multiple accept="video/*,audio/*,image/*" onFiles={(f) => void importFiles(f, false)} className="p-4">
        <div className="flex items-center gap-2 text-sm text-muted">
          <Upload size={16} /> {importing ? 'Importing…' : 'Import media'}
        </div>
      </DropZone>
      <input ref={relinkInput} type="file" hidden onChange={(e) => e.target.files?.[0] && void relink(e.target.files[0])} />

      {project.assets.length === 0 && <p className="px-1 text-xs text-muted">Import a video, then press Add (or drag it onto the timeline). The cut, split and merge tools appear as soon as it is on the timeline.</p>}

      <ul className="space-y-2">
        {project.assets.map((a) => {
          const isMissing = missing.includes(a.id)
          const Icon = a.type === 'audio' ? Music : a.type === 'image' ? ImageIcon : Film
          return (
            <li
              key={a.id}
              draggable={!isMissing}
              onDragStart={(e) => {
                e.dataTransfer.setData(ASSET_DRAG_TYPE, a.id)
                e.dataTransfer.effectAllowed = 'copy'
              }}
              onDoubleClick={() => !isMissing && useEditor.getState().addAssetToTimeline(a)}
              title="Double-click to add to the timeline"
              className="group flex gap-2.5 rounded-lg border border-line bg-panel2 p-2 hover:border-muted"
            >
              <div className="grid h-12 w-16 shrink-0 place-items-center overflow-hidden rounded bg-bg">{a.thumbnail ? <img src={a.thumbnail} alt="" className="h-full w-full object-cover" draggable={false} /> : <Icon size={18} className="text-muted" />}</div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm" title={a.name}>
                  {a.name}
                </p>
                <p className="text-xs text-muted">
                  {a.type !== 'image' && `${formatTime(a.duration ?? 0, false)} · `}
                  {formatBytes(a.size)}
                </p>
                {isMissing ? (
                  <button
                    className="mt-0.5 flex items-center gap-1 text-xs text-warn hover:underline"
                    onClick={() => {
                      relinkId.current = a.id
                      relinkInput.current?.click()
                    }}
                  >
                    <AlertTriangle size={11} /> File missing, re-link
                  </button>
                ) : (
                  <div className="mt-1 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    <Button size="sm" variant="primary" onClick={() => useEditor.getState().addAssetToTimeline(a)} aria-label={`Add ${a.name} to timeline`}>
                      <Plus size={12} /> Add
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void remove(a)} aria-label={`Remove ${a.name}`}>
                      <Trash2 size={12} />
                    </Button>
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
