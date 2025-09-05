import { lockedKeyStyle, themeToName, UI_THEME } from "../../common/utility"
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome"
import {
  faVolumeHigh,
  faVolumeXmark,
  faUpDownLeftRight,
  faSlash,
  faSync,
  faPalette,
} from "@fortawesome/free-solid-svg-icons"
import { MachineConfig } from "../devices/machineconfig"
import { resetPreferences, setPreferenceCapsLock, setPreferenceTheme } from "../localstorage"
import { DisplayConfig } from "../devices/displayconfig"
import RunTour from "../tours/runtour"
import { appleOutline } from "../img/icon_appleoutline"
import { useState } from "react"
import PopupMenu from "./popupmenu"
import { MidiDeviceSelect } from "../devices/audio/midiselect"
import { MockingboardWaveform } from "../devices/audio/mockingboardwaveform"
import { audioEnable, isAudioEnabled } from "../devices/audio/speaker"
import { SerialPortSelect } from "../devices/serial/serialselect"
import { SpeedDropdown } from "./speeddropdown"
import { getCapsLock, getArrowKeysAsJoystick, getUseOpenAppleKey, setUseOpenAppleKey, setArrowKeysAsJoystick, getTheme } from "../ui_settings"
import { useTranslation } from "../../i18n/useTranslation"

const isTouchDevice = "ontouchstart" in document.documentElement
const isMac = navigator.platform.startsWith("Mac")

const ConfigButtons = (props: DisplayProps) => {
  const { t } = useTranslation()
  const capsLock = getCapsLock()
  const arrowKeysAsJoystick = getArrowKeysAsJoystick()
  const useOpenAppleKey = getUseOpenAppleKey()
  const modKey = isMac ? "⌘" : "Alt"

  const [popupLocation, setPopupLocation] = useState<[number, number]>()

  const handleClick = (event: React.MouseEvent) => {
    setPopupLocation([event.clientX, event.clientY])
  }
  
  return <div className="flex-row">
    <div className="flex-row" id="tour-configbuttons">

      <SpeedDropdown updateDisplay={props.updateDisplay} />

      <DisplayConfig updateDisplay={props.updateDisplay} />

      <button className="push-button"
        title={t("controls.toggleSound")}
        style={{ display: typeof AudioContext !== "undefined" ? "" : "none" }}
        onClick={() => { audioEnable(!isAudioEnabled()); props.updateDisplay() }}>
        <FontAwesomeIcon icon={isAudioEnabled() ? faVolumeHigh : faVolumeXmark} />
      </button>
    </div>

    <div className="flex-row" id="tour-keyboardbuttons">
      <button className={lockedKeyStyle(capsLock ? 2 : 0)}
        title={`${t("config.capsLock")} (${capsLock ? t("messages.on") : t("messages.off")})`}
        onClick={() => { setPreferenceCapsLock(!capsLock); props.updateDisplay() }}>
        <span className="text-key" style={{ fontSize: "18pt" }}>{capsLock ? "A" : "a"}</span>
      </button>

      {!isTouchDevice &&
        <button className="push-button"
          title={useOpenAppleKey ? `${t("config.useOpenApple")} ${modKey}` : `${t("config.useShortcuts")} ${modKey}`}
          onClick={() => { setUseOpenAppleKey(!useOpenAppleKey); props.updateDisplay() }}>
          {useOpenAppleKey ?
            <svg width="28" height="28" className="fill-color">{appleOutline}</svg> :
            <span className={(modKey === "Alt") ? "text-key" : ""}>{modKey.toLowerCase()}</span>}
        </button>
      }

      {!isTouchDevice &&
        <button className="push-button" style={{ position: "relative" }}
          title={`${t("config.useArrowKeys")} (${arrowKeysAsJoystick ? t("messages.on") : t("messages.off")})`}
          onClick={() => { setArrowKeysAsJoystick(!arrowKeysAsJoystick); props.updateDisplay() }}>
          <FontAwesomeIcon icon={faUpDownLeftRight} style={arrowKeysAsJoystick ? {} : { transform: "translateX(50%)" }} />
          {!arrowKeysAsJoystick && <FontAwesomeIcon style={{ transform: "translateX(-50%)", width: "80%" }} icon={faSlash} />}
        </button>
      }
    </div>

    <MockingboardWaveform />

    <SerialPortSelect />

    <MidiDeviceSelect />

    <MachineConfig updateDisplay={props.updateDisplay} />

    <button className="push-button"
      id="tour-theme-button"
      title={`${themeToName(getTheme())} ${t("config.theme")}`}
      onClick={handleClick}>
      <FontAwesomeIcon icon={faPalette} />
    </button>

    <PopupMenu
      location={popupLocation}
      onClose={() => { setPopupLocation(undefined) }}
      menuItems={[Object.values(UI_THEME).filter(value => typeof value === "number").map((value, i) => {
        return {
          label: t(`themes.${themeToName(i).toLowerCase()}`),
          isSelected: () => { return i == getTheme() },
          onClick: () => {
            if (i >= 0 && i != getTheme()) {
              if (window.confirm(t("messages.confirmTheme"))) {
                setPreferenceTheme(i)
                const url = new URL(window.location.href)
                url.searchParams.delete("theme")
                url.searchParams.set("cache", new Date().getTime().toString())
                window.location.href = url.toString()
              }
            }
          }
        }
      })]}
    />

    <button className="push-button" id="tour-clearcookies"
      title={t("config.resetSettings")}
      onClick={() => { 
        if (window.confirm(t("messages.confirmReset"))) {
          resetPreferences() 
          props.updateDisplay() 
        }
      }}>
      <FontAwesomeIcon icon={faSync} />
    </button>

    <RunTour />

  </div>
}

export default ConfigButtons
