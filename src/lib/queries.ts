import { queryOptions } from '@tanstack/react-query'
import { listJobs, listPeople } from '../server/fns'

export const jobsQuery = () => queryOptions({ queryKey: ['jobs'], queryFn: () => listJobs() })
export const peopleQuery = () => queryOptions({ queryKey: ['people'], queryFn: () => listPeople() })
