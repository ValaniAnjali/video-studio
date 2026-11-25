import type { ReactNode } from 'react'
import { Copy, Scissors, Trash2 } from 'lucide-react'
import { Button, Field, Kbd, TextInput } from '@/components/ui'
import { clipDuration, findClip, getAsset, setTextDuration, updateClip, updateText, updateTrack } from '@/engine/timeline/ops'
import { useEditor } from '@/store/editorStore'
import { formatTime } from '@/utils/time'
import type { TimelineClip } from '@/types/project'

/** Slider that records ONE undo step per drag (gesture), or one per key press. */
function Slider({ label, value, min, max, step, show, onChange }: { label: string; value: number; min: number; max: number; step: number; show?: (v: number) => string; onChange: (v: number) => void }) {
  const st = useEditor.getState
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="font-mono">{show ? show(value) : value}</span>
      </div>
      <input
        type="range"
        aria-label={label}
        className="w-full"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={() => st().beginGesture()}
        onPointerUp={() => st().endGesture()}
        onPointerCancel={() => st().endGesture()}
        onChange={(e) => onChange(+e.target.value)}
      />
    </div>
  )
}

const pct = (v: number) => `${Math.round(v * 100)}%`

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-b border-line px-4 py-4">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</h3>
      {children}
    </section>
  )
}

export default function PropertiesPanel() {
  const project = useEditor((s) => s.project)!
  const selectedClipId = useEditor((s) => s.selectedClipId)
  const selectedTrackId = useEditor((s) => s.selectedTrackId)
  const found = selectedClipId ? findClip(project, selectedClipId) : null
  const track = selectedTrackId ? project.tracks.find((t) => t.id === selectedTrackId) : null
  const st = useEditor.getState

  return (
    <aside className="min-h-0 overflow-y-auto border-l border-line bg-panel" aria-label="Properties">
      {found ? (
        <ClipProps clip={found.clip} />
      ) : track ? (
        <>
          <Section title="Track">
            <Field label="Name">
              <TextInput
                value={track.name}
                onFocus={() => st().beginGesture()}
                onBlur={() => st().endGesture()}
                onChange={(e) => st().edit((p) => updateTrack(p, track.id, { name: e.target.value }))}
              />
            </Field>
            {track.type !== 'text' && <Slider label="Track volume" value={track.volume} min={0} max={2} step={0.01} show={pct} onChange={(v) => st().edit((p) => updateTrack(p, track.id, { volume: v }))} />}
            <Button variant="danger" size="sm" onClick={() => confirm(`Remove "${track.name}" and its ${track.clips.length} clip(s)?`) && st().removeTrackById(track.id)}>
              <Trash2 size={13} /> Remove track
            </Button>
          </Section>
        </>
      ) : (
        <>
          <Section title="Project">
            <Field label="Name">
              <TextInput value={project.name} onChange={(e) => st().silent((p) => ({ ...p, name: e.target.value }))} />
            </Field>
            <p className="text-xs text-muted">
              {project.width}×{project.height} · {project.frameRate} fps. The size follows your first video clip.
            </p>
          </Section>
          <Section title="Shortcuts">
            <ul className="space-y-1.5 text-xs text-muted">
              {[
                ['Space / K', 'Play / pause'],
                ['J / L', 'Back / forward 5 s'],
                ['[ / ]', 'Previous / next cut'],
                ['I / O', 'Mark In / Out'],
                ['X', 'Cut marked section'],
                ['S', 'Split at playhead'],
                ['Delete', 'Delete clip'],
                ['Shift+Delete', 'Ripple delete'],
                ['Ctrl/⌘ Z', 'Undo'],
                ['Ctrl/⌘ Shift Z', 'Redo'],
                ['Ctrl/⌘ D', 'Duplicate'],
                ['← →', 'Step 1 frame (Shift: 1 s)'],
                ['Ctrl/⌘ S', 'Save now'],
              ].map(([k, v]) => (
                <li key={k} className="flex justify-between gap-2">
                  <span>{v}</span>
                  <Kbd>{k}</Kbd>
                </li>
              ))}
            </ul>
          </Section>
        </>
      )}
    </aside>
  )
}

