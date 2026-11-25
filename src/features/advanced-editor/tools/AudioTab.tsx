import { useRef } from 'react'
import { Music, Volume2, VolumeX } from 'lucide-react'
import { Button } from '@/components/ui'
import { updateClip } from '@/engine/timeline/ops'
import { useImport } from '@/features/advanced-editor/useImport'
import { useEditor } from '@/store/editorStore'
import { ToolSection } from './shared'

export default function AudioTab() {
  const project = useEditor((s) => s.project)!
  const { importFiles, importing } = useImport()
  const input = useRef<HTMLInputElement>(null)

  const videoClips = project.tracks.filter((t) => t.type === 'video' || t.type === 'overlay').flatMap((t) => t.clips)
  const withAudio = videoClips.filter((c) => project.assets.find((a) => a.id === c.mediaId)?.hasAudio)
  const allMuted = withAudio.length > 0 && withAudio.every((c) => c.muted)

  const setAllMuted = (muted: boolean) =>
    useEditor.getState().commit((p) => withAudio.reduce((acc, c) => updateClip(acc, c.id, { muted }), p))

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <ToolSection title="Original sound" hint={withAudio.length ? `${withAudio.length} clip(s) have sound. Per-clip volume and fades are in the right panel.` : 'No clips with sound yet.'}>
        <Button className="w-full" disabled={!withAudio.length} onClick={() => setAllMuted(!allMuted)} aria-pressed={allMuted}>
          {allMuted ? <Volume2 size={14} /> : <VolumeX size={14} />} {allMuted ? 'Turn original sound back on' : 'Remove sound from all video clips'}
        </Button>
      </ToolSection>
      <ToolSection title="Add music or voice-over" hint="The file is placed on an audio track at the playhead. Trim and move it like any clip.">
        <input ref={input} type="file" accept="audio/*" hidden onChange={(e) => (e.target.files?.length && void importFiles([...e.target.files], true), (e.target.value = ''))} />
        <Button className="w-full" onClick={() => input.current?.click()} disabled={importing}>
          <Music size={14} /> {importing ? 'Importing…' : 'Choose audio file'}
        </Button>
      </ToolSection>
    </div>
  )
}
