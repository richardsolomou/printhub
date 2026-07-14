import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { toast } from 'sonner'
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import { updateTelemetrySettings } from '../../../server/fns'
import { telemetryQuery } from '../../queries'
import { SettingsHeader, SettingsPage, SettingsSection } from './SettingsLayout'

export function TelemetryPane() {
  const { data: current } = useQuery(telemetryQuery())
  const callUpdate = useServerFn(updateTelemetrySettings)
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: callUpdate,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['telemetry'] })
      toast.success('Telemetry settings saved.')
    },
  })
  if (!current) return <SettingsHeader title="Telemetry" description="Loading telemetry settings…" />

  return (
    <SettingsPage>
      <SettingsHeader
        title="Telemetry"
        description="PrintHub does not send telemetry unless an admin explicitly enables it. Model geometry, request details, names, and email addresses are never included."
      />
      <SettingsSection>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="telemetry-enabled">Share anonymous usage data</FieldLabel>
            <FieldDescription>Optional and disabled by default for privacy-first installations.</FieldDescription>
          </FieldContent>
          <Switch
            id="telemetry-enabled"
            checked={current.enabled}
            disabled={mutation.isPending}
            onCheckedChange={(enabled) => mutation.mutate({ data: { enabled } })}
          />
        </Field>
        <FieldError>{mutation.error?.message || (mutation.error ? 'Could not save telemetry settings.' : null)}</FieldError>
      </SettingsSection>
    </SettingsPage>
  )
}
