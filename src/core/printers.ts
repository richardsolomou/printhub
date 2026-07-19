import type { PrinterProfile } from './types'

export const PRINTERS_SETTING = 'printers'
export const LEGACY_PRINTERS_SETTING = 'plate-planner-profiles'

export function normalizePrinterProfile(profile: Partial<PrinterProfile> & Pick<PrinterProfile, 'id' | 'name'>): PrinterProfile {
  return {
    id: profile.id,
    name: profile.name,
    printType: profile.printType === 'filament' ? 'filament' : 'resin',
    enabled: profile.enabled !== false,
  }
}

export function storedPrinterProfiles(repository: { getSetting<T>(key: string): T | undefined }) {
  const stored =
    repository.getSetting<PrinterProfile[]>(PRINTERS_SETTING) ?? repository.getSetting<PrinterProfile[]>(LEGACY_PRINTERS_SETTING) ?? []
  return stored.map(normalizePrinterProfile)
}
