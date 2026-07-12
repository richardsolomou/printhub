import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { Link } from '@tanstack/react-router'
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { savePlatePlannerProfiles } from '../../../server/fns'
import { normalizePrinterProfile, type PrinterProfile } from '../../../core/platePlanner'
import { platePlannerQuery } from '../../queries'
import { SettingsActions, SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'

const DEFAULT_PROFILE: PrinterProfile = {
  id: 'resin-medium',
  name: 'Printer 1',
  widthMm: 129,
  depthMm: 80,
  heightMm: 150,
  spacingMm: 5,
  supportMarginMm: 4,
  adhesionMarginMm: 2,
  heightAllowanceMm: 5,
  maxHeightDifferenceMm: 20,
}

export function PrintersPane() {
  const { data } = useQuery(platePlannerQuery())
  const [profiles, setProfiles] = useState<PrinterProfile[]>([])
  const callSave = useServerFn(savePlatePlannerProfiles)
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: callSave,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['plate-planner'] })
      toast.success('Printer profiles saved.')
    },
  })

  useEffect(() => {
    if (data && !profiles.length) {
      setProfiles(data.profiles?.length ? data.profiles.map((profile) => normalizePrinterProfile(profile)) : [DEFAULT_PROFILE])
    }
  }, [data, profiles.length])

  if (!data) return <SettingsHeader title="Printers" description="Loading printer profiles…" />

  const update = (index: number, patch: Partial<PrinterProfile>) => {
    setProfiles((current) => current.map((profile, profileIndex) => (profileIndex === index ? { ...profile, ...patch } : profile)))
  }

  return (
    <SettingsPage>
      <SettingsHeader title="Printers" description="Configure the machines and build volumes available to the plate planner.">
        <Link to="/planner" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'ml-auto')}>
          Open planner
        </Link>
      </SettingsHeader>
      {profiles.map((profile, index) => (
        <SettingsSection key={profile.id} title={profile.name || `Printer ${index + 1}`}>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Name" value={profile.name} onChange={(name) => update(index, { name })} />
            <NumberField label="Width (mm)" value={profile.widthMm} onChange={(widthMm) => update(index, { widthMm })} />
            <NumberField label="Depth (mm)" value={profile.depthMm} onChange={(depthMm) => update(index, { depthMm })} />
            <NumberField label="Height (mm)" value={profile.heightMm} onChange={(heightMm) => update(index, { heightMm })} />
            <NumberField label="Spacing (mm)" value={profile.spacingMm} onChange={(spacingMm) => update(index, { spacingMm })} />
            <NumberField
              label="Support margin (mm)"
              value={profile.supportMarginMm}
              onChange={(supportMarginMm) => update(index, { supportMarginMm })}
            />
            <NumberField
              label="Adhesion margin (mm)"
              value={profile.adhesionMarginMm}
              onChange={(adhesionMarginMm) => update(index, { adhesionMarginMm })}
            />
            <NumberField
              label="Height allowance (mm)"
              value={profile.heightAllowanceMm}
              onChange={(heightAllowanceMm) => update(index, { heightAllowanceMm })}
            />
            <NumberField
              label="Maximum height difference (mm)"
              value={profile.maxHeightDifferenceMm}
              onChange={(maxHeightDifferenceMm) => update(index, { maxHeightDifferenceMm })}
            />
          </div>
          {profiles.length > 1 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setProfiles((current) => current.filter((_, profileIndex) => profileIndex !== index))}
            >
              <Trash2 /> Remove printer
            </Button>
          )}
        </SettingsSection>
      ))}
      <SettingsActions>
        <Button
          variant="outline"
          onClick={() =>
            setProfiles((current) => [...current, { ...DEFAULT_PROFILE, id: crypto.randomUUID(), name: `Printer ${current.length + 1}` }])
          }
        >
          <Plus /> Add printer
        </Button>
        <Button disabled={mutation.isPending || !profiles.length} onClick={() => mutation.mutate({ data: { profiles } })}>
          Save printers
        </Button>
      </SettingsActions>
    </SettingsPage>
  )
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const id = label.toLowerCase().replaceAll(' ', '-')
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  )
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const id = label.toLowerCase().replaceAll(' ', '-')
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="number" min="0.01" step="0.1" value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </div>
  )
}
