import { Step } from "react-joyride"
import { handleGetRunMode, passSetDebug, passSetRunMode, passSetShowDebugTab } from "../main2worker"
import { RUN_MODE } from "../../common/utility"
import { i18n } from "../../i18n"

let neededToBoot = false
let didBoot = false

const callbackInDebugMode: StepCallbackFunction = () => {
  const runMode = handleGetRunMode()
  neededToBoot = runMode === RUN_MODE.IDLE
  didBoot = false
  passSetDebug(true)
  passSetShowDebugTab(true)
  // Continue processing tour commands
  return false
}

const callbackPauseEmulator: StepCallbackFunction = () => {
  if (neededToBoot && !didBoot) {
    didBoot = true
    passSetRunMode(RUN_MODE.NEED_BOOT)
  }
  // Continue processing tour commands
  return false
}

const callbackDebugControls: StepCallbackFunction = () => {
  const runMode = handleGetRunMode()
  if (runMode !== RUN_MODE.PAUSED) {
    if (didBoot) {
      didBoot = false
      passSetRunMode(RUN_MODE.NEED_RESET)
    }
    setTimeout(() => {passSetRunMode(RUN_MODE.PAUSED)}, 250)
  }
  // Continue processing tour commands
  return false
}

export const getTourDebug = (): Step[] => {
  const t = i18n.t.bind(i18n)
  
  return [
    {
      target: "body",
      placement: "center",
      content: t("tour.debugWelcome")
    },
    {
      target: "#tour-debug-button",
      content: t("tour.debugIcon"),
      data: callbackInDebugMode
    },
    {
      target: "#tour-debug-pause",
      content: t("tour.debugPause"),
      data: callbackPauseEmulator
    },
    {
      target: "#tour-debug-controls",
      content: t("tour.debugControls"),
      data: callbackDebugControls
    },
    {
      target: "#tour-debug-disassembly",
      content: t("tour.debugDisassembly"),
      placement: "left"
    },
    {
      target: "#tour-debug-info",
      content: t("tour.debugInfo"),
      placement: "left"
    },
    {
      target: "#tour-debug-memorydump",
      content: t("tour.debugMemory"),
      placement: "left"
    },
    {
      target: "body",
      placement: "center",
      content: t("tour.endTour"),
    },
  ]
}

// 保持向後相容性
export const tourDebug = getTourDebug()
