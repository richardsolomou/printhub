import { describe, expect, it } from 'vitest'
import { filterPrinterPresets, PRINTER_PRESETS } from './printerPresets'

describe('printer presets', () => {
  it('keeps stable unique IDs', () => {
    expect(new Set(PRINTER_PRESETS.map((preset) => preset.id)).size).toBe(PRINTER_PRESETS.length)
  })

  it('provides positive build volumes and provenance', () => {
    expect(
      PRINTER_PRESETS.every(
        (preset) =>
          preset.widthMm > 0 &&
          preset.depthMm > 0 &&
          preset.heightMm > 0 &&
          preset.sources.length > 0 &&
          preset.sources.every((source) => source.url.startsWith('https://') && /^\d{4}-\d{2}-\d{2}$/.test(source.checkedAt)),
      ),
    ).toBe(true)
  })

  it('searches by brand, model, and print type', () => {
    expect(filterPrinterPresets('mars').map((preset) => preset.id)).toEqual(['elegoo-mars-5-ultra'])
    expect(filterPrinterPresets('bambu')).toHaveLength(2)
    expect(filterPrinterPresets('resin').every((preset) => preset.printType === 'resin')).toBe(true)
  })
})
