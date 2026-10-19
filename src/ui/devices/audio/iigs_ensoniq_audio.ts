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
// How many blocks have actually reached playback. The DOC only renders when an
// oscillator is active, so a silent machine and a broken transport look identical
// from here unless the blocks are counted. Mirrors getSpeakerClickCount().
let blocksPlayed = 0

export const getEnsoniqBlocksPlayed = (): number => blocksPlayed

// Debug counters for browser diagnosis (?ensoniqdbg=1 exposes them as
// window.__ensoniqDebug). A silent machine and a suspended AudioContext look
// identical from the block counter alone, and resume() rejections are otherwise
// swallowed by void.
const ensoniqDebug = {
  contextState: "none",
  resumeAttempts: 0,
  resumeFailures: 0,
  lastResumeError: "",
  playCalls: 0,
}
export const getEnsoniqDebug = () => ensoniqDebug
const noteEnsoniqDebug = () => {
  if (typeof window === "undefined") return
  ;(window as unknown as { __ensoniqDebug?: unknown }).__ensoniqDebug = {
    ...ensoniqDebug,
    contextState: audioContext ? audioContext.state : "none",
  }
}

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
  ensoniqDebug.playCalls++
  noteEnsoniqDebug()
  if (!isAudioEnabled()) {
    ensoniqDebug.contextState = "disabled"
    return
  }
  if (samples.length === 0) return
  blocksPlayed++
  // Exposed on the page so a headless run can distinguish "the DOC produced
  // nothing" from "the transport dropped it", which is otherwise invisible.
  if (typeof window !== "undefined") {
    ;(window as unknown as { __ensoniqBlocks?: number }).__ensoniqBlocks = blocksPlayed
  }
  const ctx = ensureContext()
  if (!ctx) {
    ensoniqDebug.contextState = "unavailable"
    return
  }
  // Browsers start a fresh context suspended until the user interacts with the
  // page. Asking for a resume on every block covers that without spamming -
  // and every rejected resume is now counted instead of swallowed, so a
  // never-unblocked transport is diagnosable (window.__ensoniqDebug).
  if (ctx.state === "suspended") {
    ensoniqDebug.resumeAttempts++
    ctx.resume().catch((error) => {
      ensoniqDebug.resumeFailures++
      ensoniqDebug.lastResumeError = String(error)
    })
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
  // Keep a small reserve in front of the clock. Blocks arrive per worker
  // refresh (every ~16.7ms) and only cover their own duration, so the queue
  // sits at zero depth: any main-thread delay longer than one block (React
  // render, paint, another message in flight) gaps the stream and forces a
  // resync — audible as lag/stutter. A ~60ms lead buffers through that jitter
  // and costs nothing except start latency. The upstream cap still bounds the
  // backlog if the worker ever sprints ahead.
  const minLead = 0.06
  if (nextTime < now + minLead) nextTime = now + minLead
  if (nextTime > now + 0.5) nextTime = now
  source.start(nextTime)
  nextTime += frameCount / sampleRate
  noteEnsoniqDebug()
}

export const resetEnsoniqAudio = () => {
  if (!audioContext) return
  nextTime = audioContext.currentTime
  unregister?.()
  unregister = undefined
  void audioContext.close()
  audioContext = null
  outputNode = null
  blocksPlayed = 0
  ensoniqDebug.contextState = "none"
  ensoniqDebug.resumeAttempts = 0
  ensoniqDebug.resumeFailures = 0
  ensoniqDebug.lastResumeError = ""
  ensoniqDebug.playCalls = 0
  if (typeof window !== "undefined") {
    ;(window as unknown as { __ensoniqBlocks?: number }).__ensoniqBlocks = 0
  }
  noteEnsoniqDebug()
}