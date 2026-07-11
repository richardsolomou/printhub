import { useCallback, useEffect, useState } from 'react'
import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
import { useServerFn } from '@tanstack/react-start'
import { usePostHog } from '@posthog/react'
import { useQueryClient } from '@tanstack/react-query'
import type { Job } from '../lib/jobTypes'
import type { StatusId, WorkflowDefinition } from '../core/workflow'
import { moveCopies, reorderJob } from '../server/fns'
import { Column } from './Column'
import { MoveDialog } from './MoveDialog'

type Override = { counts: Job['counts']; orders: Job['orders'] }
type PendingMove = { jobId: string; from: StatusId; to: StatusId; max: number; order?: number }

export function Board({
  jobs,
  workflow,
  isAdmin,
  onOpenJob,
}: {
  jobs: Job[]
  workflow: WorkflowDefinition
  isAdmin: boolean
  onOpenJob: (jobId: string) => void
}) {
  const posthog = usePostHog()
  const queryClient = useQueryClient()
  const callMoveCopies = useServerFn(moveCopies)
  const callReorder = useServerFn(reorderJob)
  // Optimistic placement until the live query reflects it; clearing any
  // earlier (e.g. when the server fn resolves) makes copies flash back.
  const [overrides, setOverrides] = useState<Record<string, Override>>({})
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null)

  const countsOf = useCallback((job: Job) => overrides[job._id]?.counts ?? job.counts, [overrides])
  const ordersOf = useCallback((job: Job) => overrides[job._id]?.orders ?? job.orders, [overrides])
  // Unordered jobs sort by recency (newest first) via the negated timestamp.
  const sortKey = useCallback(
    (job: Job, status: StatusId) => ordersOf(job)[status] ?? -job.createdAt,
    [ordersOf],
  )

  useEffect(() => {
    setOverrides((prev) => {
      const next = { ...prev }
      let changed = false
      for (const [id, override] of Object.entries(prev)) {
        const job = jobs.find((j) => j._id === id)
        const settled =
          !job ||
          (JSON.stringify(job.counts) === JSON.stringify(override.counts) &&
            JSON.stringify(job.orders) === JSON.stringify(override.orders))
        if (settled) {
          delete next[id]
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [jobs])

  const revertOverride = useCallback((jobId: string) => {
    setOverrides((prev) => {
      const { [jobId]: _dropped, ...rest } = prev
      return rest
    })
  }, [])

  const performMove = useCallback(
    (jobId: string, from: StatusId, to: StatusId, count: number, order?: number) => {
      const job = jobs.find((j) => j._id === jobId)
      if (!job) return
      const counts = countsOf(job)
      const nextCounts = { ...counts, [from]: counts[from] - count, [to]: counts[to] + count }
      const currentOrders = ordersOf(job)
      const nextOrders =
        counts[to] > 0 || order === undefined ? currentOrders : { ...currentOrders, [to]: order }
      setOverrides((prev) => ({ ...prev, [jobId]: { counts: nextCounts, orders: nextOrders } }))
      callMoveCopies({ data: { id: jobId, from, to, count, order } }).then(() => queryClient.invalidateQueries({ queryKey: ['jobs'] })).catch((error) => {
        posthog.captureException(error, { action: 'move_print_copies', job_id: jobId, from, to, count })
        revertOverride(jobId)
      })
    },
    [jobs, countsOf, ordersOf, callMoveCopies, revertOverride, posthog, queryClient],
  )

  const performReorder = useCallback(
    (jobId: string, status: StatusId, order: number) => {
      const job = jobs.find((j) => j._id === jobId)
      if (!job) return
      const nextOrders = { ...ordersOf(job), [status]: order }
      setOverrides((prev) => ({ ...prev, [jobId]: { counts: countsOf(job), orders: nextOrders } }))
      callReorder({ data: { id: jobId, status, order } }).then(() => queryClient.invalidateQueries({ queryKey: ['jobs'] })).catch((error) => {
        posthog.captureException(error, { action: 'reorder_print_job', job_id: jobId, status })
        revertOverride(jobId)
      })
    },
    [jobs, countsOf, ordersOf, callReorder, revertOverride, posthog, queryClient],
  )

  useEffect(() => {
    if (!isAdmin) return
    return monitorForElements({
      onDrop({ source, location }) {
        const jobId = source.data.jobId
        const from = source.data.from as StatusId
        const target = location.current.dropTargets[0]
        if (typeof jobId !== 'string' || !target) return

        const columnOf = (status: StatusId) =>
          jobs
            .filter((job) => !(job._id === jobId && status === from) && countsOf(job)[status] > 0)
            .sort((a, b) => sortKey(a, status) - sortKey(b, status))

        let to: StatusId
        let order: number | undefined
        if (target.data.type === 'card') {
          const targetJob = jobs.find((job) => job._id === target.data.jobId)
          if (!targetJob) return
          to = target.data.status as StatusId
          const list = columnOf(to)
          const index = list.findIndex((job) => job._id === targetJob._id)
          if (index === -1) return
          const edge = extractClosestEdge(target.data)
          const before = edge === 'top' ? list[index - 1] : list[index]
          const after = edge === 'top' ? list[index] : list[index + 1]
          order =
            before && after
              ? (sortKey(before, to) + sortKey(after, to)) / 2
              : before
                ? sortKey(before, to) + 1
                : after
                  ? sortKey(after, to) - 1
                  : 0
        } else if (target.data.type === 'column') {
          to = target.data.status as StatusId
          const list = columnOf(to)
          order = list.length ? sortKey(list[list.length - 1], to) + 1 : 0
        } else return

        if (to === from) {
          if (order !== undefined) performReorder(jobId, from, order)
          return
        }
        const job = jobs.find((j) => j._id === jobId)
        if (!job) return
        const available = countsOf(job)[from]
        if (available <= 0) return
        if (available === 1) performMove(jobId, from, to, 1, order)
        else setPendingMove({ jobId, from, to, max: available, order })
      },
    })
  }, [isAdmin, jobs, countsOf, sortKey, performMove, performReorder])

  const pendingJob = pendingMove ? jobs.find((j) => j._id === pendingMove.jobId) : undefined

  return (
    <main className="board">
      {workflow.statuses.map((definition) => {
        const status = definition.id
        return (
        <Column
          key={status}
          status={status}
          definition={definition}
          entries={jobs
            .filter((job) => countsOf(job)[status] > 0)
            .sort((a, b) => sortKey(a, status) - sortKey(b, status))
            .map((job) => ({ job, count: countsOf(job)[status] }))}
          isAdmin={isAdmin}
          onOpenJob={onOpenJob}
        />
        )
      })}
      {pendingMove && pendingJob && (
        <MoveDialog
          jobName={pendingJob.name}
          toLabel={workflow.statuses.find((status) => status.id === pendingMove.to)?.label ?? pendingMove.to}
          max={pendingMove.max}
          onConfirm={(count) => {
            performMove(pendingMove.jobId, pendingMove.from, pendingMove.to, count, pendingMove.order)
            setPendingMove(null)
          }}
          onCancel={() => setPendingMove(null)}
        />
      )}
    </main>
  )
}
