// Apple IIgs Ensoniq ES5503 "DOC" sound chip emulation.
// Based on the MAME ES5503 implementation as found in gssquared (src/devices/es5503).

// (unused removed)

export const ensoniqDocRam = new Uint8Array(0x10000)

interface Oscillator {
  freq: number
  wtsize: number
  control: number
  vol: number
  data: number
  wavetblpointer: number
  wavetblsize: number
  resolution: number
  accumulator: number
  irqpend: number
}

export class IigsEnsoniq {
  oscillators: Oscillator[] = []
  isReady = false
  constructor() {
    for (let i = 0; i < 32; i++) {
      this.oscillators[i] = { freq: 0, wtsize: 256, control: 0, vol: 0, data: 0x80, wavetblpointer: 0, wavetblsize: 0, resolution: 0, accumulator: 0, irqpend: 0 }
    }
    this.setIrqCallback((state) => {
      if (state) {
        (globalThis as any).cpu?.irq?.()
      } else {
        (globalThis as any).cpu?.clearIrq?.()
      }
    })
  }
  setIrqCallback(cb: (state: boolean) => void) {
    this.irqCallback = cb
  }
  updateIrqStatus() {
    let any = false
    const cnt = this.osce < 1 ? 1 : this.osce
    for (let i = 0; i < cnt; i++) {
      if (this.oscillators[i].irqpend) { any = true; break }
    }
    if (this.irqCallback) this.irqCallback(any)
  }
  irqPending(): boolean {
    const cnt = this.osce < 1 ? 1 : this.osce
    for (let i = 0; i < cnt; i++) {
      if (this.oscillators[i].irqpend) return true
    }
    return false
  }
  soundctl = 0x00
  soundadrl = 0x00
  soundadrh = 0x00
  sounddata = 0x00
  rege1 = 2
  osce = 1
  rege0 = 0xff
  irqCallback: ((state: boolean) => void) | null = null
  // $C03D is a pipeline: see readData(). Tracks whether $E0 was already
  // fetched in the current transaction so the two-read idiom cannot ack twice.
  e0FetchedThisTxn = false
  // Analog system volume from the low nibble of $C03C, 0..1. Slewed rather
  // than applied instantly: firmware and demos flip the nibble around DOC
  // accesses and a step change would chop the waveform (audible LF distortion).
  systemVolume = 1
  smoothedVolume = 1

  reset() {
    this.soundctl = 0x00
    this.soundadrl = 0x00
    this.soundadrh = 0x00
    this.sounddata = 0x00
    this.rege0 = 0xff
    this.rege1 = 2
    this.osce = 1
    this.e0FetchedThisTxn = false
    this.systemVolume = 1
    this.smoothedVolume = 1
    for (let i = 0; i < 32; i++) {
      const o = this.oscillators[i]
      o.freq = 0; o.wtsize = 256; o.control = 0; o.vol = 0; o.data = 0x80
      o.wavetblpointer = 0; o.wavetblsize = 0; o.resolution = 0
      o.accumulator = 0; o.irqpend = 0
    }
    // clear doc ram
    ensoniqDocRam.fill(0)
  }

  // Read a DOC register at offset (ES5503 protocol, offset 0..0xfe); register = offset&0x1f at top digit
  readDoc(offset: number): number {
    const osc = offset & 0x1f
    if (offset < 0xe0) {
      const group = offset & 0xe0
      switch (group) {
        case 0x00: return this.oscillators[osc].freq & 0xff
        case 0x20: return (this.oscillators[osc].freq >> 8) & 0xff
        case 0x40: return this.oscillators[osc].vol & 0xff
        case 0x60: return this.oscillators[osc].data & 0xff
        case 0x80: return (this.oscillators[osc].wavetblpointer >> 8) & 0xff
        case 0xa0: return this.oscillators[osc].control & 0xff
        case 0xc0: {
          let retval = 0
          if (this.oscillators[osc].wavetblpointer & 0x10000) retval |= 0x40
          retval |= (this.oscillators[osc].wavetblsize << 3)
          retval |= this.oscillators[osc].resolution & 0x07
          return retval & 0xff
        }
      }
      return 0
    } else {
      switch (offset) {
        case 0xe0: {
          let retval = this.rege0
          if (this.irqCallback) this.irqCallback(false)
          // Ack one pending oscillator. gssquared es5503.cpp: when a pend is
          // found, retval becomes (i << 1) — bit 7 clear ("interrupt present"),
          // voice number in bits 5-1 — and rege0 stages retval | 0x80 for the
          // next read. The ROM's IRQ dispatcher (FF:B91F) trusts that bit to
          // decide whether to JSL $E1:002C.
          for (let i = 0; i < (this.osce < 1 ? 1 : this.osce); i++) {
            if (this.oscillators[i].irqpend) {
              retval = i << 1
              this.rege0 = retval | 0x80
              this.oscillators[i].irqpend = 0
              break
            }
          }
          // Reassert if more pending
          let any = false
          for (let i = 0; i < (this.osce < 1 ? 1 : this.osce); i++) {
            if (this.oscillators[i].irqpend) { any = true; break }
          }
          if (any && this.irqCallback) this.irqCallback(true)
          return retval | 0x41
        }
        case 0xe1: return this.rege1 & 0xff
        case 0xe2: return 0
        default: return 0
      }
    }
  }

