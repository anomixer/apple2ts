export const zhTW = {
  // 主要控制項
  controls: {
    boot: "啟動",
    reset: "重置",
    copyScreen: "複製螢幕",
    pasteText: "貼上文字",
    saveState: "儲存狀態",
    restoreState: "還原狀態",
    toggleSound: "切換音效",
    settings: "設定",
    debugPanel: "除錯面板"
  },
  
  // 配置選項
  config: {
    speed: "速度",
    display: "顯示設定",
    theme: "佈景主題",
    resetSettings: "重置所有設定",
    capsLock: "大寫鎖定",
    useOpenApple: "使用為 Open Apple 鍵",
    useShortcuts: "使用鍵盤快捷鍵",
    useArrowKeys: "使用方向鍵作為搖桿",
    scanlines: "CRT 掃描線"
  },
  
  // 速度選項
  speed: {
    snail: "蝸牛速度 (0.1 MHz)",
    slow: "慢速 (0.5 MHz)",
    normal: "正常速度 (1 MHz)",
    two: "2 MHz",
    three: "3 MHz",
    fast: "快速 (4 MHz)",
    warp: "極速/曲速"
  },
  
  // 顏色模式
  colors: {
    color: "彩色",
    green: "綠色",
    amber: "琥珀色",
    white: "白色",
    nofringe: "無邊緣",
    inverse: "反色"
  },
  
  // 主題
  themes: {
    classic: "經典",
    dark: "深色",
    minimal: "簡約"
  },
  
  // 除錯面板
  debug: {
    helpPanel: "顯示說明面板",
    debugPanel: "顯示除錯面板",
    expectinPanel: "顯示 Apple exPectin 面板",
    breakpoints: "中斷點",
    disassembly: "反組譯",
    memory: "記憶體",
    stack: "堆疊",
    state: "CPU 狀態",
    registers: "暫存器",
    flags: "旗標",
    step: "單步執行",
    stepOver: "跨越執行",
    stepOut: "跳出執行",
    continue: "繼續",
    pause: "暫停"
  },
  
  // Tour 導覽
  tour: {
    welcome: "歡迎使用 Apple2TS 模擬器！",
    clickNext: "若要瞭解更多，請按下一步按鈕。",
    bootButton: "按這裡啟動模擬器。",
    resetButton: "按這裡重置 Apple II，並重新開機或進入 BASIC。",
    diskImages: "選擇其中一個已安裝的磁碟映像檔。",
    floppyDisks: "或按一下軟碟圖示來載入磁碟映像檔。",
    saveRestore: "您可以使用這些按鈕儲存和還原模擬器的完整狀態。",
    themeButton: "按這裡變更模擬器 UI 佈景主題。",
    endTour: "您已到達導覽的結尾。按一下地球儀導覽按鈕來試試其他導覽，或按完成開始使用模擬器。"
  },
  
  // 磁碟介面
  disk: {
    drive1: "磁碟機 1",
    drive2: "磁碟機 2",
    hardDisk: "硬碟",
    eject: "退出磁碟",
    insert: "插入磁碟",
    writeProtected: "防寫保護",
    readWrite: "讀寫",
    empty: "空的",
    loading: "載入中...",
    selectDisk: "選擇磁碟映像檔",
    browse: "瀏覽",
    internetArchive: "網際網路檔案館",
    totalReplay: "Total Replay",
    newReleases: "新發行版"
  },
  
  // 幫助文字
  help: {
    title: "歡迎使用 Apple2TS",
    subtitle: "TypeScript Apple IIe 模擬器",
    startTour: "按一下開始導覽",
    startTourAction: "按鈕開始模擬器的引導式導覽。",
    keyboardShortcuts: "鍵盤快捷鍵",
    diskImages: "磁碟映像檔：",
    urlParameters: "選用的 URL 參數",
    examples: "範例",
    mobileInstructions: "行動平台：",
    tapScreen: "點擊螢幕以顯示鍵盤。",
    arrowKeys: "按方向鍵、ESC 或 Tab 按鈕將這些按鍵發送到模擬器。",
    ctrlKey: "要發送控制字元，請按一次 Ctrl 按鈕。然後點擊螢幕顯示鍵盤並按所需的按鍵。Ctrl 按鈕將自動釋放。",
    ctrlLock: "要發送多個控制字元，請按兩次 Ctrl 按鈕以鎖定（以綠點表示）。然後點擊螢幕顯示鍵盤並按所需的按鍵。再次按 Ctrl 按鈕以釋放。",
    appleKeys: "Open Apple 和 Closed Apple 鍵的行為與 Ctrl 鍵相同。"
  },
  
  // 錯誤和狀態訊息
  messages: {
    loading: "載入中...",
    error: "錯誤",
    success: "成功",
    confirm: "確認",
    cancel: "取消",
    ok: "確定",
    on: "開啟",
    off: "關閉",
    confirmTheme: "重新載入模擬器並立即套用此佈景主題嗎？",
    confirmReset: "將所有設定重置為預設值嗎？",
    fileNotFound: "找不到檔案",
    invalidFile: "無效的檔案格式",
    diskInserted: "已插入磁碟",
    diskEjected: "已退出磁碟"
  },
  
  // 鍵盤
  keyboard: {
    capsLock: "大寫鎖定",
    shift: "Shift",
    ctrl: "Ctrl",
    alt: "Alt",
    openApple: "Open Apple",
    closedApple: "Closed Apple",
    escape: "Escape",
    tab: "Tab",
    enter: "Enter",
    space: "空白鍵",
    backspace: "退格",
    delete: "刪除"
  },
  
  // 音效
  audio: {
    speaker: "喇叭",
    mockingboard: "Mockingboard",
    midi: "MIDI",
    volume: "音量",
    mute: "靜音",
    waveform: "波形"
  },
  
  // 列印
  print: {
    printer: "印表機",
    imageWriter: "ImageWriter",
    print: "列印",
    clear: "清除",
    save: "儲存輸出"
  }
}
