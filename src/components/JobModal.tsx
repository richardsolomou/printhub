import { Suspense, lazy, useState } from 'react'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useServerFn } from '@tanstack/react-start'
import { usePostHog } from '@posthog/react'
import type { Job } from '../lib/jobTypes'
import type { WorkflowDefinition } from '../core/workflow'
import { peopleQuery } from '../lib/queries'
import { requesterColor, requesterLabel } from '../lib/requester'
import { useEscape } from '../lib/useEscape'
import { deleteJob, updateJob } from '../server/fns'

const StlViewer = lazy(() => import('./StlViewer'))

export function JobModal({
  job,
  workflow,
  isAdmin,
  onClose,
}: {
  job: Job
  workflow: WorkflowDefinition
  isAdmin: boolean
  onClose: () => void
}) {
  // Requesters may adjust copies/notes on their own job until any copy starts.
  const canEdit = job.canEdit
  const posthog = usePostHog()
  const { data: people } = useSuspenseQuery(peopleQuery())
  const callUpdate = useServerFn(updateJob)
  const callDelete = useServerFn(deleteJob)
  const queryClient = useQueryClient()
  const [name, setName] = useState(job.name)
  const [quantity, setQuantity] = useState(String(job.quantity))
  const [forName, setForName] = useState(requesterLabel(job))
  const [notes, setNotes] = useState(job.notes ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const dirty =
    canEdit &&
    (name !== job.name ||
      Number(quantity) !== job.quantity ||
      forName !== requesterLabel(job) ||
      notes !== (job.notes ?? ''))

  const requestClose = () => {
    if (!dirty || confirm('Discard unsaved changes?')) onClose()
  }
  useEscape(requestClose)

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await callUpdate({
        data: {
          id: job._id,
          name: name.trim() || job.name,
          quantity: Math.min(50, Math.max(1, Math.round(Number(quantity) || job.quantity))),
          requesterName: forName.trim(),
          notes: notes.trim(),
        },
      })
      await queryClient.invalidateQueries({ queryKey: ['jobs'] })
      posthog.capture('print_job_updated', {
        job_id: job._id,
      })
      onClose()
    } catch (error) {
      posthog.captureException(error, { action: 'update_print_job', job_id: job._id })
      setError("Couldn't save changes. Try again.")
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!confirm(`Delete "${job.name}"? This also deletes the STL from the NAS.`)) return
    setBusy(true)
    try {
      await callDelete({ data: { id: job._id } })
      await queryClient.invalidateQueries({ queryKey: ['jobs'] })
      onClose()
    } catch (error) {
      posthog.captureException(error, { action: 'delete_print_job', job_id: job._id })
      setError("Couldn't delete this job.")
      setBusy(false)
    }
  }

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && requestClose()}>
      <div className="dialog">
        <h2>{job.name}</h2>

        <Suspense fallback={<div className="viewer"><div className="viewer-status">loading viewer…</div></div>}>
          <StlViewer jobId={job._id} hasPreview={job.hasPreview} />
        </Suspense>

        <div className="modal-meta">
          <span className="chip qty">×{job.quantity}</span>
          {workflow.statuses.filter((status) => job.counts[status.id] > 0).map((status) => (
            <span key={status.id} className="chip">
              {job.counts[status.id]} {status.label.toLowerCase()}
            </span>
          ))}
          <span
            className="chip"
            style={{ color: requesterColor(job, people), borderColor: requesterColor(job, people) }}
          >
            {requesterLabel(job)}
          </span>
        </div>

        {!canEdit && job.notes && <p>{job.notes}</p>}

        {canEdit && (
          <form onSubmit={save}>
            <div className="field-row">
              {isAdmin && (
                <div className="field">
                  <label htmlFor="job-name">Name</label>
                  <input id="job-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
                </div>
              )}
              <div className="field">
                <label htmlFor="job-qty">Copies</label>
                <input
                  id="job-qty"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={50}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </div>
              {isAdmin && (
                <div className="field">
                  <label htmlFor="job-for">For</label>
                  <select id="job-for" value={forName} onChange={(e) => setForName(e.target.value)}>
                    {!people.some((person) => person.name === forName) && (
                      <option value={forName}>{forName}</option>
                    )}
                    {people.map((person) => (
                      <option key={person.name} value={person.name}>
                        {person.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div className="field">
              <label htmlFor="job-notes">Notes</label>
              <textarea id="job-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            {error && <p className="error">{error}</p>}
            <div className="dialog-actions">
              {isAdmin && (
                <button type="button" className="btn btn-danger" onClick={remove} disabled={busy}>
                  Delete
                </button>
              )}
              <a
                className="btn"
                href={`/api/files/${job._id}`}
                download
                onClick={() => posthog.capture('stl_downloaded', { job_id: job._id })}
              >
                Download STL
              </a>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>
        )}

        {!canEdit && (
          <div className="dialog-actions">
            <a
              className="btn"
              href={`/api/files/${job._id}`}
              download
              onClick={() => posthog.capture('stl_downloaded', { job_id: job._id })}
            >
              Download STL
            </a>
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
