import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { clientNeedsRefresh } from '../updateNotices'

export function UpdateNotices({ serverVersion }: { serverVersion: string }) {
  if (!clientNeedsRefresh(serverVersion, __APP_VERSION__)) return null
  return (
    <div className="fixed right-3 bottom-3 left-3 z-50 flex items-center gap-2 rounded-lg border bg-popover/95 p-2 shadow-lg backdrop-blur sm:right-auto sm:left-1/2 sm:-translate-x-1/2">
      <span className="whitespace-nowrap px-2 text-sm font-medium">STL Quest has been updated.</span>
      <Button type="button" size="sm" onClick={() => window.location.reload()}>
        <RefreshCw />
        Refresh
      </Button>
    </div>
  )
}
