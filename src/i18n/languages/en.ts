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
    endTour: "You have reached the end of the tour. Click on the globe tour button to try one of the other tours, or press Finish to start using the emulator.",
    
    // Settings tour
    settingsWelcome: "Apple2TS has a full set of controls for both the emulator and the Apple II. To learn more, press the Next button.",
    mainControls: "Here, you can boot and reset the Apple II, restore and save the state, copy the screen, or paste text into the emulator.",
    snapshot: "At any point, you can take a snapshot of the current emulator state, then go back in time to an earlier state, or fast forward again. You can also save the emulator state with all of the current snapshots.",
    pauseButton: "You can pause the emulator at any time, freezing the 6502 processor. This is useful for pausing the action in a game, or entering the debugger.",
    debugButton: "Click on the bug to enter debug mode, where you can see the internal state of the 6502 processor. Click again to go back to normal mode.",
    configButtons: "The bottom row of buttons controls the state of the Apple II, starting with the emulator speed, the screen color, and muting the sound.",
    keyboardButtons: "If the caps lock key is turned on, then all typed characters are UPPERCASE.",
    altArrowKeys: "The next key determines whether the {modKey} key is used for keyboard shortcuts or the Apple II Open Apple key. The final key determines whether the arrow keys can be used as the Apple II joystick.",
    clearCookies: "Apple2TS automatically saves the current emulator settings as browser cookies. Press this button to reset these settings and delete the cookies.",
    
    // Debug tour
    debugWelcome: "Apple2TS has a rich set of tools to analyze and debug 6502 assembly code. To learn more, press the Next button.",
    debugIcon: "Click on the Bug icon on the Info tabs to view the Debug panel.",
    debugPause: "Press the Pause button to pause or resume execution of the emulator.",
    debugControls: "Now that we have paused, we can step through the disassembled code using the Step Over, Into, and Out buttons. We can also quickly jump to the current address of the Program Counter (PC).",
    debugDisassembly: "Here we see the disassembled code, with the hex addresses, the three-letter instruction, and any values or addresses. If you move your mouse over a green value, a tooltip will appear with the current value. Clicking on a blue address will scroll to that location. You can also click in the left gutter to add or remove breakpoints.",
    debugInfo: "In the middle we have the Stack Dump and a Memory Map. The Memory Map updates in real time and shows you which memory banks are currently active.",
    debugMemory: "The last section displays the Apple II memory. You can use the droplist to examine different portions of memory. If you switch to one of the HGR pages, you will get a magnified view of the hires screen, tied to the memory locations. You can also search for hex values or ASCII strings, and save the memory to a file.",
    
    // Tour interface
    back: "Back",
    close: "Close",
    last: "Finish",
    next: "Next",
    skip: "Close",
    guidedTour: "Guided Tour",
    mainTour: "Guided Tour: Main",
    settingsTour: "Guided Tour: Settings",
    debugTour: "Guided Tour: Debug"
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
