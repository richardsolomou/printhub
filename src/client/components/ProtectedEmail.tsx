import { useState } from 'react'
import { cn } from '@/lib/utils'

export function ProtectedEmail({ email, className }: { email: string; className?: string }) {
  const [revealed, setRevealed] = useState(false)

  return (
    <button
      type="button"
      className={cn('max-w-full cursor-pointer truncate text-left', className)}
      aria-label={revealed ? email : 'Reveal email address'}
      title={revealed ? undefined : 'Click to reveal email address'}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        setRevealed(true)
      }}
    >
      <span className={cn('transition-[filter]', !revealed && 'select-none blur-[5px]')} aria-hidden={!revealed}>
        {email}
      </span>
    </button>
  )
}
