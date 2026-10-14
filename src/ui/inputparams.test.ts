jest.mock("./devices/disk/driveprops", () => ({
  doSetUIDriveProps: jest.fn(),
  setDefaultBinaryAddress: jest.fn(),
  handleSetDiskFromURL: jest.fn(),
}))
jest.mock("./devices/disk/cloudscriptloader", () => ({
  loadOneDriveScript: jest.fn(),
}))
jest.mock("./devices/disk/onedrive_authredirect", () => ({
  isOneDriveMsalAuthCallback: jest.fn(),
}))
jest.mock("./devices/audio/speaker", () => ({
  audioEnable: jest.fn(),
  emulatorSoundEnable: jest.fn(),
  clickSpeaker: jest.fn(),
}))
jest.mock("./devices/audio/mockingboard_audio", () => ({}))
jest.mock("./panels/disassembly/disassembly_utilities", () => ({
  set6502Instructions: jest.fn(),
  setDisassemblyVisibleMode: jest.fn(),
}))

import { handleInputParams, handleFragment } from "./inputparams"
import { getPreferenceSlotConfig, getPreferenceVeraSlot } from "./localstorage"
import { getTabView, getUIStateBoolean } from "./ui_settings"

describe("handleInputParams slot configuration", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  test("configures slot 2 with VERA card", () => {
    handleInputParams("slot2=vera")
    const config = getPreferenceSlotConfig()
    expect(config[2]).toBe("vera")
    expect(getPreferenceVeraSlot()).toBe(2)
  })

  test("configures slot 4 with VERA card and clears slot 2 if it had VERA", () => {
    handleInputParams("slot2=vera")
    expect(getPreferenceSlotConfig()[2]).toBe("vera")
    expect(getPreferenceVeraSlot()).toBe(2)

    handleInputParams("slot4=vera")
    const config = getPreferenceSlotConfig()
    expect(config[4]).toBe("vera")
    expect(config[2]).toBe("none")
    expect(getPreferenceVeraSlot()).toBe(4)
  })

  test("supports veraslot=2 parameter", () => {
    handleInputParams("veraslot=2")
    const config = getPreferenceSlotConfig()
    expect(config[2]).toBe("vera")
    expect(getPreferenceVeraSlot()).toBe(2)
  })

  test("supports other slot cards like slot1=ssc and slot3=vidhd", () => {
    handleInputParams("slot1=ssc&slot3=vidhd")
    const config = getPreferenceSlotConfig()
    expect(config[1]).toBe("ssc")
    expect(config[3]).toBe("vidhd")
  })

  test("supports combined slot2=vera&tab=vera", () => {
    handleInputParams("slot2=vera&tab=vera")
    expect(getPreferenceSlotConfig()[2]).toBe("vera")
    expect(getPreferenceVeraSlot()).toBe(2)
    expect(getTabView()).toBe(4)
    expect(getUIStateBoolean("infoPanel")).toBe(true)
  })
})


describe("handleFragment disk drive selection", () => {
  const { handleSetDiskFromURL } = jest.requireMock("./devices/disk/driveprops")

  // The URL fragment carries the disk to mount; the query string carries
  // ?drive=. Drive indices map to slots as 0/1 = S7, 2/3 = S6 (5.25"),
  // 4/5 = S5 (3.5"). On the Apple IIgs a 5.25" disk has to go into S6 or the
  // ROM never looks at it, so ?drive= is what makes one deep-linkable.
  const DISK = "http://example.com/disk.po"
  const setUrl = (query: string) =>
    window.history.replaceState({}, "", `/${query}#${DISK}`)

  beforeEach(() => {
    localStorage.clear()
    ;(handleSetDiskFromURL as jest.Mock).mockClear()
  })

  afterEach(() => {
    window.history.replaceState({}, "", "/")
  })

  test("defaults to drive 0 when no drive is given", async () => {
    setUrl("")
    await handleFragment(jest.fn(), false)
    expect(handleSetDiskFromURL).toHaveBeenCalledWith(DISK, expect.anything())
  })

  test("mounts into drive 2 (S6,D1) with ?drive=2", async () => {
    setUrl("?drive=2")
    await handleFragment(jest.fn(), false)
    expect(handleSetDiskFromURL).toHaveBeenCalledWith(DISK, expect.anything(), 2)
  })

  test("mounts into drive 3 (S6,D2) with ?drive=3", async () => {
    setUrl("?drive=3")
    await handleFragment(jest.fn(), false)
    expect(handleSetDiskFromURL).toHaveBeenCalledWith(DISK, expect.anything(), 3)
  })

  test("mounts into drive 4 (S5,D1) with ?drive=4", async () => {
    setUrl("?drive=4")
    await handleFragment(jest.fn(), false)
    expect(handleSetDiskFromURL).toHaveBeenCalledWith(DISK, expect.anything(), 4)
  })

  test("ignores an out-of-range drive", async () => {
    setUrl("?drive=9")
    await handleFragment(jest.fn(), false)
    expect(handleSetDiskFromURL).toHaveBeenCalledWith(DISK, expect.anything())
  })

  test("ignores a non-numeric drive", async () => {
    setUrl("?drive=abc")
    await handleFragment(jest.fn(), false)
    expect(handleSetDiskFromURL).toHaveBeenCalledWith(DISK, expect.anything())
  })
})
