import { queryOptions } from '@tanstack/react-query'
import { listRequests, listPeople } from '../server/fns'

export const requestsQuery = () => queryOptions({ queryKey: ['requests'], queryFn: () => listRequests() })
export const peopleQuery = () => queryOptions({ queryKey: ['people'], queryFn: () => listPeople() })
