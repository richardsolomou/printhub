import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { SettingsPanes, isSettingsSection } from '../client/components/SettingsPanes'
import { peopleQuery, requestsQuery, sessionQuery } from '../client/queries'
import { useEscape } from '../client/useEscape'
import { Brand } from '../client/components/Brand'

export const Route = createFileRoute('/settings/$section')({
  beforeLoad: ({ params }) => {
    if (!isSettingsSection(params.section)) throw redirect({ to: '/settings/$section', params: { section: 'account' } })
  },
  component: SettingsPage,
})

function SettingsPage() {
  const { data: session } = useSuspenseQuery(sessionQuery())
  const queryClient = useQueryClient()
  const [hydrated, setHydrated] = useState(false)
  const { section } = Route.useParams()
  const navigate = useNavigate()
  useEscape(() => navigate({ to: '/' }))
  const identity = session.identity
  const validSection = isSettingsSection(section) ? section : undefined
  const authorized = Boolean(identity && validSection)
  const allowedSection = identity?.role === 'admin' || validSection === 'account'
  useEffect(() => {
    setHydrated(true)
  }, [])
  useEffect(() => {
    if (!authorized) void navigate({ to: '/' })
  }, [authorized, navigate])
  useEffect(() => {
    if (authorized && !allowedSection) void navigate({ to: '/settings/$section', params: { section: 'account' }, replace: true })
  }, [allowedSection, authorized, navigate])
  useEffect(() => {
    if (!authorized || identity?.role !== 'admin') return
    void queryClient.prefetchQuery(requestsQuery())
    void queryClient.prefetchQuery(peopleQuery())
  }, [authorized, identity?.role, queryClient])
  if (!authorized || !allowedSection) return null
  return (
    <div className="min-h-dvh">
      <header
        data-hydrated={hydrated}
        className="flex items-center gap-4 border-b px-5 py-3.5 max-sm:flex-wrap max-sm:gap-x-3 max-sm:gap-y-2 max-sm:px-3 max-sm:py-2.5"
      >
        {hydrated ? (
          <Link to="/" className="text-inherit no-underline hover:opacity-85" aria-label="Go to board">
            <Brand />
          </Link>
        ) : (
          <span aria-label="Go to board">
            <Brand />
          </span>
        )}
        <span className="flex-1 max-sm:hidden" />
        <div className="flex gap-4 max-sm:w-full max-sm:justify-end">
          {hydrated ? (
            <Link to="/" className={cn(buttonVariants({ variant: 'outline' }))}>
              Back to board
            </Link>
          ) : (
            <Button variant="outline" disabled>
              Back to board
            </Button>
          )}
        </div>
      </header>
      <main className="mx-auto w-full max-w-[980px] px-5 pt-7 pb-12">
        <SettingsPanes me={identity!} section={validSection!} />
      </main>
    </div>
  )
}
