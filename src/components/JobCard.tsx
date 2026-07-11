import { useEffect, useRef, useState } from 'react'
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import {
  attachClosestEdge,
  extractClosestEdge,
  type Edge,
} from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
import { useSuspenseQuery } from '@tanstack/react-query'
import type { StatusId } from '../core/workflow'
import { peopleQuery } from '../lib/queries'
import type { Job } from '../lib/jobTypes'
import { LazyThumb } from './LazyThumb'
import { requesterColor, requesterLabel } from '../lib/requester'

export function JobCard({
  job,
  status,
  count,
  canDrag,
  onOpen,
}: {
  job: Job
  status: StatusId
  count: number
  canDrag: boolean
  onOpen: () => void
}) {
  const { data: users } = useSuspenseQuery(peopleQuery())
  const ref = useRef<HTMLButtonElement>(null)
  const [dragging, setDragging] = useState(false)
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null)

  useEffect(() => {
    const element = ref.current
    if (!element || !canDrag) return
    return combine(
      draggable({
        element,
        getInitialData: () => ({ jobId: job._id, from: status }),
        onDragStart: () => setDragging(true),
        onDrop: () => setDragging(false),
      }),
      dropTargetForElements({
        element,
        getData: ({ input, element: el }) =>
          attachClosestEdge(
            { type: 'card', jobId: job._id, status },
            { input, element: el, allowedEdges: ['top', 'bottom'] },
          ),
        onDrag: ({ self, source }) => {
          if (source.data.jobId !== job._id || source.data.from !== status) {
            setClosestEdge(extractClosestEdge(self.data))
          }
        },
        onDragLeave: () => setClosestEdge(null),
        onDrop: () => setClosestEdge(null),
      }),
    )
  }, [canDrag, job._id, status])

  return (
    <button
      ref={ref}
      type="button"
      className={`card${canDrag ? ' draggable' : ''}${dragging ? ' dragging' : ''}`}
      data-edge={closestEdge ?? undefined}
      onClick={onOpen}
    >
      {job.hasThumbnail ? (
        <LazyThumb jobId={job._id} />
      ) : (
        <div className="thumb">
          <span className="placeholder">stl</span>
        </div>
      )}
      <div className="card-info">
        <div className="card-title">{job.name}</div>
        <div className="card-meta">
          <span className="chip qty">{count === job.quantity ? `×${count}` : `×${count} of ${job.quantity}`}</span>
          <span
            className="chip"
            style={{ color: requesterColor(job, users), borderColor: requesterColor(job, users) }}
          >
            {requesterLabel(job)}
          </span>
          {job.notes && (
            <span className="chip" title={job.notes}>
              ✎ notes
            </span>
          )}
        </div>
      </div>
    </button>
  )
}
