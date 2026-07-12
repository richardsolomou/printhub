import { useEffect, useRef, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { usePostHog } from '@posthog/react'
import { Settings } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { Board } from '../client/components/Board'
import { RequestModal } from '../client/components/RequestModal'
import { UploadForm } from '../client/components/UploadForm'
import { StoragePane } from '../client/components/settings/StoragePane'
import { AuthScreen } from '../client/components/AuthScreen'
import { BoardFilters, filtersFromSearch, type BoardSearch } from '../client/components/BoardFilters'
import { Brand } from '../client/components/Brand'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { requestsQuery, peopleQuery, sessionQuery } from '../client/queries'
import type { RequestSort } from '../core/types'

const SORTS = new Set<RequestSort>([
  'board',
  'updated-desc',
  'updated-asc',
  'created-desc',
  'created-asc',
  'name-asc',
  'name-desc',
  'quantity-desc',
  'quantity-asc',
])
const text = (value: unknown, max = 200) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined)
const number = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value ? Number(value) : undefined
  return parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined
}
const boolean = (value: unknown) => {
  if (value === true || value === 'true' || value === '1') return true
  if (value === false || value === 'false' || value === '0') return false
  return undefined
}

function validateBoardSearch(input: Record<string, unknown>): BoardSearch {
  const sort = text(input.sort) as RequestSort | undefined
  return {
    q: text(input.q),
    requester: text(input.requester, 100),
    minQuantity: number(input.minQuantity),
    maxQuantity: number(input.maxQuantity),
    createdAfter: text(input.createdAfter, 10),
    createdBefore: text(input.createdBefore, 10),
    updatedAfter: text(input.updatedAfter, 10),
    updatedBefore: text(input.updatedBefore, 10),
    hasNotes: boolean(input.hasNotes),
    hasSource: boolean(input.hasSource),
    hasThumbnail: boolean(input.hasThumbnail),
    hasPreview: boolean(input.hasPreview),
    sort: sort && SORTS.has(sort) ? sort : undefined,
  }
}

function updateBoardSearch(current: BoardSearch, patch: Partial<BoardSearch>): BoardSearch {
  const next: BoardSearch = { ...current, ...patch }
  for (const key of Object.keys(next) as (keyof BoardSearch)[]) {
    if (next[key] === undefined) delete next[key]
  }
  return next
}

export const Route = createFileRoute('/')({ validateSearch: validateBoardSearch, component: Home })

function Home() {
  const queryClient = useQueryClient()
  const { data: session } = useSuspenseQuery(sessionQuery())
  if (!session.identity) return <AuthScreen setupRequired={session.setupRequired} auth={session.auth} />
  if (session.identity.role === 'admin' && (!session.storageConfigured || !session.storageReady)) {
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        <Card className="w-full max-w-[620px]">
          <CardHeader>
            <Brand />
          </CardHeader>
          <CardContent>
            <StoragePane onboarding onSaved={() => void queryClient.invalidateQueries({ queryKey: ['session'] })} />
          </CardContent>
        </Card>
      </main>
    )
  }
  return <AuthenticatedHome />
}

function AuthenticatedHome() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const {
    data: { identity, workflow, privateRequests },
  } = useSuspenseQuery(sessionQuery())
  const me = identity!
  const isAdmin = me.role === 'admin'
  const hideRequester = privateRequests && !isAdmin
  const filters = filtersFromSearch(search)
  const { data: result, isFetching } = useQuery(requestsQuery(filters))
  const { data: people = [] } = useQuery(peopleQuery())
  const requests = result?.requests ?? []
  const facets = result?.facets ?? { requesters: [], total: 0, available: 0 }
  const posthog = usePostHog()
  const [uploadOpen, setUploadOpen] = useState(false)
  const [droppedFiles, setDroppedFiles] = useState<File[]>([])
  const [fileDragActive, setFileDragActive] = useState(false)
  const [openRequestId, setOpenRequestId] = useState<string | null>(null)
  const uploadOpenRef = useRef(uploadOpen)
  uploadOpenRef.current = uploadOpen

  useEffect(() => {
    let depth = 0
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false
    const onDragEnter = (event: DragEvent) => {
      if (hasFiles(event)) {
        depth++
        if (!uploadOpenRef.current) setFileDragActive(true)
      }
    }
    const onDragOver = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault()
    }
    const onDragLeave = (event: DragEvent) => {
      if (hasFiles(event)) {
        depth = Math.max(0, depth - 1)
        if (!depth) setFileDragActive(false)
      }
    }
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      depth = 0
      setFileDragActive(false)
      if (uploadOpenRef.current) return
      const files = Array.from(event.dataTransfer?.files ?? [])
      if (files.length) {
        posthog.capture('upload_opened', { source: 'drop', file_count: files.length })
        setDroppedFiles(files)
        setUploadOpen(true)
      }
    }
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [posthog])

  const selectedRequest = requests.find((request) => request.id === openRequestId)
  return (
    <div className="relative flex h-dvh flex-col">
      <header className="flex items-center gap-4 border-b px-5 py-3.5 max-sm:flex-wrap max-sm:gap-x-3 max-sm:gap-y-2 max-sm:px-3 max-sm:py-2.5">
        <Brand />
        <span className="flex-1 max-sm:hidden" />
        <div className="flex gap-4 max-sm:w-full max-sm:flex-wrap max-sm:justify-end max-sm:gap-2">
          <Tooltip>
            <TooltipTrigger
              render={
                <Link
                  to="/settings/$section"
                  params={{ section: 'account' }}
                  className={cn(buttonVariants({ variant: 'outline', size: 'icon' }))}
                  aria-label="Settings"
                />
              }
            >
              <Settings />
            </TooltipTrigger>
            <TooltipContent>Settings</TooltipContent>
          </Tooltip>
          <Button
            type="button"
            className="max-sm:ml-auto"
            onClick={() => {
              posthog.capture('upload_opened', { source: 'button' })
              setUploadOpen(true)
            }}
          >
            Add a print
          </Button>
        </div>
      </header>
      <BoardFilters
        search={search}
        facets={facets}
        isFetching={isFetching}
        onChange={(patch, replace = false) => void navigate({ to: '/', search: updateBoardSearch(search, patch), replace })}
      />
      <Board
        requests={requests}
        workflow={workflow}
        people={people}
        isAdmin={isAdmin}
        hideRequester={hideRequester}
        sort={filters.sort ?? 'board'}
        onOpenRequest={(id) => {
          setOpenRequestId(id)
          posthog.capture('request_viewed', { request_id: id })
        }}
      />
      {!result && <div className="absolute inset-0 grid place-items-center bg-background/70 text-muted-foreground">Loading board…</div>}
      {fileDragActive && !uploadOpen && (
        <div className="pointer-events-none fixed inset-3 z-9 grid place-items-center rounded-lg border-2 border-dashed border-primary bg-background/85 font-heading text-lg tracking-wide uppercase text-primary">
          Drop STLs to add prints
        </div>
      )}
      {uploadOpen && (
        <UploadForm
          myName={me.name}
          chooseFor={!privateRequests}
          initialFiles={droppedFiles}
          onClose={() => {
            setUploadOpen(false)
            setDroppedFiles([])
          }}
        />
      )}
      {selectedRequest && (
        <RequestModal
          request={selectedRequest}
          workflow={workflow}
          isAdmin={isAdmin}
          hideRequester={hideRequester}
          onClose={() => setOpenRequestId(null)}
        />
      )}
    </div>
  )
}
