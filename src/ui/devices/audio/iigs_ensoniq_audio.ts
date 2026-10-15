// Apple IIgs Ensoniq ES5503 audio output.
//
// The DOC produces its own sample stream (rate = clock / 8 / (oscillators + 2),
// i.e. roughly 27-37 kHz depending on how many oscillators are enabled). The
// worker renders one block per emulated video frame and posts it here; we queue
// the blocks on the AudioContext clock so playback stays smooth and gap-free
// even when the worker stutters.

import { isAudioEnabled, registerAudioContext } from "./speaker"

let audioContext: AudioContext | null = null
let outputNode: GainNode | null = null
let nextTime = 0
let unregister: (() => void) | undefined

const ensureContext = (): AudioContext | null => {
  if (audioContext) return audioContext
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext
    if (!Ctor) return null
    const ctx = new Ctor()
    const gain = ctx.createGain()
    gain.gain.value = 0.6
    gain.connect(ctx.destination)
    audioContext = ctx
    outputNode = gain
    nextTime = ctx.currentTime
    unregister = registerAudioContext((enable) => {
      if (enable) {
        void ctx.resume()
      } else {
        void ctx.suspend()
      }
    })
    return ctx
  } catch (error) {
    console.error("Unable to create the Apple IIgs Ensoniq audio context.", error)
    return null
  }
}

export const playEnsoniqSamples = (samples: Int16Array, sampleRate: number) => {
  if (!isAudioEnabled()) return
  if (samples.length === 0) return
  const ctx = ensureContext()
  if (!ctx) return
  // Browsers start a fresh context suspended until the user interacts with the
  // page. Asking for a resume on every block covers that without spamming.
  if (ctx.state === "suspended") {
    void ctx.resume()
  }
  const frameCount = Math.floor(samples.length / 2)
  if (frameCount <= 0) return
  let buffer: AudioBuffer
  try {
    buffer = ctx.createBuffer(2, frameCount, sampleRate)
  } catch {
    // A DOC rate the device cannot represent - drop this block rather than
    // stalling the emulator.
    return
  }
  const left = buffer.getChannelData(0)
  const right = buffer.getChannelData(1)
  for (let i = 0; i < frameCount; i++) {
    left[i] = samples[i * 2] / 32768
    right[i] = samples[i * 2 + 1] / 32768
  }
  const source = ctx.createBufferSource()
  source.buffer = buffer
  if (outputNode) {
    source.connect(outputNode)
  } else {
    source.connect(ctx.destination)
  }
  // If we have fallen behind (worker paused, tab throttled) resync instead of
  // building an ever-growing backlog, which would grow without bound.
  const now = ctx.currentTime
  if (nextTime < now) nextTime = now
  if (nextTime > now + 0.5) nextTime = now
  source.start(nextTime)
  nextTime += frameCount / sampleRate
}

export const resetEnsoniqAudio = () => {
  if (!audioContext) return
  nextTime = audioContext.currentTime
  unregister?.()
  unregister = undefined
  void audioContext.close()
  audioContext = null
  outputNode = null
}