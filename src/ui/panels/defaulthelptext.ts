import { i18n } from "../../i18n"

const tourSVG = "<svg viewBox=\"0 0 512 512\" width=\"20\" height=\"20\" style=\"vertical-align: middle;\"><path d=\"M352 256c0 22.2-1.2 43.6-3.3 64l-185.3 0c-2.2-20.4-3.3-41.8-3.3-64s1.2-43.6 3.3-64l185.3 0c2.2 20.4 3.3 41.8 3.3 64zm28.8-64l123.1 0c5.3 20.5 8.1 41.9 8.1 64s-2.8 43.5-8.1 64l-123.1 0c2.1-20.6 3.2-42 3.2-64s-1.1-43.4-3.2-64zm112.6-32l-116.7 0c-10-63.9-29.8-117.4-55.3-151.6c78.3 20.7 142 77.5 171.9 151.6zm-149.1 0l-176.6 0c6.1-36.4 15.5-68.6 27-94.7c10.5-23.6 22.2-40.7 33.5-51.5C239.4 3.2 248.7 0 256 0s16.6 3.2 27.8 13.8c11.3 10.8 23 27.9 33.5 51.5c11.6 26 20.9 58.2 27 94.7zm-209 0L18.6 160C48.6 85.9 112.2 29.1 190.6 8.4C165.1 42.6 145.3 96.1 135.3 160zM8.1 192l123.1 0c-2.1 20.6-3.2 42-3.2 64s1.1 43.4 3.2 64L8.1 320C2.8 299.5 0 278.1 0 256s2.8-43.5 8.1-64zM194.7 446.6c-11.6-26-20.9-58.2-27-94.6l176.6 0c-6.1 36.4-15.5 68.6-27 94.6c-10.5 23.6-22.2 40.7-33.5 51.5C272.6 508.8 263.3 512 256 512s-16.6-3.2-27.8-13.8c-11.3-10.8-23-27.9-33.5-51.5zM135.3 352c10 63.9 29.8 117.4 55.3 151.6C112.2 482.9 48.6 426.1 18.6 352l116.7 0zm358.1 0c-30 74.1-93.6 130.9-171.9 151.6c25.5-34.2 45.2-87.7 55.3-151.6l116.7 0z\"/></svg>"

