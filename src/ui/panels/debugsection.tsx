import "./debugsection.css"
import Flyout from "../flyout"
import { faInfo as faHelp, faInfoCircle, faBug, faTerminal } from "@fortawesome/free-solid-svg-icons"
import { handleGetShowDebugTab, passSetDebug, passSetShowDebugTab } from "../main2worker"
import { crc32, UI_THEME } from "../../common/utility"
import { getHelpText, getTheme } from "../ui_settings"
import { useMemo, useState } from "react"
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome"
import DebugTab from "./debugtab"
import ExpectinTab from "./expectintab"
import HelpTab from "./helptab"
import { getDefaultHelpText } from "./defaulthelptext"
import { setPreferenceDebugMode } from "../localstorage"
import { useTranslation } from "../../i18n/useTranslation"

const DebugSection = (props: { updateDisplay: UpdateDisplay }) => {
  const { t } = useTranslation()
  const isMinimalTheme = getTheme() == UI_THEME.MINIMAL
  const [activeTab, setActiveTab] = useState<number>(0)
  const [isFlyoutOpen, setIsFlyoutOpen] = useState(false)
  const [helpTextCrc, setHelpTextCrc] = useState(0)

  if (isMinimalTheme) {
    import("./debugsection.minimal.css")
  }

  const currentHelpText = getHelpText()
  const defaultHelpText = getDefaultHelpText()
  const helpText = (currentHelpText.length > 1 && currentHelpText !== "<Default>") ? currentHelpText : defaultHelpText
  const newHelpTextCrc = crc32(new TextEncoder().encode(helpText))
  const showHighlight = !isFlyoutOpen && newHelpTextCrc != helpTextCrc

  const forceRefresh = () => {
    setTimeout(() => { window.dispatchEvent(new Event("resize")) }, 100)
  }

  const handleTabClick = (tabIndex: number) => (event: React.MouseEvent<HTMLElement>) => {
    setActiveTab(tabIndex)
    event.stopPropagation()
    forceRefresh()
    if (tabIndex == 1) {
      setPreferenceDebugMode(true)
      passSetDebug(true)
    } else {
      setPreferenceDebugMode(false)
      passSetDebug(false)
    }
  }

  const isSmall = isMinimalTheme && window.innerWidth < 800

  if (handleGetShowDebugTab()) {
    setIsFlyoutOpen(true)
    setActiveTab(1)
    passSetShowDebugTab(false)
  }

  useMemo(() => {
    forceRefresh()
    setHelpTextCrc(newHelpTextCrc)
  }, [isFlyoutOpen])

  return (
    <Flyout
      icon={faInfoCircle}
      position="top-right"
      title={t("controls.debugPanel")}
      highlight={showHighlight}
      isOpen={() => { return isFlyoutOpen }}
      onClick={() => {
        setIsFlyoutOpen(!isFlyoutOpen)
        props.updateDisplay()
      }}>
      <div id="debug-section">
        {!isSmall && <div className="flex-row dbg-tab-row">
          <div
            className={`dbg-tab ${activeTab == 0 ? " dbg-tab-active" : ""}`}
            title={t("debug.helpPanel")}
            onClick={handleTabClick(0)}>
            <FontAwesomeIcon icon={faHelp} size="lg" />
          </div>
          <div
            className={`dbg-tab ${activeTab == 1 ? " dbg-tab-active" : ""}`}
            title={t("debug.debugPanel")}
            id="tour-debug-button"
            onClick={handleTabClick(1)}>
            <FontAwesomeIcon icon={faBug} size="lg" />
          </div>
          <div
            className={`dbg-tab ${activeTab == 2 ? " dbg-tab-active" : ""}`}
            title={t("debug.expectinPanel")}
            onClick={handleTabClick(2)}>
            <FontAwesomeIcon icon={faTerminal} size="lg" />
          </div>
        </div>
        }
        {(activeTab == 0 || isSmall) && <HelpTab helptext={getHelpText()} />}
        {activeTab == 1 && !isSmall && <DebugTab updateDisplay={props.updateDisplay} />}
        {activeTab == 2 && !isSmall && <ExpectinTab />}
      </div>
    </Flyout>
  )
}

export default DebugSection
