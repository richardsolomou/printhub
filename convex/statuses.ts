export const STATUSES = ['todo', 'in_progress', 'done'] as const
export type Status = (typeof STATUSES)[number]

export const STATUS_LABELS: Record<Status, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  done: 'Done',
}

export const STATUS_FOLDERS: Record<Status, string> = {
  todo: 'todo',
  in_progress: 'in-progress',
  done: 'done',
}
