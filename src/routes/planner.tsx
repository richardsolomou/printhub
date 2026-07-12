import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { Box, Settings } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { AppHeader } from '../client/components/AppHeader'
import { preloadStlViewer } from '../client/components/LazyStlViewer'
import { PlateViewer } from '../client/components/PlateViewer'
import { RequestCard } from '../client/components/RequestCard'
import { RequestModal } from '../client/components/RequestModal'
import { analyzePlateModel } from '../client/plateAnalysis'
import { peopleQuery, platePlannerQuery, requestsQuery, sessionQuery } from '../client/queries'
import { savePlateModelAnalyses, savePlatePlannerDraft } from '../server/fns'
import {
  normalizePrinterProfile,
  packPlate,
  placementIssues,
  type PlateCandidate,
  type PlatePlacement,
  type PrinterProfile,
} from '../core/platePlanner'

export const Route = createFileRoute('/planner')({ component: PlannerPage })

const DEFAULT_PRINTERS: PrinterProfile[] = [
  {
    id: 'resin-medium',
    name: 'Printer 1',
    widthMm: 129,
    depthMm: 80,
    heightMm: 150,
    spacingMm: 5,
    supportMarginMm: 4,
    adhesionMarginMm: 2,
    heightAllowanceMm: 5,
    maxHeightDifferenceMm: 20,
  },
]

