import { useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { usePostHog } from '@posthog/react'
import { Layers3, Minus, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AppHeader } from '../client/components/AppHeader'
import { Board } from '../client/components/Board'
import { RequestModal } from '../client/components/RequestModal'
import { UploadForm } from '../client/components/UploadForm'
import { StoragePane } from '../client/components/settings/StoragePane'
import { PrintersPane } from '../client/components/settings/PrintersPane'
import { AuthScreen } from '../client/components/AuthScreen'
import { BoardFilters, filtersFromSearch, updateRequestSearch, validateRequestSearch } from '../client/components/BoardFilters'
import { Brand } from '../client/components/Brand'
import { OnboardingProgress } from '../client/components/OnboardingProgress'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { peopleQuery, requestsQuery, sessionQuery } from '../client/queries'
import { enabledPrinters } from '../client/fleet'
import { useWorkspaceSlug } from '../client/workspace'
import { parsePlateBrief, serializePlateBrief } from '../core/plateBrief'
import type { PrinterSummary, PublicPrintRequest } from '../core/types'
export const Route = createFileRoute('/')({ validateSearch: validateRequestSearch, component: Home })

const EMPTY_REQUESTS: PublicPrintRequest[] = []

function Home() {
  const queryClient = useQueryClient()
  const { data: session } = useSuspenseQuery(sessionQuery())
  if (!session.identity) return <AuthScreen setupRequired={session.setupRequired} hosted={session.hosted} auth={session.auth} />
  if (session.identity.role === 'admin' && (!session.storageConfigured || !session.storageReady || !session.printersConfigured)) {
    return (
      <div className="min-h-dvh">
        <AppHeader
          active="board"
          isAdmin
          isDeploymentAdmin={session.identity.deploymentAdmin}
          showPlanner={false}
          navigationEnabled={false}
        />
        <main className="grid min-h-[calc(100dvh-60px)] place-items-center p-6">
          <Card className="w-full max-w-[680px]">
            <CardHeader className="gap-4">
              <Brand />
              <OnboardingProgress
                step={!session.storageConfigured || !session.storageReady ? 3 : 4}
                accountLabel={session.hosted ? 'Account' : 'Admin'}
              />
            </CardHeader>
            <CardContent>
              {!session.storageConfigured || !session.storageReady ? (
                <StoragePane onboarding onSaved={() => void queryClient.invalidateQueries({ queryKey: ['session'] })} />
              ) : (
                <PrintersPane onboarding onSaved={() => void queryClient.invalidateQueries({ queryKey: ['session'] })} />
              )}
            </CardContent>
          </Card>
        </main>
      </div>
    )
  }
  return <AuthenticatedHome />
}

function AuthenticatedHome() {
  const workspaceSlug = useWorkspaceSlug()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const {
    data: { identity, workflow, privateRequests, printers },
  } = useSuspenseQuery(sessionQuery(workspaceSlug))
  const isAdmin = identity?.role === 'admin'
  const hideRequester = privateRequests && !isAdmin
  const activePrinters = enabledPrinters(printers)
  const filters = filtersFromSearch(search)
  const { data: result, isFetching } = useQuery(requestsQuery(workspaceSlug, filters))
  const initialPlateBrief = useMemo(() => parsePlateBrief(search.plateBrief), [search.plateBrief])
  const [selectingPlate, setSelectingPlate] = useState(initialPlateBrief.length > 0)
  const [plateSelection, setPlateSelection] = useState<Record<string, number>>(() =>
    Object.fromEntries(initialPlateBrief.map((item) => [item.requestId, item.count])),
  )
  const [platePrinterId, setPlatePrinterId] = useState(search.platePrinter)
  const [plateError, setPlateError] = useState<string>()
  const { data: plateSelectionData } = useQuery({
    ...requestsQuery(workspaceSlug, { sort: 'board' }),
    enabled: selectingPlate,
  })
  const { data: people = [] } = useQuery(peopleQuery(workspaceSlug))
  const requests = result?.requests ?? EMPTY_REQUESTS
  const showPrintTypes = true
  const facets = result?.facets ?? { requesters: [], total: 0, available: 0 }
  const posthog = usePostHog()
  const [uploadOpen, setUploadOpen] = useState(false)
  const [droppedFiles, setDroppedFiles] = useState<File[]>([])
  const [fileDragActive, setFileDragActive] = useState(false)
  const [openRequestId, setOpenRequestId] = useState<string | null>(null)
  const uploadOpenRef = useRef(uploadOpen)
  uploadOpenRef.current = uploadOpen
  const plateRequests = useMemo(
    () => new Map((plateSelectionData?.requests ?? requests).map((request) => [request.id, request])),
    [plateSelectionData?.requests, requests],
  )
  const selectedPlateRequests = useMemo(
    () =>
      Object.entries(plateSelection).flatMap(([requestId, count]) => {
        const request = plateRequests.get(requestId)
        return request ? [{ request, count }] : []
      }),
    [plateRequests, plateSelection],
  )
  const compatiblePlatePrinters = useMemo(
    () => activePrinters.filter((printer) => selectedPlateRequests.every(({ request }) => requestCompatibleWithPrinter(request, printer))),
    [activePrinters, selectedPlateRequests],
  )
  const resolvedPlatePrinterId = compatiblePlatePrinters.some((printer) => printer.id === platePrinterId)
    ? platePrinterId
    : compatiblePlatePrinters[0]?.id

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
  if (!identity) return null
  const me = identity
  return (
    <div className="relative flex h-dvh flex-col">
      <AppHeader active="board" isAdmin={isAdmin} isDeploymentAdmin={me.deploymentAdmin} showPlanner={activePrinters.length > 0} />
      <BoardFilters
        search={search}
        facets={facets}
        isFetching={isFetching}
        onChange={(patch, replace = false) => void navigate({ to: '/', search: updateRequestSearch(search, patch), replace })}
      />
      <Board
        requests={requests}
        workflow={workflow}
        isAdmin={isAdmin}
        showPrintTypes={showPrintTypes}
        filtered={Object.entries(filters).some(([key, value]) => key !== 'sort' && value !== undefined)}
        sort={filters.sort ?? 'board'}
        plateSelection={selectingPlate ? plateSelection : undefined}
        onTogglePlateSelection={(request) => {
          setPlateError(undefined)
          if (plateSelection[request.id]) {
            const { [request.id]: _removed, ...remaining } = plateSelection
            setPlateSelection(remaining)
            return
          }
          const selected = Object.keys(plateSelection).flatMap((requestId) => plateRequests.get(requestId) ?? [])
          const hasCompatiblePrinter = activePrinters.some((printer) =>
            [...selected, request].every((candidate) => requestCompatibleWithPrinter(candidate, printer)),
          )
          if (!hasCompatiblePrinter) {
            setPlateError('That model cannot share a printer with the current plate brief.')
            return
          }
          setPlateSelection((current) => ({ ...current, [request.id]: 1 }))
        }}
        onOpenRequest={(id) => {
          setOpenRequestId(id)
          posthog.capture('request_viewed', { print_type: requests.find((request) => request.id === id)?.printType })
        }}
      />
      {!selectingPlate && (
        <>
          {isAdmin && (
            <Button
              type="button"
              size="lg"
              variant="outline"
              className="fixed right-4 bottom-20 z-10 shadow-lg"
              onClick={() => setSelectingPlate(true)}
            >
              <Layers3 /> Build a plate
            </Button>
          )}
          <Button
            type="button"
            size="lg"
            className="fixed right-4 bottom-4 z-10 shadow-lg max-sm:size-11 max-sm:rounded-full max-sm:p-0"
            onClick={() => {
              posthog.capture('upload_opened', { source: 'button' })
              setUploadOpen(true)
            }}
          >
            <Plus />
            <span className="max-sm:sr-only">Add a print</span>
          </Button>
        </>
      )}
      {selectingPlate && (
        <Card className="fixed right-4 bottom-4 z-20 max-h-[min(70vh,680px)] w-[min(440px,calc(100vw-2rem))] gap-0 overflow-hidden py-0 shadow-2xl">
          <CardHeader className="flex flex-row items-start gap-3 border-b px-4 py-3">
            <div className="min-w-0 flex-1">
              <h2 className="font-heading text-base font-semibold">Build a plate</h2>
              <p className="text-xs text-muted-foreground">Select queued models, then choose how many copies must be on the plate.</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Cancel plate selection"
              onClick={() => {
                setSelectingPlate(false)
                setPlateSelection({})
                setPlateError(undefined)
                void navigate({
                  to: '/',
                  search: updateRequestSearch(search, { plateBrief: undefined, platePrinter: undefined }),
                  replace: true,
                })
              }}
            >
              <X />
            </Button>
          </CardHeader>
          <CardContent className="space-y-3 overflow-y-auto p-4">
            {selectedPlateRequests.length ? (
              <div className="space-y-2">
                {selectedPlateRequests.map(({ request, count }) => (
                  <div key={request.id} className="flex items-center gap-2 rounded-md border bg-muted/30 p-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{request.name}</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      disabled={count <= 1}
                      aria-label={`Decrease ${request.name} copies`}
                      onClick={() => setPlateSelection((current) => ({ ...current, [request.id]: Math.max(1, count - 1) }))}
                    >
                      <Minus />
                    </Button>
                    <span className="w-8 text-center font-mono text-sm">{count}</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      disabled={count >= (request.counts.todo ?? 0)}
                      aria-label={`Increase ${request.name} copies`}
                      onClick={() =>
                        setPlateSelection((current) => ({ ...current, [request.id]: Math.min(request.counts.todo ?? 0, count + 1) }))
                      }
                    >
                      <Plus />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                Select models from the Queue column. Search and filters remain available.
              </p>
            )}
            {selectedPlateRequests.length > 0 && compatiblePlatePrinters.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="plate-brief-printer">
                  Printer
                </label>
                <Select
                  items={compatiblePlatePrinters.map((printer) => ({ value: printer.id, label: printer.name }))}
                  value={resolvedPlatePrinterId}
                  onValueChange={(value) => value && setPlatePrinterId(value)}
                >
                  <SelectTrigger id="plate-brief-printer" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {compatiblePlatePrinters.map((printer) => (
                      <SelectItem key={printer.id} value={printer.id}>
                        {printer.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {plateError && <p className="text-sm text-destructive">{plateError}</p>}
            <Button
              type="button"
              className="w-full"
              disabled={!selectedPlateRequests.length || !resolvedPlatePrinterId}
              onClick={() => {
                const plateBrief = serializePlateBrief(
                  selectedPlateRequests.map(({ request, count }) => ({ requestId: request.id, count })),
                )
                void navigate({ to: '/planner', search: { plateBrief, platePrinter: resolvedPlatePrinterId } })
              }}
            >
              <Layers3 /> Plan selected copies
            </Button>
          </CardContent>
        </Card>
      )}
      {!result && <div className="absolute inset-0 grid place-items-center bg-background/70 text-muted-foreground">Loading board…</div>}
      {fileDragActive && !uploadOpen && (
        <div className="pointer-events-none fixed inset-3 z-9 grid place-items-center rounded-lg border-2 border-dashed border-primary bg-background/85 font-heading text-lg tracking-wide uppercase text-primary">
          Drop STLs to add prints
        </div>
      )}
      {uploadOpen && (
        <UploadForm
          initialFiles={droppedFiles}
          printers={activePrinters}
          onClose={() => {
            setUploadOpen(false)
            setDroppedFiles([])
          }}
        />
      )}
      {selectedRequest && (
        <RequestModal request={selectedRequest} people={people} hideRequester={hideRequester} onClose={() => setOpenRequestId(null)} />
      )}
    </div>
  )
}

function requestCompatibleWithPrinter(request: PublicPrintRequest, printer: PrinterSummary) {
  if (request.printType !== printer.printType || request.fitState === 'none') return false
  return !request.compatiblePrinterIds?.length || request.compatiblePrinterIds.includes(printer.id)
}
