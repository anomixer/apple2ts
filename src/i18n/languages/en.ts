export const en = {
  // 主要控制項
  controls: {
    boot: "Boot",
    reset: "Reset",
    copyScreen: "Copy Screen",
    pasteText: "Paste Text",
    saveState: "Save State",
    restoreState: "Restore State",
    toggleSound: "Toggle Sound",
    settings: "Settings",
    debugPanel: "Debug Panel"
  },
  
  // 配置選項
  config: {
    speed: "Speed",
    display: "Display Settings",
    theme: "Theme",
    resetSettings: "Reset All Settings",
    capsLock: "Caps Lock",
    useOpenApple: "Use as Open Apple key",
    useShortcuts: "Use for keyboard shortcuts",
    useArrowKeys: "Use Arrow Keys as Joystick",
    scanlines: "CRT Scanlines"
  },
  
  // 速度選項
  speed: {
    snail: "Snail Speed (0.1 MHz)",
    slow: "Slow Speed (0.5 MHz)",
    normal: "Normal Speed (1 MHz)",
    two: "2 MHz",
    three: "3 MHz",
    fast: "Fast Speed (4 MHz)",
    warp: "Ludicrous/Warp Speed"
  },
  
  // 顏色模式
  colors: {
    color: "Color",
    green: "Green",
    amber: "Amber",
    white: "White",
    nofringe: "No Fringe",
    inverse: "Inverse"
  },
  
  // 主題
  themes: {
    classic: "Classic",
    dark: "Dark",
    minimal: "Minimal"
  },
  
  // 除錯面板
  debug: {
    helpPanel: "Show help panel",
    debugPanel: "Show debugging panel",
    expectinPanel: "Show Apple exPectin panel",
    breakpoints: "Breakpoints",
    disassembly: "Disassembly",
    memory: "Memory",
    stack: "Stack",
    state: "CPU State",
    registers: "Registers",
    flags: "Flags",
    step: "Step",
    stepOver: "Step Over",
    stepOut: "Step Out",
    continue: "Continue",
    pause: "Pause"
  },
  
  // Tour 導覽
  tour: {
    welcome: "Welcome to the Apple2TS emulator!",
    clickNext: "To learn more, press the Next button.",
    bootButton: "Click here to start the emulator.",
    resetButton: "Click here to Reset the Apple II and either reboot or enter BASIC.",
    diskImages: "Choose one of the installed disk images.",
    floppyDisks: "Or click one of the floppy disk icons to load a disk image.",
    saveRestore: "You can save and restore the complete state of the emulator using these buttons.",
    themeButton: "Click here to change the emulator UI theme.",
    endTour: "You have reached the end of the tour. Click on the globe tour button to try one of the other tours, or press Finish to start using the emulator."
  },
  
  // 磁碟介面
  disk: {
    drive1: "Drive 1",
    drive2: "Drive 2",
    hardDisk: "Hard Disk",
    eject: "Eject Disk",
    insert: "Insert Disk",
    writeProtected: "Write Protected",
    readWrite: "Read/Write",
    empty: "Empty",
    loading: "Loading...",
    selectDisk: "Select Disk Image",
    browse: "Browse",
    internetArchive: "Internet Archive",
    totalReplay: "Total Replay",
    newReleases: "New Releases"
  },
  
  // 幫助文字
  help: {
    title: "Welcome to Apple2TS",
    subtitle: "TypeScript Apple IIe Emulator",
    startTour: "Click on the Start Tour",
    startTourAction: "button to begin a guided tour of the emulator.",
    keyboardShortcuts: "Keyboard Shortcuts",
    diskImages: "Disk images:",
    urlParameters: "Optional URL Parameters",
    examples: "Examples",
    mobileInstructions: "Mobile platforms:",
    tapScreen: "Tap the screen to show the keyboard.",
    arrowKeys: "Press the arrow keys, esc, or tab buttons to send those keys to the emulator.",
    ctrlKey: "To send a control character, press the ctrl button once. Then tap the screen to show the keyboard and press the desired key. The ctrl button will automatically be released.",
    ctrlLock: "To send multiple control characters, press the ctrl button twice to lock it on (indicated by a green dot). Then tap the screen to show the keyboard and press the desired keys. Press the ctrl button again to release it.",
    appleKeys: "The open apple and closed apple keys behave the same as the ctrl key."
  },
  
  // 錯誤和狀態訊息
  messages: {
    loading: "Loading...",
    error: "Error",
    success: "Success",
    confirm: "Confirm",
    cancel: "Cancel",
    ok: "OK",
    on: "on",
    off: "off",
    confirmTheme: "Reload the emulator and apply this theme now?",
    confirmReset: "Reset all settings to default values?",
    fileNotFound: "File not found",
    invalidFile: "Invalid file format",
    diskInserted: "Disk inserted",
    diskEjected: "Disk ejected"
  },
  
  // 鍵盤
  keyboard: {
    capsLock: "Caps Lock",
    shift: "Shift",
    ctrl: "Ctrl",
    alt: "Alt",
    openApple: "Open Apple",
    closedApple: "Closed Apple",
    escape: "Escape",
    tab: "Tab",
    enter: "Enter",
    space: "Space",
    backspace: "Backspace",
    delete: "Delete"
  },
  
  // 音效
  audio: {
    speaker: "Speaker",
    mockingboard: "Mockingboard",
    midi: "MIDI",
    volume: "Volume",
    mute: "Mute",
    waveform: "Waveform"
  },
  
  // 列印
  print: {
    printer: "Printer",
    imageWriter: "ImageWriter",
    print: "Print",
    clear: "Clear",
    save: "Save Output"
  }
}