  writeDoc(offset: number, data: number) {
    const osc = offset & 0x1f
    if (offset < 0xe0) {
      const group = offset & 0xe0
      switch (group) {
        case 0x00: this.oscillators[osc].freq = (this.oscillators[osc].freq & 0xff00) | (data & 0xff); break
        case 0x20: this.oscillators[osc].freq = (this.oscillators[osc].freq & 0x00ff) | ((data & 0xff) << 8); break
        case 0x40: this.oscillators[osc].vol = data & 0xff; break
        case 0x60: break // ignore writes
        case 0x80: {
          // Wave table pointer high byte. Bit 16 is owned by the $C0 register,
          // so preserve it; everything below bit 16 comes from this byte.
          this.oscillators[osc].wavetblpointer =
            (this.oscillators[osc].wavetblpointer & 0x10000) | ((data & 0xff) << 8)
          break
        }
        case 0xa0: {
          const o = this.oscillators[osc]
          // key on
          if ((o.control & 1) && !(data & 1)) {
            o.accumulator = 0
          }
          // handle cpu halt
          o.control = data & 0xff
          break
        }
        case 0xc0: {
          const o = this.oscillators[osc]
          if (data & 0x40) o.wavetblpointer |= 0x10000
          else o.wavetblpointer &= ~0x10000 & 0xFFFFFF
          o.wavetblsize = (data >> 3) & 7
          // wavesizes: [256,512,...]
          const wavesizes = [256,512,1024,2048,4096,8192,16384,32768]
          o.wtsize = wavesizes[o.wavetblsize]
          o.resolution = (data & 0x07)
          break
        }
      }
    } else if (offset === 0xe1) {
      this.rege1 = data & 0xff
      this.osce = ((data >> 1) & 0x1f) + 1
    }
  }

  readControl(): number {
    // sound control read returns soundctl | 0x0F
    return (this.soundctl & 0x70) | 0x0F
  }

  // Sound GLU $C03D read: a one-access pipeline, as on real DOC hardware and in
  // MAME/gssquared (ensoniq_doc_data_read_pipeline). The read returns the value
  // latched by the *previous* access and simultaneously fetches the byte at the
  // current address into the latch.
  //
  // This matters: IIgs software (and the ROM's own IRQ dispatcher, which reads
  // $C03D twice) relies on priming read -> set address -> read to get data. If a
  // read returned the current address directly, every such sequence returned
  // stale or wrong data and the caller spun or acted on garbage - which is what
  // hung Music Construction Set right after its main screen appeared.
  readData(): number {
    const ret = this.sounddata
    const fullAddr = ((this.soundadrh << 8) | this.soundadrl) & 0xffff
    if (this.soundctl & 0x40) {
      this.sounddata = ensoniqDocRam[fullAddr]
    } else {
      // Reading $E0 acknowledges the lowest pending oscillator interrupt. The
      // two-read idiom above would ack two oscillators while servicing one, so
      // only fetch $E0 once per transaction. A $C03C/$C03E/$C03F write starts
      // a new transaction.
      if (this.soundadrl !== 0xe0 || !this.e0FetchedThisTxn) {
        this.e0FetchedThisTxn = (this.soundadrl === 0xe0)
        this.sounddata = this.readDoc(this.soundadrl)
      }
    }
    // Busy (bit 7) is read-only and must never be left stuck after a data read.
    this.soundctl &= ~0x80
    if (this.soundctl & 0x20) {
      const next = (fullAddr + 1) & 0xffff
      this.soundadrl = next & 0xff
      this.soundadrh = (next >> 8) & 0xff
    }
    return ret & 0xff
  }

  readAddrLow(): number {
    return this.soundadrl & 0xff
  }
  readAddrHigh(): number {
    return this.soundadrh & 0xff
  }

