import { Plus, Search, Settings2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  filterPrinterPresets,
  type PrinterPreset,
  type PrinterPresetIllustration as PrinterPresetIllustrationType,
} from '../../../core/printerPresets'

export function PrinterPresetPicker({
  disabled,
  onSelect,
  onCustom,
}: {
  disabled?: boolean
  onSelect: (preset: PrinterPreset) => void
  onCustom: () => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const groups = useMemo(() => groupPresets(filterPrinterPresets(search)), [search])
  const choose = (action: () => void) => {
    action()
    setOpen(false)
    setSearch('')
  }

  return (
    <>
      <Button type="button" variant="outline" className="justify-self-start" onClick={() => setOpen(true)} disabled={disabled}>
        <Plus /> Add printer
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setSearch('')
        }}
      >
        <DialogContent className="max-h-[min(44rem,calc(100dvh-2rem))] grid-rows-[auto_auto_minmax(0,1fr)] sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Choose a printer</DialogTitle>
            <DialogDescription>Select a predefined model or start with an editable custom profile.</DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search printers"
              placeholder="Search by brand, model, or print type"
              value={search}
              className="pl-9"
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="min-h-0 overflow-y-auto pr-1">
            {!search.trim() && (
              <button
                type="button"
                className="mb-4 flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                onClick={() => choose(onCustom)}
              >
                <span className="flex size-14 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <Settings2 className="size-6" />
                </span>
                <span>
                  <span className="block font-medium">Custom printer</span>
                  <span className="block text-sm text-muted-foreground">Enter the print type and usable build volume manually.</span>
                </span>
              </button>
            )}
            {groups.length ? (
              <div className="grid gap-5">
                {groups.map(([brand, presets]) => (
                  <section key={brand} aria-labelledby={`printer-brand-${brand.replaceAll(' ', '-').toLowerCase()}`}>
                    <h3
                      id={`printer-brand-${brand.replaceAll(' ', '-').toLowerCase()}`}
                      className="mb-2 text-xs font-medium text-muted-foreground"
                    >
                      {brand}
                    </h3>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {presets.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          className="flex min-w-0 items-center gap-3 rounded-lg border p-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                          aria-label={`Add ${preset.brand} ${preset.model}`}
                          onClick={() => choose(() => onSelect(preset))}
                        >
                          <PrinterPresetIllustration illustration={preset.illustration} />
                          <span className="min-w-0">
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="truncate font-medium">{preset.model}</span>
                              <Badge variant="outline" className="shrink-0 text-[0.65rem]">
                                {preset.printType === 'resin' ? 'Resin' : 'Filament'}
                              </Badge>
                            </span>
                            <span className="mt-1 block text-xs text-muted-foreground">
                              {formatDimension(preset.widthMm)} × {formatDimension(preset.depthMm)} × {formatDimension(preset.heightMm)} mm
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground">No predefined printers match “{search.trim()}”.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function groupPresets(presets: readonly PrinterPreset[]) {
  const groups = new Map<string, PrinterPreset[]>()
  for (const preset of presets) groups.set(preset.brand, [...(groups.get(preset.brand) ?? []), preset])
  return [...groups.entries()]
}

function formatDimension(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)))
}

function PrinterPresetIllustration({ illustration }: { illustration: PrinterPresetIllustrationType }) {
  const resin = illustration.startsWith('resin')
  const enclosed = illustration === 'filament-enclosed'
  const large = illustration === 'resin-large'
  return (
    <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted" aria-hidden="true">
      <svg viewBox="0 0 64 64" className="size-12 text-foreground/75" fill="none" stroke="currentColor" strokeWidth="2">
        {resin ? (
          <>
            <path d={large ? 'M14 47h36l-3-30H17l-3 30Z' : 'M17 47h30l-3-30H20l-3 30Z'} fill="currentColor" fillOpacity="0.08" />
            <path d="M20 25h24M22 32h20M15 47h34v5H15z" />
            <path d="M27 12h10l2 5H25l2-5Z" fill="currentColor" fillOpacity="0.16" />
          </>
        ) : enclosed ? (
          <>
            <rect x="14" y="8" width="36" height="48" rx="3" fill="currentColor" fillOpacity="0.08" />
            <path d="M20 15h24v33H20zM24 42h16M32 20v17M28 37h8" />
          </>
        ) : (
          <>
            <path d="M14 53h36M18 50V14h28v36M18 19h28M32 19v22M27 41h10M22 49h20" />
            <path d="M25 44h14l3 5H22l3-5Z" fill="currentColor" fillOpacity="0.12" />
          </>
        )}
      </svg>
    </span>
  )
}
