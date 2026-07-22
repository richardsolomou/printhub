import { useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { releaseUpdateQuery } from '../queries'

export function useReleaseUpdate(enabled: boolean) {
  return useQuery(releaseUpdateQuery(enabled && typeof window !== 'undefined')).data?.update
}

export function ReleaseUpdateNotice({ hosted }: { hosted: boolean }) {
  const update = useReleaseUpdate(true)
  if (!update) return null

  return (
    <aside className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm">
      <span className="font-medium">STL Quest v{update.latestVersion} is available.</span>
      <a
        className={cn(buttonVariants({ size: 'sm', variant: 'outline' }), 'ml-auto')}
        href={update.releaseUrl}
        target="_blank"
        rel="noreferrer"
      >
        {hosted ? 'View what’s new' : 'View release'}
        <ExternalLink />
      </a>
    </aside>
  )
}
