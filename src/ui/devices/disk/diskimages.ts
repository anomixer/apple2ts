// Get the base URL for the application
const getImageUrl = (path: string) => {
  const base = import.meta.env.BASE_URL || '/'
  return new URL(base + path, window.location.origin)
}

const getDiskUrl = (filename: string) => {
  const base = import.meta.env.BASE_URL || '/'
  return base + 'disks/' + filename
}

export const diskImages: DiskCollectionItem[] = [
  {
    title: "Aztec",
    diskUrl: getDiskUrl("Aztec.po"),
    imageUrl: getImageUrl("disks/Aztec.png"),
    type: undefined,
    lastUpdated: new Date(0),
  },
  {
    title: "Eamon",
    diskUrl: getDiskUrl("Eamon%201.po"),
    imageUrl: getImageUrl("disks/Eamon%201.png"),
    detailsUrl: new URL("https://eamon.wiki/Source:Eamon_Player%27s_Manual_(revised)"),
    type: undefined,
    lastUpdated: new Date(0),
  },
  {
    title: "Apple IIe Diagnostic",
    diskUrl: getDiskUrl("Apple IIe Diagnostic 2.1.po"),
    imageUrl: getImageUrl("disks/Apple IIe Diagnostic 2.1.png"),
    type: undefined,
    lastUpdated: new Date(0),
  },
  {
    title: "MECC Inspector",
    diskUrl: getDiskUrl("MECC-Inspector.woz"),
    imageUrl: getImageUrl("disks/MECC-Inspector.png"),
    type: undefined,
    lastUpdated: new Date(0),
  },
  {
    title: "MousePaint",
    diskUrl: getDiskUrl("MousePaint.woz"),
    imageUrl: getImageUrl("disks/MousePaint.png"),
    type: undefined,
    lastUpdated: new Date(0),
    params: "color=white",
  },
  {
    title: "Nox Archaist Demo",
    diskUrl: getDiskUrl("Nox%20Archaist%20Demo.hdv"),
    imageUrl: getImageUrl("disks/Nox%20Archaist%20Demo.png"),
    detailsUrl: new URL("https://noxarchaist.com"),
    type: undefined,
    lastUpdated: new Date(0),
  },
  {
    title: "Olympic Decathalon",
    diskUrl: getDiskUrl("Olympic%20Decathlon.woz"),
    imageUrl: getImageUrl("disks/Olympic%20Decathlon.png"),
    detailsUrl: new URL("https://archive.org/details/microsoft-olympic-decathlon-a2-ph/"),
    type: undefined,
    lastUpdated: new Date(0),
  },
  {
    title: "Print Shop Color",
    diskUrl: getDiskUrl("Print%20Shop%20Color.po"),
    imageUrl: getImageUrl("disks/Print%20Shop%20Color.png"),
    type: undefined,
    lastUpdated: new Date(0),
  },
  {
    title: "ProDOS 2.4.3",
    diskUrl: getDiskUrl("ProDOS%202.4.3.po"),
    imageUrl: getImageUrl("disks/ProDOS%202.4.3.png"),
    detailsUrl: new URL("https://prodos8.com/"),
    type: undefined,
    lastUpdated: new Date(0),
  },
  {
    title: "Robotron",
    diskUrl: getDiskUrl("Robotron4Joy.po"),
    imageUrl: getImageUrl("disks/Robotron4Joy.png"),
    detailsUrl: new URL("https://groups.google.com/g/comp.sys.apple2/c/2xlihijn82o/"),
    type: undefined,
    lastUpdated: new Date(0),
  },
  {
    title: "Total Replay",
    diskUrl: getDiskUrl("Total%20Replay.hdv"),
    imageUrl: getImageUrl("disks/Total%20Replay.png"),
    detailsUrl: new URL("https://archive.org/details/TotalReplay"),
    type: undefined,
    lastUpdated: new Date(0),
  },
  {
    title: "Instant Replay",
    diskUrl: getDiskUrl("Instant%20Replay.hdv"),
    imageUrl: getImageUrl("disks/Instant%20Replay.png"),
    detailsUrl: new URL("https://github.com/a2-4am/4sports"),
    type: undefined,
    lastUpdated: new Date(0),
  },
  {
    title: "Pitch Dark",
    diskUrl: getDiskUrl("Pitch%20Dark.hdv"),
    imageUrl: getImageUrl("disks/Pitch%20Dark.png"),
    detailsUrl: new URL("https://archive.org/details/PitchDark"),
    type: undefined,
    lastUpdated: new Date(0),
  },
  {
    title: "Ultima IV",
    diskUrl: getDiskUrl("Ultima%20IV.hdv"),
    imageUrl: getImageUrl("disks/Ultima%20IV.png"),
    detailsUrl: new URL("https://wiki.ultimacodex.com/wiki/Ultima_IV:_Quest_of_the_Avatar"),
    type: undefined,
    lastUpdated: new Date(0),
  },
  {
    title: "Ultima V",
    diskUrl: getDiskUrl("Ultima%20V.hdv"),
    imageUrl: getImageUrl("disks/Ultima%20V.png"),
    detailsUrl: new URL("https://wiki.ultimacodex.com/wiki/Ultima_V:_Warriors_of_Destiny"),
    type: undefined,
    lastUpdated: new Date(0),
  },
  {
    title: "Wizardy Replay v1.1",
    diskUrl: getDiskUrl("Wizard%20Replay%20v1.1.hdv"),
    imageUrl: getImageUrl("disks/Wizard%20Replay%20v1.1.png"),
    detailsUrl: new URL("https://archive.org/details/WizardReplay"),
    type: undefined,
    lastUpdated: new Date(0),
    }
    ]