export const getDefaultHelpText = (): string => {
  const currentYear = new Date().getFullYear()
  const isMac = navigator.platform.startsWith("Mac")
  const keyMod = isMac ? "⌘" : "Alt+"
  const arrowMod = isMac ? "⌘" : "Ctrl+"
  const isTouchDevice = "ontouchstart" in document.documentElement
  const t = i18n.t.bind(i18n)
  
  let helpText = `${t("help.title")}
${t("help.subtitle")}
(c) ${currentYear} CT6502

${t("help.startTour")} <a href="/?tour=main">${tourSVG}</a> ${t("help.startTourAction")}
`

  if (isTouchDevice) {
    if (i18n.getLanguage() === 'zh-TW') {
      helpText += `\n行動平台：
點擊螢幕以顯示鍵盤。
按方向鍵、ESC 或 Tab 按鈕將這些按鍵發送到模擬器。
要發送控制字元，請按一次 Ctrl 按鈕。然後點擊螢幕顯示鍵盤並按所需的按鍵。Ctrl 按鈕將自動釋放。
要發送多個控制字元，請按兩次 Ctrl 按鈕以鎖定（以綠點表示）。然後點擊螢幕顯示鍵盤並按所需的按鍵。再次按 Ctrl 按鈕以釋放。
Open Apple 和 Closed Apple 鍵的行為與 Ctrl 鍵相同。`
    } else {
      helpText += `\n${t("help.mobileInstructions")}
${t("help.tapScreen")}
${t("help.arrowKeys")}
${t("help.ctrlKey")}
${t("help.ctrlLock")}
${t("help.appleKeys")}`
    }
  } else {
    if (i18n.getLanguage() === 'zh-TW') {
      helpText += `\n<b>${t("help.keyboardShortcuts")}</b>
${keyMod}B 啟動              ${arrowMod}1 1 MHz (正常速度)
${keyMod}C 複製螢幕         ${arrowMod}2 2 MHz
${keyMod}O 開啟狀態         ${arrowMod}3 3 MHz
${keyMod}R 重置             ${arrowMod}4 4 MHz (快速)
${keyMod}S 儲存狀態         ${arrowMod}5 極速/曲速
${keyMod}V 貼上文字         ${arrowMod}0 慢速 (0.1 MHz)
${keyMod}← 倒轉時間
${keyMod}→ 前進時間

Open Apple：按左 Alt/Option
Closed Apple：按右 Alt/Option`
    } else {
      helpText += `\n<b>${t("help.keyboardShortcuts")}</b>
${keyMod}B Boot              ${arrowMod}1 1 MHz (Normal Speed)
${keyMod}C Copy Screen       ${arrowMod}2 2 MHz
${keyMod}O Open State        ${arrowMod}3 3 MHz
${keyMod}R Reset             ${arrowMod}4 4 MHz (Fast)
${keyMod}S Save State        ${arrowMod}5 Ludicrous/Warp Speed
${keyMod}V Paste Text        ${arrowMod}0 Snail Speed (0.1 MHz)
${keyMod}← Back in Time
${keyMod}→ Forward in Time

Open Apple:   press Left Alt/Option
Closed Apple: press Right Alt/Option`
    }
  }

  if (i18n.getLanguage() === 'zh-TW') {
    helpText += `

<b>${t("help.diskImages")}</b> hdv, 2mg, dsk, woz, po, do, bin, bas

<b>${t("help.urlParameters")}</b>
address=1234 (二進位檔案的十六進位載入位址)
capslock=off
color=color|nofringe|green|amber|white|inverse
debug=on
ramdisk=64|512|1024|4096|8192
run=false (不執行 BASIC 程式)
scanlines=on|off
sound=off
speed=snail|slow|normal|two|three|fast|warp
text=<a href="https://www.urlencoder.org" target="_blank" rel="noopener noreferrer">URL編碼</a> 字串或要貼上的 BASIC 程式
theme=classic|dark|minimal
tour=main|debug|settings
#磁碟映像檔的URL

<b>${t("help.examples")}</b>
<a href="https://apple2ts.com/?debug=on#Replay" target="_blank">Total Replay 含除錯功能</a>
<a href="https://apple2ts.com/?text=chop#Replay" target="_blank">Total Replay，載入 Choplifter</a>
<a href="https://apple2ts.com/?color=white&speed=fast#https://a2desktop.s3.amazonaws.com/A2DeskTop-1.4-en_800k.2mg" target="_blank">A2Desktop 2MG 快速白色模式</a>
<a href="https://apple2ts.com/?color=green&text=10%3F%22Welcome%20to%20Apple2TS%21%22%3AGOTO10" target="_blank">內嵌 Applesoft BASIC 程式</a>
<a href="https://apple2ts.com/?address=07FD#https://github.com/ct6502/apple2ts/raw/refs/heads/main/public/disks/snoggle_0x7FD.bin" target="_blank">含十六進位位址的二進位檔案</a>
`
  } else {
    helpText += `

<b>${t("help.diskImages")}</b> hdv, 2mg, dsk, woz, po, do, bin, bas

<b>${t("help.urlParameters")}</b>
address=1234 (hex load address for binary files)
capslock=off
color=color|nofringe|green|amber|white|inverse
debug=on
ramdisk=64|512|1024|4096|8192
run=false (do not run BASIC program)
scanlines=on|off
sound=off
speed=snail|slow|normal|two|three|fast|warp
text=<a href="https://www.urlencoder.org" target="_blank" rel="noopener noreferrer">urlencoded</a> string or BASIC program to paste
theme=classic|dark|minimal
tour=main|debug|settings
#urltodiskimage

<b>${t("help.examples")}</b>
<a href="https://apple2ts.com/?debug=on#Replay" target="_blank">Total Replay with debugging</a>
<a href="https://apple2ts.com/?text=chop#Replay" target="_blank">Total Replay, load Choplifter</a>
<a href="https://apple2ts.com/?color=white&speed=fast#https://a2desktop.s3.amazonaws.com/A2DeskTop-1.4-en_800k.2mg" target="_blank">A2Desktop 2MG with fast speed and white color</a>
<a href="https://apple2ts.com/?color=green&text=10%3F%22Welcome%20to%20Apple2TS%21%22%3AGOTO10" target="_blank">Embedded Applesoft BASIC Program</a>
<a href="https://apple2ts.com/?address=07FD#https://github.com/ct6502/apple2ts/raw/refs/heads/main/public/disks/snoggle_0x7FD.bin" target="_blank">Binary File with Hex Address</a>
`
  }

  return helpText
}

export let defaultHelpText = getDefaultHelpText()

// 監聽語言變更事件，更新幫助文字
window.addEventListener('languageChanged', () => {
  defaultHelpText = getDefaultHelpText()
})
