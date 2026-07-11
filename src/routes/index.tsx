import { useEffect, useRef, useState } from 'react'
import { createFileRoute, getRouteApi } from '@tanstack/react-router'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { usePostHog } from '@posthog/react'
import { useServerFn } from '@tanstack/react-start'
import { Board } from '../components/Board'
import { JobModal } from '../components/JobModal'
import { UploadForm } from '../components/UploadForm'
import { AuthScreen } from '../components/AuthScreen'
import { CreateUserDialog } from '../components/CreateUserDialog'
import { ChangePasswordDialog } from '../components/ChangePasswordDialog'
import { jobsQuery, peopleQuery } from '../lib/queries'
import { logout } from '../server/fns'

const rootRoute = getRouteApi('__root__')

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  const session = rootRoute.useLoaderData()
  if (!session.identity) return <AuthScreen setupRequired={session.setupRequired} setupConfigured={session.setupConfigured} trustedHeader={session.authProvider === 'trusted-header'} />
  return <AuthenticatedHome />
}

function AuthenticatedHome() {
  const { identity, workflow, authProvider } = rootRoute.useLoaderData()
  const me = identity!
  const { data: jobs } = useSuspenseQuery(jobsQuery())
  useSuspenseQuery(peopleQuery())
  const queryClient = useQueryClient()
  const callLogout = useServerFn(logout)
  const posthog = usePostHog()
  const [uploadOpen, setUploadOpen] = useState(false)
  const [createUserOpen, setCreateUserOpen] = useState(false)
  const [changePasswordOpen, setChangePasswordOpen] = useState(false)
  const [droppedFiles, setDroppedFiles] = useState<File[]>([])
  const [fileDragActive, setFileDragActive] = useState(false)
  const [openJobId, setOpenJobId] = useState<string | null>(null)
  const uploadOpenRef = useRef(uploadOpen)
  uploadOpenRef.current = uploadOpen

  useEffect(() => {
    const events = new EventSource('/api/events')
    events.onopen = () => {
      void queryClient.invalidateQueries({ queryKey: ['jobs'] })
      void queryClient.invalidateQueries({ queryKey: ['people'] })
    }
    events.addEventListener('change', () => {
      void queryClient.invalidateQueries({ queryKey: ['jobs'] })
      void queryClient.invalidateQueries({ queryKey: ['people'] })
    })
    return () => events.close()
  }, [queryClient])

  useEffect(() => {
    let depth = 0
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false
    const onDragEnter = (event: DragEvent) => { if (hasFiles(event)) { depth++; if (!uploadOpenRef.current) setFileDragActive(true) } }
    const onDragOver = (event: DragEvent) => { if (hasFiles(event)) event.preventDefault() }
    const onDragLeave = (event: DragEvent) => { if (hasFiles(event)) { depth = Math.max(0, depth - 1); if (!depth) setFileDragActive(false) } }
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault(); depth = 0; setFileDragActive(false)
      if (uploadOpenRef.current) return
      const files = Array.from(event.dataTransfer?.files ?? [])
      if (files.length) { posthog.capture('print_upload_opened', { source: 'drop', file_count: files.length }); setDroppedFiles(files); setUploadOpen(true) }
    }
    window.addEventListener('dragenter', onDragEnter); window.addEventListener('dragover', onDragOver); window.addEventListener('dragleave', onDragLeave); window.addEventListener('drop', onDrop)
    return () => { window.removeEventListener('dragenter', onDragEnter); window.removeEventListener('dragover', onDragOver); window.removeEventListener('dragleave', onDragLeave); window.removeEventListener('drop', onDrop) }
  }, [posthog])

  const selectedJob = jobs.find((job) => job._id === openJobId)
  return (
    <div className="app">
      <header className="header">
        <h1>Print<span className="accent">Hub</span></h1>
        <span className="who">v{__APP_VERSION__}</span>
        <span className="header-spacer" />
        <div className="header-actions">
          {authProvider === 'local' && <button type="button" className="btn" onClick={() => setChangePasswordOpen(true)}>Change password</button>}
          {authProvider === 'local' && <button type="button" className="btn sign-out" onClick={async () => { await callLogout(); window.location.reload() }}>Sign out</button>}
          {me.role === 'operator' && authProvider === 'local' && <button type="button" className="btn" onClick={() => setCreateUserOpen(true)}>Add user</button>}
          <button type="button" className="btn btn-primary add-print" onClick={() => { posthog.capture('print_upload_opened', { source: 'button' }); setUploadOpen(true) }}>Add a print</button>
        </div>
      </header>
      <Board jobs={jobs} workflow={workflow} isAdmin={me.role === 'operator'} onOpenJob={(id) => { setOpenJobId(id); posthog.capture('print_job_viewed', { job_id: id }) }} />
      {fileDragActive && !uploadOpen && <div className="drop-hint">Drop STLs to add prints</div>}
      {uploadOpen && <UploadForm myName={me.name} initialFiles={droppedFiles} onClose={() => { setUploadOpen(false); setDroppedFiles([]) }} />}
      {createUserOpen && <CreateUserDialog onClose={() => setCreateUserOpen(false)} />}
      {changePasswordOpen && <ChangePasswordDialog onClose={() => setChangePasswordOpen(false)} />}
      {selectedJob && <JobModal job={selectedJob} workflow={workflow} isAdmin={me.role === 'operator'} onClose={() => setOpenJobId(null)} />}
    </div>
  )
}
