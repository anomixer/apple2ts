// Debug-only 65816 PC trace, used to compare where the Apple IIgs ROM boot
// scan diverges between two environments (the jest harness boots a 5.25" floppy,
// the browser does not - see AGENTS.md section 26b). Off unless ?romtrace=1 is
// in the URL, so it costs nothing in normal use.
//
// Two views of the same data:
//   first - the first MAX_SEQUENCE program counters executed after the last
//           clearRomTrace(), in order. Diffing two of these finds the exact
//           instruction where two runs diverge.
//   hist  - how many times each program counter was executed, which shows where
//           a run is spinning (a scan that dies looks completely different from
//           a scan that is churning through slot ROMs).
export interface RomTrace {
  enabled: boolean
  instructions: number
  first: number[]
  last: number[]
  hist: Record<string, number>
}

// Large enough to cover a whole boot scan (the harness runs ~9M instructions
// between a reset and ProDOS), which is what makes an automatic diff against
// another environment possible.
const MAX_SEQUENCE = 300000
const MAX_LAST = 600
const MAX_HIST = 400

let enabled = false
let instructions = 0
const first: number[] = []
const last: number[] = []
const hist = new Map<number, number>()

export const setRomTraceEnabled = (value: boolean) => { enabled = value }

export const clearRomTrace = () => {
  instructions = 0
  first.length = 0
  last.length = 0
  hist.clear()
}

// Called once per 65816 instruction. Deliberately a single boolean check plus
// two cheap operations, so the disabled path costs nothing measurable.
export const recordRomPc = (pc24: number) => {
  if (!enabled) return
  instructions++
  if (first.length < MAX_SEQUENCE) first.push(pc24)
  // Ring buffer of the most recent PCs. `first` shows where a run starts, but
  // what matters for a stuck machine is where it is right now.
  last.push(pc24)
  if (last.length > MAX_LAST) last.shift()
  hist.set(pc24, (hist.get(pc24) ?? 0) + 1)
}

export const getRomTrace = (): RomTrace => {
  const entries = Array.from(hist.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_HIST)
  const histOut: Record<string, number> = {}
  for (const [pc, count] of entries) histOut[pc.toString(16)] = count
  return { enabled, instructions, first, last, hist: histOut }
}