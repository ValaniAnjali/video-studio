import { Combine, FileAudio, Film, Gauge, Minimize2, Maximize2, RotateCw, Scissors, SplitSquareHorizontal, VolumeX, Image as ImageIcon, type LucideIcon } from 'lucide-react'

export type ToolId = 'trim' | 'split' | 'merge' | 'mute' | 'extract' | 'compress' | 'convert' | 'rotate' | 'resize' | 'speed' | 'gif'

export interface ToolInfo {
  id: ToolId
  name: string
  blurb: string
  icon: LucideIcon
  /** How the file is processed: "fast" tools copy data when they can. */
  note: string
  multiple?: boolean
  comingSoon?: boolean
}

export const TOOLS: ToolInfo[] = [
  { id: 'trim', name: 'Video Trimmer', blurb: 'Keep only the part you need.', icon: Scissors, note: 'Fast: copies video data when possible.' },
  { id: 'split', name: 'Video Splitter', blurb: 'Cut one video into several files.', icon: SplitSquareHorizontal, note: 'One file per segment.' },
  { id: 'merge', name: 'Video Merger', blurb: 'Join clips one after another.', icon: Combine, note: 'Re-encodes (clips are combined).', multiple: true },
  { id: 'mute', name: 'Audio Remover', blurb: 'Remove the sound track.', icon: VolumeX, note: 'Fast: no re-encoding.' },
  { id: 'extract', name: 'Audio Extractor', blurb: 'Save the audio as a file.', icon: FileAudio, note: 'WAV or Opus.' },
  { id: 'compress', name: 'Video Compressor', blurb: 'Reduce file size.', icon: Minimize2, note: 'Re-encodes at lower quality.' },
  { id: 'convert', name: 'Video Converter', blurb: 'Switch between MP4 and WebM.', icon: Film, note: 'MP4 output uses H.264/AAC (re-encodes if the source differs).' },
  { id: 'rotate', name: 'Rotate & Flip', blurb: 'Turn or mirror the picture.', icon: RotateCw, note: 'Usually instant (metadata only).' },
  { id: 'resize', name: 'Video Resizer', blurb: 'Change the resolution.', icon: Maximize2, note: 'Re-encodes at the new size.' },
  { id: 'speed', name: 'Speed Changer', blurb: 'Slow motion or fast forward.', icon: Gauge, note: 'Re-encodes. Audio pitch follows speed.' },
  { id: 'gif', name: 'GIF Maker', blurb: 'Turn a clip into a GIF.', icon: ImageIcon, note: 'Needs a GIF encoder (planned).', comingSoon: true },
]

export const toolById = (id: string | undefined) => TOOLS.find((t) => t.id === id)
