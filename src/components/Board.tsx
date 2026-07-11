import { useCallback, useEffect, useState } from 'react'
import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
import { useServerFn } from '@tanstack/react-start'
import type { Doc } from '../../convex/_generated/dataModel'
import { STATUSES, type Status } from '../../convex/statuses'
import { moveJob } from '../server/fns'
import { Column } from './Column'

type Override = { status: Status; order?: number }

export function Board({
  jobs,
  isAdmin,
  onOpenJob,
}: {
  jobs: Doc<'jobs'>[]
  isAdmin: boolean
  onOpenJob: (jobId: string) => void
}) {
  const callMoveJob = useServerFn(moveJob)
  // Optimistic placement until the live query reflects it; clearing any
  // earlier (e.g. when the server fn resolves) makes the card flash back.
  const [overrides, setOverrides] = useState<Record<string, Override>>({})

  const statusOf = useCallback(
    (job: Doc<'jobs'>) => overrides[job._id]?.status ?? job.status,
    [overrides],
  )
  // Unordered jobs sort by recency (newest first) via the negated timestamp.
  const sortKey = useCallback(
    (job: Doc<'jobs'>) => overrides[job._id]?.order ?? job.order ?? -job.createdAt,
    [overrides],
  )

  useEffect(() => {
    setOverrides((prev) => {
      const next = { ...prev }
      let changed = false
      for (const [id, override] of Object.entries(prev)) {
        const job = jobs.find((j) => j._id === id)
        const settled =
          !job ||
          (job.status === override.status && (override.order === undefined || job.order === override.order))
        if (settled) {
          delete next[id]
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [jobs])

  const handleDrop = useCallback(
    (jobId: string, status: Status, order: number) => {
      setOverrides((prev) => ({ ...prev, [jobId]: { status, order } }))
      callMoveJob({ data: { id: jobId, status, order } }).catch(() =>
        setOverrides((prev) => {
          const { [jobId]: _dropped, ...rest } = prev
          return rest
        }),
      )
    },
    [callMoveJob],
  )

  useEffect(() => {
    if (!isAdmin) return
    return monitorForElements({
      onDrop({ source, location }) {
        const jobId = source.data.jobId
        const target = location.current.dropTargets[0]
        if (typeof jobId !== 'string' || !target) return

        const columnOf = (status: Status) =>
          jobs
            .filter((job) => job._id !== jobId && statusOf(job) === status)
            .sort((a, b) => sortKey(a) - sortKey(b))

        if (target.data.type === 'card') {
          const targetJob = jobs.find((job) => job._id === target.data.jobId)
          if (!targetJob || targetJob._id === jobId) return
          const status = statusOf(targetJob)
          const list = columnOf(status)
          const index = list.findIndex((job) => job._id === targetJob._id)
          const edge = extractClosestEdge(target.data)
          const before = edge === 'top' ? list[index - 1] : list[index]
          const after = edge === 'top' ? list[index] : list[index + 1]
          const order =
            before && after
              ? (sortKey(before) + sortKey(after)) / 2
              : before
                ? sortKey(before) + 1
                : after
                  ? sortKey(after) - 1
                  : 0
          handleDrop(jobId, status, order)
        } else if (target.data.type === 'column') {
          const status = target.data.status as Status
          const list = columnOf(status)
          const order = list.length ? sortKey(list[list.length - 1]) + 1 : 0
          handleDrop(jobId, status, order)
        }
      },
    })
  }, [isAdmin, jobs, statusOf, sortKey, handleDrop])

  return (
    <main className="board">
      {STATUSES.map((status) => (
        <Column
          key={status}
          status={status}
          jobs={jobs.filter((job) => statusOf(job) === status).sort((a, b) => sortKey(a) - sortKey(b))}
          isAdmin={isAdmin}
          onOpenJob={onOpenJob}
        />
      ))}
    </main>
  )
}
