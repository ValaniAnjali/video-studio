import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from 'mediabunny'

/**
 * Cheap waveform: decode a small slice of audio at N evenly spaced timestamps and keep the
 * peak of each. Works on multi-hour files without decoding everything.
 */
export async function computePeaks(file: File, points = 400): Promise<number[] | undefined> {
  try {
    using input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
    const track = await input.getPrimaryAudioTrack()
    if (!track || !(await track.canDecode())) return undefined
    const duration = await input.computeDuration()
    if (!(duration > 0)) return undefined
    const sink = new AudioBufferSink(track)
    const stamps = Array.from({ length: points }, (_, i) => (i + 0.5) * (duration / points))
    const peaks: number[] = []
    for await (const wrapped of sink.buffersAtTimestamps(stamps)) {
      let peak = 0
      if (wrapped) {
        const data = wrapped.buffer.getChannelData(0)
        const n = Math.min(data.length, 4800) // look at ~0.1s around the sample point
        for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(data[i]))
      }
      peaks.push(peak)
    }
    const max = Math.max(...peaks, 1e-6)
    return peaks.map((p) => Math.round(Math.min(1, p / max) * 100) / 100)
  } catch {
    return undefined
  }
}
