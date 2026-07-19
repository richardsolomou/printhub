import { Badge } from '@/components/ui/badge'
import type { PrintType, PublicPrintRequest } from '../../core/types'
import { printTypeLabel } from '../fleet'

export { printTypeLabel }

export function PrintTypeBadge({ printType }: { printType: PrintType }) {
  return <Badge variant="outline">{printTypeLabel(printType)}</Badge>
}

export function DisabledPrinterBadge({ request }: { request: PublicPrintRequest }) {
  if (!request.printer || request.printer.enabled) return null
  return (
    <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">
      Assigned printer is disabled
    </Badge>
  )
}
