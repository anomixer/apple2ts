import { doSetMachineName, ensoniqCatchUp, getIigsVblCount, setIigsVideoClockForTesting } from "./motherboard"
import { iigsEnsoniq } from "./devices/iigs_ensoniq"

const FRAME = 46727

test("DOC catch-up generates one outRate/60 block per refresh at stable rate", () => {
  jest.useFakeTimers()
  doSetMachineName("APPLE2GS")
  iigsEnsoniq.reset()
  iigsEnsoniq.writeDoc(0xe1, 0x3e)

  const w2m = require("./worker2main")
  const original = w2m.passEnsoniqSound
  let blocks = 0
  let postedFrames = 0
  w2m.passEnsoniqSound = (samples: Int16Array) => {
    blocks++
    postedFrames += samples.length / 2
  }

  try {
    setIigsVideoClockForTesting(0)
    ensoniqCatchUp()
    const before = iigsEnsoniq.samplesGenerated
    const FRAMES = 100
    for (let f = 0; f < FRAMES; f++) {
      // A refresh isn't all one call: the run loop and device accesses catch up
      // at instruction boundaries. Intermediate calls must only fill the due
      // fraction; the boundary completes the block exactly once.
      for (let step = 1; step <= 4; step++) {
        setIigsVideoClockForTesting(f * FRAME + Math.floor(step * FRAME / 5))
        ensoniqCatchUp()
      }
      setIigsVideoClockForTesting((f + 1) * FRAME)
      ensoniqCatchUp()
    }
    const rate = iigsEnsoniq.outputRate()
    const perRefresh = Math.round(rate / 60)
    const generated = iigsEnsoniq.samplesGenerated - before
    console.log(`[MARCH] frames=${FRAMES} blocks=${blocks} posted=${postedFrames} generated=${generated} want=${FRAMES * perRefresh}`)
    expect(rate).toBe(26320)
    expect(perRefresh).toBe(439)
    expect(blocks).toBe(FRAMES)
    expect(postedFrames).toBe(FRAMES * perRefresh)
    expect(generated).toBe(FRAMES * perRefresh)
  } finally {
    w2m.passEnsoniqSound = original
  }
})

test("DOC catch-up matches the refresh clock across real instruction-sized clock steps", () => {
  jest.useFakeTimers()
  doSetMachineName("APPLE2GS")
  iigsEnsoniq.reset()
  iigsEnsoniq.writeDoc(0xe1, 0x3e)

  const w2m = require("./worker2main")
  const original = w2m.passEnsoniqSound
  let blocks = 0
  let postedFrames = 0
  w2m.passEnsoniqSound = (samples: Int16Array) => {
    blocks++
    postedFrames += samples.length / 2
  }

  try {
    setIigsVideoClockForTesting(0)
    ensoniqCatchUp()
    const before = iigsEnsoniq.samplesGenerated
    const FRAMES = 100
    for (let f = 0; f < FRAMES; f++) {
      // 43 instruction steps per refresh, plus the boundary overshoot.
      let clock = f * FRAME
      for (let step = 0; step < 43; step++) {
        clock += 1087
        setIigsVideoClockForTesting(clock)
        ensoniqCatchUp()
      }
      setIigsVideoClockForTesting(clock + FRAME - (clock - f * FRAME))
      ensoniqCatchUp()
    }
    const rate = iigsEnsoniq.outputRate()
    const perRefresh = Math.round(rate / 60)
    const generated = iigsEnsoniq.samplesGenerated - before
    console.log(`[MARCH] instr frames=${FRAMES} blocks=${blocks} posted=${postedFrames} generated=${generated} want=${FRAMES * perRefresh}`)
    expect(rate).toBe(26320)
    expect(perRefresh).toBe(439)
    expect(blocks).toBe(FRAMES)
    expect(postedFrames).toBe(FRAMES * perRefresh)
    expect(generated).toBe(FRAMES * perRefresh)
  } finally {
    w2m.passEnsoniqSound = original
  }
})
