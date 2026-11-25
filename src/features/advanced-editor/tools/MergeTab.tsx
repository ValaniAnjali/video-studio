import { useRef } from 'react'
import { Film, Plus } from 'lucide-react'
import { Button } from '@/components/ui'
import { mainTrack, projectDuration } from '@/engine/timeline/ops'
import { useImport } from '@/features/advanced-editor/useImport'
import { useEditor } from '@/store/editorStore'
import { formatTime } from '@/utils/time'
import { ToolSection } from './shared'

export default function MergeTab() {
  const project = useEditor((s) => s.project)!
  const playhead = useEditor((s) => s.playhead)
  const missing = useEditor((s) => s.missingAssetIds)
  const { importFiles, importing } = useImport()
  const input = useRef<HTMLInputElement>(null)
  const videos = project.assets.filter((a) => a.type === 'video' && !missing.includes(a.id))
  const end = projectDuration(project)
  const hasMain = !!mainTrack(project)?.clips.length

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <ToolSection title="Add another video" hint="Pick a file and it is joined after the end of your video. You can then split or cut it like any other part.">
        <input ref={input} type="file" accept="video/*" multiple hidden onChange={(e) => (e.target.files?.length && void importFiles([...e.target.files], 'append'), (e.target.value = ''))} />
        <Button variant="primary" className="w-full" onClick={() => input.current?.click()} disabled={importing}>
          <Plus size={15} /> {importing ? 'Importing…' : 'Choose video to join at the end'}
        </Button>
      </ToolSection>

      <ToolSection title="Your videos" hint={hasMain ? `Join ends at ${formatTime(end, false)}. “Insert here” places a video at the playhead (${formatTime(playhead, false)}) and moves the rest later.` : 'Add a video to the timeline first.'}>
        {videos.length === 0 ? (
          <p className="text-xs text-muted">No videos imported yet.</p>
        ) : (
          <ul className="space-y-2">
            {videos.map((a) => (
              <li key={a.id} className="flex gap-2.5 rounded-lg border border-line bg-panel2 p-2">
                <div className="grid h-11 w-14 shrink-0 place-items-center overflow-hidden rounded bg-bg">{a.thumbnail ? <img src={a.thumbnail} alt="" className="h-full w-full object-cover" /> : <Film size={16} className="text-muted" />}</div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm" title={a.name}>
                    {a.name}
                  </p>
                  <p className="text-xs text-muted">{formatTime(a.duration ?? 0, false)}</p>
                  <div className="mt-1.5 flex gap-1">
                    <Button size="sm" variant="primary" onClick={() => useEditor.getState().mergeAsset(a, 'append')} aria-label={`Join ${a.name} at the end`}>
                      Join at end
                    </Button>
                    <Button size="sm" disabled={!hasMain} onClick={() => useEditor.getState().mergeAsset(a, 'insert')} aria-label={`Insert ${a.name} at playhead`}>
                      Insert here
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </ToolSection>

      <p className="px-3.5 py-3.5 text-xs leading-relaxed text-muted">
        <span className="font-medium text-fg">Cut, then merge:</span> split the video, cut the part you don't want (Cut &amp; Split tab) and the parts around it join on their own. Join another video before or after, all in one project and one export.
      </p>
    </div>
  )
}