  writeControl(data: number) {
    // Bit 7 (busy) is read-only and always clears on write.
    this.soundctl = (data & 0x7F)
    this.e0FetchedThisTxn = false
    // The low nibble is the analog system volume. Ignoring it means software
    // that sets volume 0 still makes noise; ignoring silence means the chip is
    // simply mute.
    this.systemVolume = (data & 0x0f) / 15
    // In register mode (bit 6 clear) only the low address byte is meaningful;
    // a leftover RAM pointer must not leak into register accesses.
    if (!(this.soundctl & 0x40)) {
      this.soundadrh = 0
    }
  }

  writeData(data: number) {
    // A data write also loads the latch, so a following $C03D read returns it
    // (the pipeline returns the previous latch, not the just-written byte).
    this.sounddata = data & 0xff
    const fullAddr = ((this.soundadrh << 8) | this.soundadrl) & 0xffff
    if (this.soundctl & 0x40) {
      ensoniqDocRam[fullAddr] = data & 0xff
    } else {
      this.writeDoc(this.soundadrl, data & 0xff)
    }
    if (this.soundctl & 0x20) {
      let a = (fullAddr + 1) & 0xffff
      this.soundadrl = a & 0xff
      this.soundadrh = (a >> 8) & 0xff
    }
  }

  writeAddrLow(data: number) {
    this.e0FetchedThisTxn = false
    this.soundadrl = data & 0xff
  }

  writeAddrHigh(data: number) {
    this.e0FetchedThisTxn = false
    this.soundadrh = data & 0xff
  }

  // Whether any oscillator is currently running. Volume is deliberately NOT
  // required: a zero-volume oscillator with a frequency and the halt bit clear
  // is the standard IIgs timer-oscillator tick (Apple TN #23) — the chip must
  // keep advancing it so its end-of-wave IRQ fires and drivers wake from WAI.
  hasActiveOscillators(): boolean {
    for (let i = 0; i < Math.max(1, this.osce); i++) {
      const o = this.oscillators[i]
      if (!(o.control & 1) && o.freq > 0) {
        return true
      }
    }
    return false
  }

  // halt_osc() ported verbatim from gssquared ensoniq.cpp (MAME-derived).
  // type 0 = wave-table end reached (wrap), type 1 = zero byte in sample data.
  // Sync/AM groups loop rather than halt (retriggering the odd partner), swap
  // mode starts its partner, free-run preserves fractional phase, and the voice
  // IRQ fires in every case when control bit 3 is set — which is how zero-volume
  // timer oscillators tick IIgs sound drivers (Apple TN #23) and wake WAI.
  private haltOsc(onum: number, type: 0 | 1, accHolder: { v: number }, resshift: number, newCtrl: number) {
    const o = this.oscillators[onum]
    const partner = this.oscillators[onum ^ 1]
    let mode = (o.control >> 1) & 3
    const partnerMode = (partner.control >> 1) & 3

    // Check for sync mode
    if (mode === 2) {
      if ((onum & 1) === 0 && onum > 0) {
        // We're even, so if the odd oscillator 1 below us is playing, restart it
        if (!(this.oscillators[onum - 1].control & 1)) {
          this.oscillators[onum - 1].accumulator = 0
        }
      }
      // Loop this oscillator for both sync and AM
      mode = 0
    }

    // If 0 found in sample data or mode is not free-run, halt this oscillator
    if ((mode !== 0) || (type !== 0)) {
      o.control |= 1
    } else {
      // Preserve fractional phase when looping (MAME / Peter Ferrie): subtract
      // (wtsize - 1) << resshift, not the full table, not "zero the index".
      const wtsizeM1 = o.wtsize - 1
      accHolder.v -= (wtsizeM1 << resshift)
    }

    // If we're in swap mode, start the partner
    if (mode === 3) {
      partner.control &= ~1    // Clear the halt bit
      partner.accumulator = 0
    } else {
      // If we're the even oscillator and partner is swap, we retrigger
      if (partnerMode === 3 && (onum & 1) === 0) {
        o.control &= ~1
        const wtsize = o.wtsize - 1
        accHolder.v -= (wtsize << resshift)
      }
    }
    o.control &= 0xff

    // IRQ enabled for this voice?
    if (o.control & 0x08) {
      // MAME: when the halt comes from a CPU write (type 0), only fire if the
      // newly written control value also has IRQ enabled (NTPstop / Bard's Tale).
      if (type === 0 && !(newCtrl & 0x08)) {
        return
      }
      o.irqpend = 1
      this.updateIrqStatus()
    }
  }

