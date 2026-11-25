/**
 * Single entry point for exporting a project: validates, plans (Smart Export), then runs
 * either the fast conversion path or the full render path.
 */
import type { ExportSettings, MediaAsset, VideoProject } from '@/types/project'
import { clipDuration, validateProject } from '@/engine/timeline/ops'
import { convertFile } from './convertExport'
import { planExport, type ExportPlan } from './ExportPlanner'
import { renderProject } from './renderExport'
import type { ExportResult, ExportSink } from './sink'
import { detectCapabilities } from '@/engine/capabilities/browserCapabilities'

export interface RunExportArgs {
  project: VideoProject
  settings: ExportSettings
  sink: ExportSink
  getFile: (asset: MediaAsset) => Promise<File | null>
  signal?: AbortSignal
  onProgress?: (fraction: number, phase: string) => void
}

/** Returns blocking problems (empty = OK to export). */
export async function validateExport(project: VideoProject): Promise<string[]> {
  const problems = validateProject(project).filter((i) => i.level === 'error').map((i) => i.message)
  const caps = await detectCapabilities()
  problems.push(...caps.problems)
  return [...new Set(problems)]
}

export async function runExport(args: RunExportArgs): Promise<{ plan: ExportPlan; result: ExportResult }> {
  const { project, settings, sink, getFile, signal, onProgress } = args
  const plan = planExport(project, settings)

  if (plan.mode === 'convert' && plan.single) {
    const { clip, asset, muted } = plan.single
    const file = await getFile(asset)
    if (!file) throw new Error(`"${asset.name}" is missing. Re-link it in the media panel, then export again.`)
    const whole = clip.sourceStart < 0.01 && Math.abs(clip.sourceEnd - (asset.duration ?? clip.sourceEnd)) < 0.05
    await convertFile({
      file,
      sink,
      trim: whole ? undefined : { start: clip.sourceStart, end: clip.sourceStart + clipDuration(clip) },
      muteAudio: muted || !asset.hasAudio,
      height: settings.height,
      frameRate: settings.frameRate,
      quality: settings.quality,
      signal,
      onProgress,
    })
  } else {
    await renderProject({ project, settings, sink, getFile, signal, onProgress })
  }
  return { plan, result: await sink.finish() }
}
