import { useEffect, useRef, useState } from 'react'
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import type { StatusId, WorkflowStatus } from '../core/workflow'
import type { Job } from '../lib/jobTypes'
import { JobCard } from './JobCard'

export function Column({
  status,
  definition,
  entries,
  isAdmin,
  onOpenJob,
}: {
  status: StatusId
  definition: WorkflowStatus
  entries: { job: Job; count: number }[]
  isAdmin: boolean
  onOpenJob: (jobId: string) => void
}) {
  const ref = useRef<HTMLElement>(null)
  const [isOver, setIsOver] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element || !isAdmin) return
    return dropTargetForElements({
      element,
      getData: () => ({ type: 'column', status }),
      onDragEnter: () => setIsOver(true),
      onDragLeave: () => setIsOver(false),
      onDrop: () => setIsOver(false),
    })
  }, [isAdmin, status])

  const total = entries.reduce((sum, entry) => sum + entry.count, 0)

  return (
    <section ref={ref} className={`column${isOver ? ' drop-target' : ''}`} data-status={status}>
      <header className="column-head">
        <span className="dot" />
        {definition.label}
        <span className="count">{total}</span>
      </header>
      <div className="column-body">
        {entries.length === 0 && <div className="column-empty">{definition.empty}</div>}
        {entries.map(({ job, count }) => (
          <JobCard
            key={job._id}
            job={job}
            status={status}
            count={count}
            canDrag={isAdmin}
            onOpen={() => onOpenJob(job._id)}
          />
        ))}
      </div>
    </section>
  )
}