function PlannerPage() {
  const { data: session } = useSuspenseQuery(sessionQuery())
  const { data } = useQuery(requestsQuery({ sort: 'created-asc' }))
  const { data: people = [] } = useQuery(peopleQuery())
  const { data: storedPlanner } = useQuery(platePlannerQuery())
  const [printers, setPrinters] = useState(DEFAULT_PRINTERS)
  const [printerId, setPrinterId] = useState(DEFAULT_PRINTERS[0].id)
  const [geometries] = useState(() => new Map<string, THREE.BufferGeometry>())
  const [placements, setPlacements] = useState<PlatePlacement[]>([])
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState({ complete: 0, total: 0 })
  const [error, setError] = useState<string>()
  const [restored, setRestored] = useState(false)
  const [openRequestId, setOpenRequestId] = useState<string>()
  const generationRef = useRef(0)
  const generatedFingerprintRef = useRef<string | undefined>(undefined)

  const printer = printers.find((profile) => profile.id === printerId) ?? printers[0]
  const outstanding = useMemo(() => (data?.requests ?? []).filter((request) => (request.counts.todo ?? 0) > 0), [data?.requests])
  const issues = useMemo(() => placementIssues(placements, printer), [placements, printer])
  const invalidCopyIds = useMemo(() => new Set(issues.keys()), [issues])
  const plateContents = useMemo(() => {
    const contents = new Map<string, { requestId: string; count: number }>()
    for (const placement of placements) {
      const current = contents.get(placement.requestId) ?? {
        requestId: placement.requestId,
        count: 0,
      }
      current.count++
      contents.set(placement.requestId, current)
    }
    return [...contents.values()]
  }, [placements])
  const selectedRequest = data?.requests.find((request) => request.id === openRequestId)
  const fingerprint = useMemo(() => plannerFingerprint(outstanding, printer), [outstanding, printer])

  useEffect(() => {
    preloadStlViewer()
  }, [])

  useEffect(() => {
    if (!storedPlanner || restored) return
    const profiles = storedPlanner.profiles?.length
      ? storedPlanner.profiles.map((profile) => normalizePrinterProfile(profile))
      : DEFAULT_PRINTERS
    const savedPrinterId = storedPlanner.draft?.printerId
    const selectedPrinter = profiles.find((profile) => profile.id === savedPrinterId) ?? profiles[0]
    setPrinters(profiles)
    setPrinterId(selectedPrinter.id)
    if (storedPlanner.draft?.fingerprint === plannerFingerprint(outstanding, selectedPrinter)) {
      setPlacements(storedPlanner.draft.placements)
    }
    setRestored(true)
  }, [outstanding, restored, storedPlanner])

  const generate = useCallback(async () => {
    const generation = ++generationRef.current
    setLoading(true)
    setError(undefined)
    setProgress({ complete: 0, total: outstanding.length })
    try {
      let complete = 0
      const storedAnalyses = new Map(storedPlanner?.analyses.map((analysis) => [analysis.requestId, analysis]))
      const freshAnalyses: { requestId: string; widthMm: number; depthMm: number; heightMm: number }[] = []
      const modelResults = await mapConcurrent(outstanding, 4, async (request) => {
        let geometry = geometries.get(request.id)
        let size: { x: number; y: number; z: number }
        if (geometry) {
          size = new THREE.Box3()
            .setFromBufferAttribute(geometry.getAttribute('position') as THREE.BufferAttribute)
            .getSize(new THREE.Vector3())
        } else if (storedAnalyses.has(request.id)) {
          const cached = storedAnalyses.get(request.id)!
          size = { x: cached.widthMm, y: cached.depthMm, z: cached.heightMm }
        } else {
          const response = await fetch(`/api/files/${request.id}?inline=1&preview=1`)
          if (!response.ok) throw new Error(`Could not load ${request.name}`)
          const analysis = await analyzePlateModel(request.id, await response.arrayBuffer())
          geometry = analysis.geometry
          size = analysis.size
          geometries.set(request.id, geometry)
          freshAnalyses.push({ requestId: request.id, widthMm: size.x, depthMm: size.y, heightMm: size.z })
        }
        complete++
        setProgress({ complete, total: outstanding.length })
        return { request, size }
      })
      const analyzed: PlateCandidate[] = []
      for (const { request, size } of modelResults) {
        const copyCount = request.counts.todo ?? 0
        for (let copy = 1; copy <= copyCount; copy++) {
          analyzed.push({
            copyId: `${request.id}:${copy}`,
            requestId: request.id,
            name: `${request.name} #${copy}`,
            footprint: { widthMm: size.x, depthMm: size.y, known: true },
            estimatedSupportedHeightMm: size.z + printer.heightAllowanceMm,
          })
        }
      }
      const result = packPlate(analyzed, printer)
      if (generation !== generationRef.current) return
      setPlacements(result.placements)
      generatedFingerprintRef.current = fingerprint
      if (freshAnalyses.length) await savePlateModelAnalyses({ data: { analyses: freshAnalyses } })
      await savePlatePlannerDraft({
        data: {
          draft: {
            fingerprint,
            printerId: printer.id,
            candidates: analyzed,
            placements: result.placements,
            skippedCount: result.skipped.length,
            savedAt: Date.now(),
          },
        },
      })
    } catch (cause) {
      if (generation === generationRef.current) setError(cause instanceof Error ? cause.message : 'Could not generate a plate')
    } finally {
      if (generation === generationRef.current) setLoading(false)
    }
  }, [fingerprint, geometries, outstanding, printer, storedPlanner?.analyses])

  useEffect(() => {
    if (!restored || !storedPlanner || !outstanding.length || generatedFingerprintRef.current === fingerprint) return
    setPlacements([])
    void generate()
  }, [fingerprint, generate, outstanding.length, restored, storedPlanner])

  useEffect(() => {
    if (!placements.length) return
    const requestIds = [...new Set(placements.map((placement) => placement.requestId))]
    void mapConcurrent(requestIds, 4, async (requestId) => {
      if (geometries.has(requestId)) return
      const response = await fetch(`/api/files/${requestId}?inline=1&preview=1`)
      if (!response.ok) return
      const analysis = await analyzePlateModel(requestId, await response.arrayBuffer())
      geometries.set(requestId, analysis.geometry)
      setPlacements((current) => [...current])
    })
  }, [geometries, placements])

  if (!session.identity) {
    return <main className="grid min-h-dvh place-items-center p-6">Sign in from the board to use the planner.</main>
  }
  if (session.identity.role !== 'admin') {
    return <main className="grid min-h-dvh place-items-center p-6">The plate planner is operator-only.</main>
  }

  return (
    <div className="min-h-dvh max-w-full overflow-x-hidden bg-muted/20">
      <AppHeader active="planner" isAdmin />
      <main className="mx-auto w-full max-w-[1500px] min-w-0 p-3 sm:p-4 md:p-6">
        <div className="grid min-w-0 gap-4 xl:grid-cols-[260px_minmax(0,1fr)_320px]">
          <Card className="h-fit min-w-0">
            <CardHeader>
              <CardTitle>Printer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="printer-profile" className="text-sm font-medium">
                  Profile
                </label>
                <Select
                  items={printers.map((profile) => ({ value: profile.id, label: profile.name }))}
                  value={printerId}
                  onValueChange={(value) => {
                    if (!value) return
                    generationRef.current++
                    generatedFingerprintRef.current = undefined
                    setPlacements([])
                    setPrinterId(value)
                  }}
                >
                  <SelectTrigger id="printer-profile" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {printers.map((profile) => (
                      <SelectItem key={profile.id} value={profile.id}>
                        {profile.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Link
                to="/settings/$section"
                params={{ section: 'printers' }}
                className={cn(buttonVariants({ variant: 'outline' }), 'w-full')}
              >
                <Settings /> Manage printers
              </Link>
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Build plate</CardTitle>
            </CardHeader>
            <CardContent>
              {placements.length ? (
                <PlateViewer printer={printer} placements={placements} geometries={geometries} invalidCopyIds={invalidCopyIds} />
              ) : (
                <div className="grid h-[min(62vh,720px)] min-h-80 place-items-center rounded-xl border border-dashed text-center text-muted-foreground">
                  <div>
                    <Box className="mx-auto mb-3 size-10" />
                    <p>
                      {loading
                        ? `Analyzing models ${progress.complete}/${progress.total}`
                        : outstanding.length
                          ? 'No models fit this build plate.'
                          : 'No outstanding models to print.'}
                    </p>
                  </div>
                </div>
              )}
              {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
            </CardContent>
          </Card>

          <div className="min-w-0">
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle>Plate contents</CardTitle>
              </CardHeader>
              <CardContent className="max-h-[520px] space-y-2.5 overflow-auto p-2.5 pt-0">
                {plateContents.map((content) => {
                  const request = data?.requests.find((candidate) => candidate.id === content.requestId)
                  if (!request) return null
                  return (
                    <RequestCard
                      key={content.requestId}
                      request={request}
                      people={people}
                      status="todo"
                      count={content.count}
                      canDrag={false}
                      settling={false}
                      hideRequester={false}
                      onOpen={() => {
                        preloadStlViewer()
                        setOpenRequestId(content.requestId)
                      }}
                    />
                  )
                })}
              </CardContent>
            </Card>
          </div>
        </div>
        {selectedRequest && (
          <RequestModal
            request={selectedRequest}
            workflow={session.workflow}
            isAdmin
            hideRequester={false}
            onClose={() => setOpenRequestId(undefined)}
          />
        )}
      </main>
    </div>
  )
}

async function mapConcurrent<Input, Output>(items: Input[], concurrency: number, work: (item: Input) => Promise<Output>) {
  const results = Array.from<Output>({ length: items.length })
  let nextIndex = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex++
        results[index] = await work(items[index])
      }
    }),
  )
  return results
}

function plannerFingerprint(requests: { id: string; counts: Record<string, number> }[], printer: PrinterProfile) {
  return JSON.stringify({
    printer,
    requests: requests.map((request) => ({ id: request.id, todo: request.counts.todo ?? 0 })),
  })
}
