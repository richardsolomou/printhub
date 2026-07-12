import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { DialogShell } from './DialogShell'

export function MoveDialog({
  requestName,
  toLabel,
  max,
  onConfirm,
  onCancel,
}: {
  requestName: string
  toLabel: string
  max: number
  onConfirm: (count: number) => void
  onCancel: () => void
}) {
  const [count, setCount] = useState(String(max))

  return (
    <DialogShell onClose={onCancel} title="Move copies" className="sm:max-w-[360px]">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onConfirm(Math.min(max, Math.max(1, Math.round(Number(count) || 1))))
        }}
      >
        <p className="mb-3 text-sm text-muted-foreground">
          How many copies of “{requestName}” to {toLabel}?
        </p>
        <Field>
          <FieldLabel htmlFor="move-count">Copies (of {max})</FieldLabel>
          <Input
            id="move-count"
            type="number"
            inputMode="numeric"
            min={1}
            max={max}
            value={count}
            onChange={(e) => setCount(e.target.value)}
          />
        </Field>
        <div className="mt-2 flex justify-end gap-2.5">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit">Move</Button>
        </div>
      </form>
    </DialogShell>
  )
}
