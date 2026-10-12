import { DEFAULT_SLOT_CONFIG, DEFAULT_SLOT_CONFIG_GS } from "./utility"

export const RAM_OPTIONS = [64, 512, 1024, 4096, 8192] as const

export const SLOT_NUMBERS = [1, 2, 3, 4, 5, 6, 7] as const
export type SlotNumber = typeof SLOT_NUMBERS[number]

export type SlotOption = {
  card: SLOT_CARD_ID
  ramSizeKb?: typeof RAM_OPTIONS[number]
}

export const getSlotOptions = (slot: SlotNumber, machine: MACHINE_NAME): SlotOption[] => {
  if (machine === "APPLE2GS") {
    switch (slot) {
      case 1:
        return [{ card: "none" }, { card: "ssc" }]
      case 2:
        return [{ card: "none" }]
      case 3:
        return [{ card: "none" }]
      case 4:
        return [{ card: "none" }, { card: "mockingboard" }]
      case 5:
        return [{ card: "none" }]
      case 6:
        return [{ card: "none" }, { card: "disk2" }]
      case 7:
        return [{ card: "none" }, { card: "smartport" }]
    }
  }
  if (slot === 3) {
    return machine === "APPLE2P"
      ? [{ card: "none" }, { card: "videoterm" }, { card: "vidhd" }]
      : [
        { card: "none" },
        ...RAM_OPTIONS.map(ramSizeKb => ({ card: "aux" as const, ramSizeKb })),
        { card: "vidhd" },
      ]
  }
  const options: Record<SlotNumber, SLOT_CARD_ID[]> = {
    1: ["none", "ssc"],
    2: ["none", "vera", "passport", "softcard"],
    3: [],
    4: ["none", "mouse", "mockingboard", "vera", "softcard"],
    5: ["none", "mouse", "mockingboard", "softcard"],
    6: ["none", "disk2"],
    7: ["none", "smartport"],
  }
  return options[slot].map(card => ({ card }))
}

export const sanitizeSlotConfig = (config: SlotConfig, machine: MACHINE_NAME): SlotConfig => {
  const next = { ...config }
  for (const slot of SLOT_NUMBERS) {
    const allowed = getSlotOptions(slot, machine).map(o => o.card)
    if (!allowed.includes(next[slot])) {
      const defaultCard = machine === "APPLE2GS"
        ? DEFAULT_SLOT_CONFIG_GS[slot]
        : (machine === "APPLE2P" && slot === 3 ? "videoterm" : DEFAULT_SLOT_CONFIG[slot])
      next[slot] = allowed.includes(defaultCard) ? defaultCard : "none"
    }
  }
  return next
}
