import { Step } from "react-joyride"
import { passSetDebug, passSetShowDebugTab } from "../main2worker"
import { i18n } from "../../i18n"

const isTouchDevice = "ontouchstart" in document.documentElement
const isMac = navigator.platform.startsWith("Mac")
const modKey = isMac ? "⌘" : "Alt"

const callbackInDebugMode: StepCallbackFunction = () => {
  passSetDebug(true)
  passSetShowDebugTab(true)
  // Continue processing tour commands
  return false
}

export const getTourSettings = (): Step[] => {
  const t = i18n.t.bind(i18n)
  
  const altArrowKeys = <div>{t("tour.altArrowKeys").replace("{modKey}", modKey)}<p /></div>
  
  return [
    {
      target: "body",
      placement: "center",
      content: t("tour.settingsWelcome")
    },
    {
      target: "#tour-maincontrols",
      content: t("tour.mainControls"),
    },
    {
      target: "#tour-snapshot",
      content: t("tour.snapshot"),
    },
    {
      target: "#tour-pause-button",
      content: t("tour.pauseButton")
    },
    {
      target: "#tour-debug-button",
      content: t("tour.debugButton"),
      data: callbackInDebugMode
    },
    {
      target: "#tour-configbuttons",
      content: t("tour.configButtons"),
    },
    {
      target: "#tour-keyboardbuttons",
      content: (<div style={{ textAlign: "left" }}>{t("tour.keyboardButtons")}<p />
        {isTouchDevice ? "" : altArrowKeys}</div>),
    },
    {
      target: "#tour-clearcookies",
      content: t("tour.clearCookies"),
    },
    {
      target: "body",
      placement: "center",
      content: t("tour.endTour"),
    },
  ]
}

// 保持向後相容性
export const tourSettings = getTourSettings()