function ClipProps({ clip }: { clip: TimelineClip }) {
  const project = useEditor((s) => s.project)!
  const st = useEditor.getState
  const asset = getAsset(project, clip.mediaId)
  const isText = !!clip.text
  const visual = isText || asset?.type === 'video' || asset?.type === 'image'
  const hasAudio = !isText && (asset?.type === 'audio' || (asset?.type === 'video' && asset.hasAudio))
  const dur = clipDuration(clip)
  const set = (patch: Partial<TimelineClip>) => st().edit((p) => updateClip(p, clip.id, patch))
  const setText = (patch: Parameters<typeof updateText>[2]) => st().edit((p) => updateText(p, clip.id, patch))
  const maxFade = Math.max(0.1, dur / 2)

  return (
    <>
      <Section title={isText ? 'Text' : (asset?.name ?? 'Clip')}>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" onClick={() => st().splitAtPlayhead()}>
            <Scissors size={13} /> Split
          </Button>
          <Button size="sm" onClick={() => st().duplicateSelected()}>
            <Copy size={13} /> Duplicate
          </Button>
          <Button size="sm" variant="danger" onClick={() => st().deleteSelected(false)}>
            <Trash2 size={13} /> Delete
          </Button>
          <Button size="sm" variant="danger" onClick={() => st().deleteSelected(true)} title="Delete and close the gap">
            Ripple
          </Button>
        </div>
        <p className="font-mono text-xs text-muted">
          {formatTime(clip.timelineStart)} → {formatTime(clip.timelineStart + dur)} · {formatTime(dur)}
        </p>
      </Section>

      {isText && clip.text && (
        <Section title="Content">
          <Field label="Text">
            <textarea
              rows={3}
              value={clip.text.content}
              onFocus={() => st().beginGesture()}
              onBlur={() => st().endGesture()}
              onChange={(e) => setText({ content: e.target.value })}
              className="w-full resize-none rounded-md border border-line bg-bg p-2.5 text-sm focus:border-accent focus:outline-none"
            />
          </Field>
          <Slider label="Duration" value={Number(dur.toFixed(2))} min={0.5} max={30} step={0.1} show={(v) => `${v.toFixed(1)} s`} onChange={(v) => st().edit((p) => setTextDuration(p, clip.id, v))} />
          <Slider label="Size" value={clip.text.fontSize} min={2} max={30} step={0.5} onChange={(v) => setText({ fontSize: v })} />
          <Slider label="Position X" value={clip.text.x} min={0} max={1} step={0.01} show={pct} onChange={(v) => setText({ x: v })} />
          <Slider label="Position Y" value={clip.text.y} min={0} max={1} step={0.01} show={pct} onChange={(v) => setText({ y: v })} />
          <div className="flex items-center gap-4 text-sm">
            <label className="flex items-center gap-2">
              Colour
              <input type="color" value={toHex(clip.text.color)} onChange={(e) => setText({ color: e.target.value })} className="h-7 w-9 rounded border border-line bg-bg" />
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={clip.text.bold} onChange={(e) => setText({ bold: e.target.checked })} /> Bold
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={!!clip.text.background} onChange={(e) => setText({ background: e.target.checked ? 'rgba(0,0,0,0.55)' : undefined })} /> Box
            </label>
          </div>
        </Section>
      )}

      {!isText && asset?.type !== 'image' && (
        <Section title="Speed">
          <Slider label="Playback speed" value={clip.playbackRate} min={0.25} max={4} step={0.05} show={(v) => `${v.toFixed(2)}×`} onChange={(v) => set({ playbackRate: v })} />
          <p className="text-xs text-muted">Speed changes are refused if the longer clip would overlap its neighbour.</p>
        </Section>
      )}

      {hasAudio && (
        <Section title="Audio">
          <Slider label="Volume" value={clip.volume} min={0} max={2} step={0.01} show={pct} onChange={(v) => set({ volume: v })} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={clip.muted} onChange={(e) => set({ muted: e.target.checked })} /> Mute this clip
          </label>
          {clip.volume > 1 && <p className="text-xs text-muted">Boost above 100% is applied in the export, not the live preview.</p>}
        </Section>
      )}

      {visual && (
        <Section title="Appearance">
          <Slider label="Opacity" value={clip.opacity} min={0} max={1} step={0.01} show={pct} onChange={(v) => set({ opacity: v })} />
          {!isText && (
            <>
              <Slider label="Brightness" value={clip.brightness ?? 1} min={0} max={2} step={0.01} show={pct} onChange={(v) => set({ brightness: v })} />
              <Slider label="Contrast" value={clip.contrast ?? 1} min={0} max={2} step={0.01} show={pct} onChange={(v) => set({ contrast: v })} />
              <Slider label="Saturation" value={clip.saturation ?? 1} min={0} max={2} step={0.01} show={pct} onChange={(v) => set({ saturation: v })} />
              <Button size="sm" variant="ghost" onClick={() => set({ brightness: undefined, contrast: undefined, saturation: undefined })}>
                Reset colour
              </Button>
            </>
          )}
        </Section>
      )}

      <Section title="Fades">
        <Slider label="Fade in" value={Math.min(clip.fadeIn ?? 0, maxFade)} min={0} max={maxFade} step={0.05} show={(v) => `${v.toFixed(2)} s`} onChange={(v) => set({ fadeIn: v })} />
        <Slider label="Fade out" value={Math.min(clip.fadeOut ?? 0, maxFade)} min={0} max={maxFade} step={0.05} show={(v) => `${v.toFixed(2)} s`} onChange={(v) => set({ fadeOut: v })} />
        <p className="text-xs text-muted">Fades apply to the picture and the sound.</p>
      </Section>
    </>
  )
}

/** <input type="color"> only accepts #rrggbb. */
function toHex(c: string) {
  return /^#[0-9a-f]{6}$/i.test(c) ? c : '#ffffff'
}
