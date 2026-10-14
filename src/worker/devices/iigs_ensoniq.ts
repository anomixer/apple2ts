// Apple IIgs Ensoniq ES5503 "DOC" sound chip emulation.
// Based on the MAME ES5503 implementation as found in gssquared (src/devices/es5503).

// (unused removed)

import { s6502 } from "../instructions"

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

  reset() {
    this.soundctl = 0x00
    this.soundadrl = 0x00
    this.soundadrh = 0x00
    this.sounddata = 0x00
    this.rege0 = 0xff
    this.rege1 = 2
    this.osce = 1
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
        case 0x80: {
          let retval = 0
          if (this.oscillators[osc].wavetblpointer & 0x10000) retval |= 0x40
          retval |= (this.oscillators[osc].wavetblsize << 3)
          retval |= this.oscillators[osc].resolution & 0x07
          return retval & 0xff
        }
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
          const retval = this.rege0
          if (this.irqCallback) this.irqCallback(false)
          // Ack one pending oscillator
          for (let i = 0; i < (this.osce < 1 ? 1 : this.osce); i++) {
            if (this.oscillators[i].irqpend) {
              this.rege0 = (i << 1) | 0x80
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
          this.oscillators[osc].wavetblpointer = (data << 8) | (this.oscillators[osc].wavetblpointer & ~0xff00) & 0x0000
          // keep bit16 as-is
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

  readData(): number {
    const fullAddr = ((this.soundadrh << 8) | this.soundadrl) & 0xffff
    if (this.soundctl & 0x40) {
      this.sounddata = ensoniqDocRam[fullAddr]
    } else {
      this.sounddata = this.readDoc(this.soundadrl)
    }
    // auto increment
    if (this.soundctl & 0x20) {
      let a = (fullAddr + 1) & 0xffff
      this.soundadrl = a & 0xff
      this.soundadrh = (a >> 8) & 0xff
    }
    return this.sounddata & 0xff
  }

  readAddrLow(): number {
    return this.soundadrl & 0xff
  }
  readAddrHigh(): number {
    return this.soundadrh & 0xff
  }

  writeControl(data: number) {
    this.soundctl = (data & 0x7F)
  }

  writeData(data: number) {
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
    this.soundadrl = data & 0xff
  }

  writeAddrHigh(data: number) {
    this.soundadrh = data & 0xff
  }

  // Whether any oscillator is currently active (heard sound likely)
  hasActiveOscillators(): boolean {
    for (let i = 0; i < Math.max(1, this.osce); i++) {
      const o = this.oscillators[i]
      if (!(o.control & 1) && o.vol > 0 && o.freq > 0) {
        return true
      }
    }
    return false
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
          const altram = acc >> (resshift < 1 ? 1 : resshift)
          let ramptr = altram & sizemask
          acc += freq
          let data = ensoniqDocRam[(ramptr + wtptr) & 0xffff] ^ 0x80
          // loop
          if (ensoniqDocRam[(ramptr + wtptr) & 0xffff] === 0) {
            ctrl |= 1
            if (o.control & 0x08) {
              o.irqpend = 1
              this.updateIrqStatus()
            }
          }
          if (!(ctrl & 1)) {
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
          }
          if (altram >= wtsizeMinus) {
            // Free-run wraps by phase (gssquared halt_osc type 0) instead of
            // stopping.
            if (mode !== 0) {
              ctrl |= 1
            } else {
              acc -= (wtsizeMinus << (resshift < 1 ? 1 : resshift))
            }
          }
          if (ctrl & 1) break
          // datastore
        }
        o.accumulator = acc
        o.control = ctrl & 0xff
      }
    }
    // mix -> buffer
    const mixptr = mix
    for (let i = 0; i < numFrames * chan; i++) {
      let sample = Math.floor(mixptr[i] / 8)
      if (sample > 32767) sample = 32767
      if (sample < -32768) sample = -32768
      buffer[i] = sample
    }
    return buffer
  }
}

export const iigsEnsoniq = new IigsEnsoniq()

export function ensoniqReset() {
  iigsEnsoniq.reset()
}
