import catalog from '../../printer-catalog/catalog.generated.json'

export type PrinterPreset = {
  id: string
  brand: string
  model: string
  printType: 'resin' | 'filament'
  widthMm: number
  depthMm: number
  heightMm: number
  filamentDiameterMm?: number
  image?: { src: string; sourceId: string; sourceUrl: string }
  source: { id: string; url: string }
}

export const PRINTER_PRESETS = catalog.presets as PrinterPreset[]

export function filterPrinterPresets(search: string) {
  const query = search.trim().toLocaleLowerCase()
  if (!query) return PRINTER_PRESETS
  return PRINTER_PRESETS.filter((preset) =>
    [preset.brand, preset.model, preset.printType].some((value) => value.toLocaleLowerCase().includes(query)),
  )
}