  // Produce a short PCM (Int16 samples) block at DOC output rate
  generateSamples(numFrames: number): Int16Array {
    const wavemasks = [0x1ff00,0x1fe00,0x1fc00,0x1f800,0x1f000,0x1e000,0x1c000,0x18000]
    const accmasks = [0xff,0x1ff,0x3ff,0x7ff,0xfff,0x1fff,0x3fff,0x7fff]
    const resshifts = [9,10,11,12,13,14,15,16]
    const ossecs = Math.max(1, this.osce)
    const chan = 2
    const buffer = new Int16Array(numFrames * chan)
    // clean buffer
    buffer.fill(0)
    const mix = new Int32Array(numFrames * chan)
    mix.fill(0)
    for (let ch = 0; ch < chan; ch++) {
      for (let osc = 0; osc < ossecs; osc++) {
        const o = this.oscillators[osc]
        if (o.control & 1) continue  // halted
        const assigned = (o.control >> 4) & (chan - 1)
        const achan = (chan === 2) ? (assigned ^ 1) : assigned
        if (achan !== ch) continue
        const wtptr = o.wavetblpointer & wavemasks[o.wavetblsize]
        const resshift = resshifts[o.resolution] - o.wavetblsize
        const sizemask = accmasks[o.wavetblsize]
        const vol = o.vol
        const freq = o.freq
        const wtsizeMinus = o.wtsize - 1
        const mode = (o.control >> 1) & 3
        let acc = o.accumulator
        let ctrl = o.control
        for (let s = 0; s < numFrames; s++) {
          const shift = resshift < 1 ? 1 : resshift
          const altram = acc >> shift
          let ramptr = altram & sizemask
          acc += freq
          const waveByte = ensoniqDocRam[(ramptr + wtptr) & 0xffff]
          const data = waveByte ^ 0x80
          const accHolder = { v: acc }
          if (waveByte === 0) {
            this.haltOsc(osc, 1, accHolder, shift, o.control)
            ctrl = o.control
          } else {
            if (mode !== 2) {
              mix[(s*chan)+ch] += data * vol
              if (osc === ossecs - 1) {
                mix[(s*chan)+ch] += data * vol
                mix[(s*chan)+ch] += data * vol
              }
            } else {
              if (!(osc & 1)) {
                mix[(s*chan)+ch] += data * vol
                if (osc === ossecs - 1) {
                  mix[(s*chan)+ch] += data * vol
                  mix[(s*chan)+ch] += data * vol
                }
              } else {
                if (osc < 31) {
                  if (!(this.oscillators[osc+1].control & 1)) {
                    this.oscillators[osc+1].vol = (data ^ 0x80)
                  }
                }
              }
            }
            acc = accHolder.v
            // MAME: wrap/halt when pre-increment position reaches end
            // (wtsizeMinus here is already o.wtsize - 1).
            if (altram >= wtsizeMinus) {
              this.haltOsc(osc, 0, accHolder, shift, o.control)
              ctrl = o.control
            }
            acc = accHolder.v
          }
          if (ctrl & 1) break
          o.data = data ^ 0x80
        }
        o.accumulator = acc
        o.control = ctrl & 0xff
      }
    }
    // mix -> buffer, applying the smoothed analog system volume
    const gain = this.smoothedVolume
    for (let i = 0; i < numFrames * chan; i++) {
      let sample = Math.floor(mix[i] * gain / 8)
      if (sample > 32767) sample = 32767
      if (sample < -32768) sample = -32768
      buffer[i] = sample
    }
    // Slew towards the target over roughly 20ms of samples.
    const alpha = Math.min(1, numFrames / (0.020 * Math.max(1, 28000)))
    this.smoothedVolume += (this.systemVolume - this.smoothedVolume) * alpha
    return buffer
  }
}

export const iigsEnsoniq = new IigsEnsoniq()

export function ensoniqReset() {
  iigsEnsoniq.reset()
}

// How much a program actually talks to the chip. Cheap counters, always on (four
// integer increments), so a test or the worker can answer "did this program ever
// program the DOC?" instead of guessing from the silence.
export const docAccess = { control: 0, data: 0, addrLow: 0, addrHigh: 0, reads: 0, framesWithOsc: 0 }

export const resetDocAccess = () => {
  docAccess.control = 0
  docAccess.data = 0
  docAccess.addrLow = 0
  docAccess.addrHigh = 0
  docAccess.reads = 0
  docAccess.framesWithOsc = 0
}
