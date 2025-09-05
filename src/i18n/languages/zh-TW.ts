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
    nofringe: "彩色 (無邊緣)",
    green: "綠色",
    amber: "琥珀色",
    white: "黑白",
    inverse: "黑白 (反色)"
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
    endTour: "您已到達導覽的結尾。按一下地球儀導覽按鈕來試試其他導覽，或按完成開始使用模擬器。",
    
    // Settings tour
    settingsWelcome: "Apple2TS 擁有一套完整的控制項，用於模擬器和 Apple II。若要瞭解更多，請按下一步按鈕。",
    mainControls: "在這裡，您可以啟動和重置 Apple II，還原和儲存狀態，複製螢幕，或貼上文字到模擬器。",
    snapshot: "在任何時候，您都可以擷取目前模擬器狀態的快照，然後回到早期狀態，或再次快進。您也可以將模擬器狀態與所有目前的快照一起儲存。",
    pauseButton: "您可以隨時暫停模擬器，凍結 6502 處理器。這對於暫停遊戲中的動作或進入除錯器很有用。",
    debugButton: "按一下除錯器圖示進入除錯模式，您可以查看 6502 處理器的內部狀態。再次按一下即可回到正常模式。",
    configButtons: "底部一排按鈕控制 Apple II 的狀態，從模擬器速度、螢幕顏色和靜音開始。",
    keyboardButtons: "如果開啟了大寫鎖定鍵，然後所有輸入的字元都是大寫的。",
    altArrowKeys: "下一個按鈕決定 {modKey} 鍵是用於鍵盤快捷鍵還是 Apple II Open Apple 鍵。最後一個按鈕決定是否可以使用方向鍵作為 Apple II 的搖桿。",
    clearCookies: "Apple2TS 會自動將目前的模擬器設定儲存為瀏覽器 cookie。按下此按鈕可重置這些設定並刪除 cookie。",
    
    // Debug tour
    debugWelcome: "Apple2TS 擁有一套豐富的工具來分析和除錯 6502 組合語言代碼。若要瞭解更多，請按下一步按鈕。",
    debugIcon: "按一下資訊頁籤上的除錯器圖示以查看除錯面板。",
    debugPause: "按下暫停按鈕以暫停或恢復模擬器的執行。",
    debugControls: "現在我們已經暫停了，我們可以使用「跳越執行」、「進入」和「跳出執行」按鈕逐步執行反組譯代碼。我們也可以快速跳轉到程式計數器 (PC) 的目前位址。",
    debugDisassembly: "在這裡我們可以看到反組譯代碼，包括十六進位位址、三個字母的指令，以及任何數值或位址。如果您將滑鼠移動到綠色數值上，將會出現一個工具提示，顯示目前的數值。按一下藍色位址將捲動到該位置。您也可以按一下左側的欄位來新增或移除中斷點。",
    debugInfo: "在中間我們有堆疊傾印和記憶體映射。記憶體映射會即時更新，並顯示目前使用中的記憶體組區。",
    debugMemory: "最後一部分顯示 Apple II 的記憶體。您可以使用下拉清單來檢查記憶體的不同部分。如果您切換到其中一個 HGR 頁面，您將得到放大的高解析度螢幕視圖，與記憶體位置連接。您也可以搜尋十六進位數值或 ASCII 字串，並將記憶體儲存到檔案中。",
    
    // Tour interface
    back: "上一步",
    close: "關閉",
    last: "完成",
    next: "下一步",
    skip: "關閉",
    guidedTour: "引導式導覽",
    mainTour: "引導式導覽：主要功能",
    settingsTour: "引導式導覽：設定",
    debugTour: "引導式導覽：除錯"
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
