let audioContext: AudioContext | null = null
let nextTime = 0

const ensureContext = (): AudioContext | null => {
  if (audioContext) return audioContext
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext
    if (!Ctor) return null
  const ctx = new Ctor()
  audioContext = ctx
  nextTime = ctx.currentTime
  } catch {
    return null
  }
  return audioContext
}

export const playEnsoniqSamples = (samples: Int16Array, sampleRate: number) => {
  const ctx = ensureContext()
  if (!ctx) return
  if (ctx.state === "suspended") ctx.resume()
  const frameCount = Math.floor(samples.length / 2)
  if (frameCount <= 0) return
  const block = samples as Int16Array
  const buffer = ctx.createBuffer(2, frameCount, sampleRate)
  const left = buffer.getChannelData(0)
  const right = buffer.getChannelData(1)
  for (let i = 0; i < frameCount; i++) {
    left[i] = block[i * 2] / 32768
    right[i] = block[i * 2 + 1] / 32768
  }
  const src = ctx.createBufferSource()
  src.buffer = buffer
  src.connect(ctx.destination)
  const t = ctx.currentTime
  if (!audioContext) return
  if (nextTime < t) nextTime = t
  src.start(nextTime)
  nextTime += frameCount / sampleRate
}
