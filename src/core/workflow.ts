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
    { id: 'todo', label: 'Queue', folder: 'todo', empty: 'No resin prints are waiting.' },
    { id: 'in_progress', label: 'Printing', folder: 'in-progress', empty: 'Resin printers are idle.' },
    {
      id: 'post_processing',
      label: 'Post-processing',
      folder: 'post-processing',
      empty: 'No prints are waiting for support removal, washing, or curing.',
    },
    { id: 'done', label: 'Ready', folder: 'done', empty: 'No finished prints are ready yet.' },
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
