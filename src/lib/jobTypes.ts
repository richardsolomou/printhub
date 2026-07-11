import type { Doc } from '../../convex/_generated/dataModel'

/** What jobs.list returns: the doc minus the heavy thumbnail, plus a flag for it. */
export type Job = Omit<Doc<'jobs'>, 'thumbnail'> & { hasThumbnail: boolean }
