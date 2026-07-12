export type StatusId = string

export type WorkflowStatus = {
  id: StatusId
  label: string
  folder: string
  empty: string
}

export type WorkflowDefinition = { statuses: WorkflowStatus[] }

export const workflow: WorkflowDefinition = {
  statuses: [
    { id: 'todo', label: 'To Do', folder: 'todo', empty: 'Nothing queued.' },
    { id: 'in_progress', label: 'In Progress', folder: 'in-progress', empty: 'Printers are idle.' },
    { id: 'done', label: 'Done', folder: 'done', empty: 'Nothing finished yet.' },
  ],
}

export function statusById(id: string): WorkflowStatus {
  const status = workflow.statuses.find((entry) => entry.id === id)
  if (!status) throw new Error('invalid status')
  return status
}

export function initialStatus(): WorkflowStatus {
  const status = workflow.statuses[0]
  if (!status) throw new Error('workflow has no statuses')
  return status
}
