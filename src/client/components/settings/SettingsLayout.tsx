import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function SettingsPage({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="settings-page" className={cn('flex min-w-0 flex-col gap-6', className)} {...props} />
}

export function SettingsHeader({ title, description, children }: { title: string; description?: ReactNode; children?: ReactNode }) {
  return (
    <header data-slot="settings-header" className="flex flex-col gap-2 border-b pb-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-heading text-xl font-semibold tracking-tight text-foreground">{title}</h2>
        {children}
      </div>
      {description && <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{description}</p>}
    </header>
  )
}

export function SettingsSection({
  title,
  description,
  className,
  children,
  ...props
}: ComponentProps<'section'> & { title?: string; description?: ReactNode }) {
  return (
    <section data-slot="settings-section" className={cn('flex flex-col gap-4 rounded-xl border bg-card/40 p-5', className)} {...props}>
      {(title || description) && (
        <header className="flex flex-col gap-1">
          {title && <h3 className="font-heading text-sm font-semibold tracking-wide uppercase">{title}</h3>}
          {description && <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>}
        </header>
      )}
      {children}
    </section>
  )
}

export function SettingsActions({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="settings-actions" className={cn('flex flex-wrap items-center gap-2', className)} {...props} />
}
