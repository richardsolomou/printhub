export type PrinterPresetIllustration = 'filament-open' | 'filament-enclosed' | 'resin-desktop' | 'resin-large'

export type PrinterPreset = {
  id: string
  brand: string
  model: string
  printType: 'resin' | 'filament'
  widthMm: number
  depthMm: number
  heightMm: number
  filamentDiameterMm?: number
  illustration: PrinterPresetIllustration
  sources: readonly { url: string; checkedAt: string }[]
}

export const PRINTER_PRESETS = [
  {
    id: 'anycubic-photon-mono-m7-pro',
    brand: 'Anycubic',
    model: 'Photon Mono M7 Pro',
    printType: 'resin',
    widthMm: 223,
    depthMm: 126,
    heightMm: 230,
    illustration: 'resin-desktop',
    sources: [{ url: 'https://store.anycubic.com/products/photon-mono-m7-pro', checkedAt: '2026-07-19' }],
  },
  {
    id: 'bambu-lab-a1-mini',
    brand: 'Bambu Lab',
    model: 'A1 mini',
    printType: 'filament',
    widthMm: 180,
    depthMm: 180,
    heightMm: 180,
    filamentDiameterMm: 1.75,
    illustration: 'filament-open',
    sources: [{ url: 'https://us.store.bambulab.com/products/a1-mini', checkedAt: '2026-07-19' }],
  },
  {
    id: 'bambu-lab-p1s',
    brand: 'Bambu Lab',
    model: 'P1S',
    printType: 'filament',
    widthMm: 256,
    depthMm: 256,
    heightMm: 256,
    filamentDiameterMm: 1.75,
    illustration: 'filament-enclosed',
    sources: [{ url: 'https://us.store.bambulab.com/products/p1s', checkedAt: '2026-07-19' }],
  },
  {
    id: 'creality-ender-3-v3-se',
    brand: 'Creality',
    model: 'Ender-3 V3 SE',
    printType: 'filament',
    widthMm: 220,
    depthMm: 220,
    heightMm: 250,
    filamentDiameterMm: 1.75,
    illustration: 'filament-open',
    sources: [{ url: 'https://store.creality.com/products/ender-3-v3-se-3d-printer', checkedAt: '2026-07-19' }],
  },
  {
    id: 'creality-halot-mage-pro',
    brand: 'Creality',
    model: 'HALOT-MAGE PRO',
    printType: 'resin',
    widthMm: 228,
    depthMm: 128,
    heightMm: 230,
    illustration: 'resin-desktop',
    sources: [{ url: 'https://www.creality.com/products/halot-mage-pro-3d-printer', checkedAt: '2026-07-19' }],
  },
  {
    id: 'elegoo-jupiter-se',
    brand: 'Elegoo',
    model: 'Jupiter SE',
    printType: 'resin',
    widthMm: 277.848,
    depthMm: 156.264,
    heightMm: 300,
    illustration: 'resin-large',
    sources: [{ url: 'https://www.elegoo.com/products/jupiter-se', checkedAt: '2026-07-19' }],
  },
  {
    id: 'elegoo-mars-5-ultra',
    brand: 'Elegoo',
    model: 'Mars 5 Ultra',
    printType: 'resin',
    widthMm: 153.36,
    depthMm: 77.76,
    heightMm: 165,
    illustration: 'resin-desktop',
    sources: [{ url: 'https://www.elegoo.com/products/mars-5-ultra-9k-7inch-monochrome-lcd-resin-3d-printer', checkedAt: '2026-07-19' }],
  },
  {
    id: 'elegoo-neptune-4-plus',
    brand: 'Elegoo',
    model: 'Neptune 4 Plus',
    printType: 'filament',
    widthMm: 320,
    depthMm: 320,
    heightMm: 385,
    filamentDiameterMm: 1.75,
    illustration: 'filament-open',
    sources: [{ url: 'https://www.elegoo.com/products/neptune-4-plus-fdm-3d-printer', checkedAt: '2026-07-19' }],
  },
  {
    id: 'elegoo-saturn-4-ultra',
    brand: 'Elegoo',
    model: 'Saturn 4 Ultra',
    printType: 'resin',
    widthMm: 218.88,
    depthMm: 122.88,
    heightMm: 220,
    illustration: 'resin-desktop',
    sources: [
      { url: 'https://www.elegoo.com/products/saturn-4-ultra-12k-10inch-monochrome-lcd-resin-3d-printer', checkedAt: '2026-07-19' },
    ],
  },
  {
    id: 'prusa-core-one',
    brand: 'Prusa',
    model: 'CORE One',
    printType: 'filament',
    widthMm: 250,
    depthMm: 220,
    heightMm: 270,
    filamentDiameterMm: 1.75,
    illustration: 'filament-enclosed',
    sources: [{ url: 'https://www.prusa3d.com/product/prusa-core-one/', checkedAt: '2026-07-19' }],
  },
  {
    id: 'prusa-mk4s',
    brand: 'Prusa',
    model: 'Original Prusa MK4S',
    printType: 'filament',
    widthMm: 250,
    depthMm: 210,
    heightMm: 220,
    filamentDiameterMm: 1.75,
    illustration: 'filament-open',
    sources: [{ url: 'https://www.prusa3d.com/product/original-prusa-mk4s-3d-printer-5/', checkedAt: '2026-07-19' }],
  },
  {
    id: 'prusa-sl1s-speed',
    brand: 'Prusa',
    model: 'Original Prusa SL1S SPEED',
    printType: 'resin',
    widthMm: 127,
    depthMm: 80,
    heightMm: 150,
    illustration: 'resin-desktop',
    sources: [{ url: 'https://www.prusa3d.com/product/original-prusa-sl1s-speed-3d-printer/', checkedAt: '2026-07-19' }],
  },
] as const satisfies readonly PrinterPreset[]

export function filterPrinterPresets(search: string) {
  const query = search.trim().toLocaleLowerCase()
  if (!query) return PRINTER_PRESETS
  return PRINTER_PRESETS.filter((preset) =>
    [preset.brand, preset.model, preset.printType].some((value) => value.toLocaleLowerCase().includes(query)),
  )
}
