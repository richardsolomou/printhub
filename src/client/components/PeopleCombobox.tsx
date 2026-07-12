import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'

export function PeopleCombobox({
  id,
  value,
  onChange,
  options,
  placeholder = 'Select a person',
  emptyLabel = 'No people found.',
}: {
  id?: string
  value?: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  placeholder?: string
  emptyLabel?: string
}) {
  return (
    <Combobox value={value ?? null} onValueChange={(next) => next && onChange(next)} items={options}>
      <ComboboxInput id={id} className="w-full" placeholder={placeholder} showClear={false} />
      <ComboboxContent>
        <ComboboxEmpty>{emptyLabel}</ComboboxEmpty>
        <ComboboxList>
          <ComboboxCollection>
            {(option: { value: string; label: string }) => (
              <ComboboxItem key={option.value} value={option.value}>
                {option.label}
              </ComboboxItem>
            )}
          </ComboboxCollection>
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
