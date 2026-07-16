import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Layers3, LayoutDashboard, Settings, ShieldCheck } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Brand } from './Brand'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'

type AppView = 'board' | 'planner' | 'settings' | 'admin'

export function AppHeader({
  active,
  isAdmin,
  isDeploymentAdmin = false,
  showPlanner = true,
  navigationEnabled = true,
}: {
  active: AppView
  isAdmin: boolean
  isDeploymentAdmin?: boolean
  showPlanner?: boolean
  navigationEnabled?: boolean
}) {
  return (
    <header
      className="flex min-h-15 items-center gap-4 border-b bg-background px-5 py-3.5 max-sm:min-h-0 max-sm:flex-wrap max-sm:gap-x-3 max-sm:gap-y-2 max-sm:px-3 max-sm:py-2.5"
      data-hydrated={navigationEnabled}
    >
      {navigationEnabled ? (
        <Link to="/" className="text-inherit no-underline hover:opacity-85" aria-label="Go to board">
          <Brand />
        </Link>
      ) : (
        <span aria-label="Go to board">
          <Brand />
        </span>
      )}
      <nav
        className="flex items-center gap-1 rounded-lg bg-muted/60 p-1 max-sm:order-3 max-sm:w-full max-sm:overflow-x-auto max-sm:[scrollbar-width:none] max-sm:[&::-webkit-scrollbar]:hidden"
        aria-label="Main navigation"
      >
        <AppHeaderLink active={active === 'board'} enabled={navigationEnabled} to="/" label="Board" icon={<LayoutDashboard />} />
        {isAdmin && showPlanner && (
          <AppHeaderLink active={active === 'planner'} enabled={navigationEnabled} to="/planner" label="Planner" icon={<Layers3 />} />
        )}
        <AppHeaderLink
          active={active === 'settings'}
          enabled={navigationEnabled}
          to="/settings/$section"
          params={{ section: 'account' }}
          label="Settings"
          icon={<Settings />}
        />
        {isDeploymentAdmin && (
          <AppHeaderLink
            active={active === 'admin'}
            enabled={navigationEnabled}
            to="/admin/$section"
            params={{ section: 'integrations' }}
            label="Admin"
            icon={<ShieldCheck />}
          />
        )}
      </nav>
      <span className="flex-1" />
      <WorkspaceSwitcher />
    </header>
  )
}

function AppHeaderLink({
  active,
  enabled,
  to,
  params,
  label,
  icon,
}: {
  active: boolean
  enabled: boolean
  to: '/' | '/planner' | '/settings/$section' | '/admin/$section'
  params?: { section: 'account' | 'integrations' }
  label: string
  icon: ReactNode
}) {
  const className = cn(
    buttonVariants({ variant: active ? 'secondary' : 'ghost', size: 'sm' }),
    'h-8 gap-1.5 px-2.5',
    active && 'bg-background shadow-sm hover:bg-background',
    !enabled && 'pointer-events-none opacity-50',
  )
  if (to === '/settings/$section') {
    return (
      <Link to={to} params={{ section: params!.section }} className={className} aria-current={active ? 'page' : undefined}>
        {icon}
        {label}
      </Link>
    )
  }
  if (to === '/admin/$section') {
    return (
      <Link to={to} params={{ section: 'integrations' }} className={className} aria-current={active ? 'page' : undefined}>
        {icon}
        {label}
      </Link>
    )
  }
  return (
    <Link to={to} className={className} aria-current={active ? 'page' : undefined}>
      {icon}
      {label}
    </Link>
  )
}
