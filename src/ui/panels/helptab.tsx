import React, { useEffect, useState } from "react"
import "./helppanel.css"
import { getDefaultHelpText } from "./defaulthelptext"
import { UI_THEME } from "../../common/utility"
import { getTheme } from "../ui_settings"
import { useTranslation } from "../../i18n/useTranslation"

type HelpPanelProps = {
  helptext: string,
}

const HelpTab = React.memo((props: HelpPanelProps) => {
  const { language } = useTranslation()
  const [helpText, setHelpText] = useState("")

  useEffect(() => {
    // 當語言變更時更新幫助文字
    const defaultText = getDefaultHelpText()
    const currentText = (props.helptext.length > 1 && props.helptext !== "<Default>") ? props.helptext : defaultText
    setHelpText(currentText)
  }, [language, props.helptext])

  const paperheight = window.innerHeight ? window.innerHeight - 170 : (window.outerHeight - 170)
  const isDarkMode = getTheme() == UI_THEME.DARK
  const isMinimalTheme = getTheme() == UI_THEME.MINIMAL

  if (isMinimalTheme) {
    import("./helppanel.minimal.css")
  }

  const isTouchDevice = "ontouchstart" in document.documentElement
  const height = window.innerHeight ? window.innerHeight : (window.outerHeight - 120)
  const width = window.innerWidth ? window.innerWidth : (window.outerWidth - 20)
  const narrow = isTouchDevice || (width < height)

  return (
    <div className="help-parent"
      style={{
        width: narrow || isMinimalTheme ? "687px" : 500, 
        height: narrow || isMinimalTheme ? "" : paperheight,
        overflow: (narrow ? "visible" : "auto")
      }}>
      <div className={isDarkMode ? "" : "help-paper"}>
        <pre className={"help-text " + (isDarkMode ? "help-text-dark" : "help-text-light")}
          dangerouslySetInnerHTML={{ __html: helpText }}>
        </pre>
      </div>
    </div>
  )
}, (prevProps, nextProps) => {
  return prevProps.helptext === nextProps.helptext
})

HelpTab.displayName = "HelpPanel"

export default HelpTab
