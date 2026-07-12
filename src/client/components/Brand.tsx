import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function Brand({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span className={cn('font-heading text-xl font-bold tracking-[0.04em] uppercase', className)} {...props}>
      Print<span className="text-primary">Hub</span>
    </span>
  )
}

export function AuthBrand() {
  return (
    <div className="text-center">
      <Brand className="text-3xl" />
      <div className="mt-3 flex justify-center gap-2.5" aria-hidden="true">
        <span className="size-2 rounded-full bg-muted-foreground" />
        <span className="size-2 rounded-full bg-primary" />
        <span className="size-2 rounded-full bg-[var(--chart-2)]" />
      </div>
    </div>
  )
}
