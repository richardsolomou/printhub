import type { ReactNode } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

export function DialogShell({
  open = true,
  onClose,
  title,
  className,
  children,
  preventClose = false,
}: {
  open?: boolean
  onClose: () => void
  title: string
  className?: string
  children: ReactNode
  preventClose?: boolean
}) {
  return (
    <Dialog
      open={open}
      disablePointerDismissal={preventClose}
      onOpenChange={(next, details) => {
        if (!next && preventClose) {
          details.cancel()
          return
        }
        if (!next) onClose()
      }}
    >
      <DialogContent
        showCloseButton={!preventClose}
        className={cn('max-h-[calc(100dvh-2.5rem)] overflow-y-auto sm:max-w-[560px]', className)}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}
