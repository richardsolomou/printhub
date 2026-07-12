import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { CircleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { runRecoveryBackup, updateRecoverySettings } from '../../../server/fns'
import { diagnosticsQuery } from '../../queries'
import { SettingsActions, SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'

export function RecoveryPane() {
  const { data, error } = useQuery(diagnosticsQuery())
  const [form, setForm] = useState(data?.recovery.config)
  const queryClient = useQueryClient()
  const callUpdate = useServerFn(updateRecoverySettings)
  const callBackup = useServerFn(runRecoveryBackup)
  useEffect(() => setForm(data?.recovery.config), [data?.recovery.config])
  const save = useMutation({
    mutationFn: callUpdate,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['diagnostics'] })
      toast.success('Recovery settings saved.')
    },
  })
  const backup = useMutation({
    mutationFn: callBackup,
    onSuccess: async ({ directory }) => {
      await queryClient.invalidateQueries({ queryKey: ['diagnostics'] })
      toast.success(`Verified backup created at ${directory}.`)
    },
  })
  if (error)
    return (
      <Alert variant="destructive">
        <CircleAlert />
        <AlertDescription>{error.message}</AlertDescription>
      </Alert>
    )
  if (!data || !form) return <SettingsHeader title="Recovery" description="Loading recovery settings…" />
  const status = data.recovery

  return (
    <SettingsPage>
      <SettingsHeader
        title="Recovery"
        description="Create versioned, verified backup bundles containing SQLite, the integration key, and every print asset referenced by the database."
      />
      {!status.backupDestinationSeparateDevice && form.enabled && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>The enabled backup destination must be a different mounted filesystem from `/data`.</AlertDescription>
        </Alert>
      )}
      {status.lastBackupError && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>{status.lastBackupError}</AlertDescription>
        </Alert>
      )}
      <SettingsSection>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="recovery-enabled">Scheduled backups</FieldLabel>
            <FieldDescription>Run verified backups automatically using the interval and retention settings below.</FieldDescription>
          </FieldContent>
          <Switch id="recovery-enabled" checked={form.enabled} onCheckedChange={(enabled) => setForm({ ...form, enabled })} />
        </Field>
        <Field>
          <FieldLabel htmlFor="recovery-directory">Backup destination</FieldLabel>
          <Input id="recovery-directory" value={form.directory} onChange={(event) => setForm({ ...form, directory: event.target.value })} />
          <FieldDescription>
            Mount separate storage into the container, for example `/backups`. Scheduling cannot use the `/data` filesystem.
          </FieldDescription>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField
            label="Backup interval (hours)"
            value={form.intervalHours}
            min={1}
            onChange={(intervalHours) => setForm({ ...form, intervalHours })}
          />
          <NumberField
            label="Backups retained"
            value={form.retentionCount}
            min={1}
            onChange={(retentionCount) => setForm({ ...form, retentionCount })}
          />
          <NumberField
            label="Integrity interval (hours)"
            value={form.integrityIntervalHours}
            min={1}
            onChange={(integrityIntervalHours) => setForm({ ...form, integrityIntervalHours })}
          />
          <NumberField
            label="Data reserve (GB)"
            value={bytesToGigabytes(form.minimumFreeBytes)}
            min={0.25}
            step={0.25}
            onChange={(gigabytes) => setForm({ ...form, minimumFreeBytes: Math.round(gigabytes * 1024 ** 3) })}
          />
        </div>
        <FieldError>{save.error?.message || backup.error?.message}</FieldError>
      </SettingsSection>
      <SettingsSection>
        <dl className="grid grid-cols-[minmax(10rem,auto)_1fr] gap-x-4 gap-y-2.5 max-sm:grid-cols-1 [&_dt]:text-muted-foreground [&_dd]:m-0">
          <dt>Last backup</dt>
          <dd>{status.lastBackupAt ? new Date(status.lastBackupAt).toLocaleString() : 'never'}</dd>
          <dt>Last verified bundle</dt>
          <dd className="break-all">{status.lastBackupPath ?? 'none'}</dd>
          <dt>Last full integrity check</dt>
          <dd>{status.lastIntegrityAt ? `${status.lastIntegrity} · ${new Date(status.lastIntegrityAt).toLocaleString()}` : 'pending'}</dd>
          <dt>Backup disk free</dt>
          <dd>{status.backupDestinationFreeBytes === undefined ? 'unavailable' : formatBytes(status.backupDestinationFreeBytes)}</dd>
          <dt>Separate filesystem</dt>
          <dd>
            {status.backupDestinationSeparateDevice === undefined ? 'unknown' : status.backupDestinationSeparateDevice ? 'yes' : 'no'}
          </dd>
          <dt>Encryption</dt>
          <dd>{status.encryptionConfigured ? 'AES-256-GCM enabled' : 'not configured'}</dd>
        </dl>
      </SettingsSection>
      <SettingsActions>
        <Button disabled={save.isPending} onClick={() => save.mutate({ data: form })}>
          {save.isPending && <Spinner />} Save recovery settings
        </Button>
        <Button variant="outline" disabled={backup.isPending || status.running} onClick={() => backup.mutate({})}>
          {(backup.isPending || status.running) && <Spinner />} Create verified backup now
        </Button>
      </SettingsActions>
    </SettingsPage>
  )
}

function NumberField({
  label,
  value,
  min,
  step = 1,
  onChange,
}: {
  label: string
  value: number
  min: number
  step?: number
  onChange: (value: number) => void
}) {
  const id = `recovery-${label.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} type="number" min={min} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </Field>
  )
}

function bytesToGigabytes(bytes: number) {
  return Number((bytes / 1024 ** 3).toFixed(2))
}

function formatBytes(bytes: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`
}
