import { keepPreviousData, queryOptions } from '@tanstack/react-query'
import {
  getBoardSettings,
  getAccountMethods,
  getDiagnostics,
  getIntegrationSettings,
  getStorageSettings,
  getTelemetrySettings,
  listInvites,
  listRequests,
  listPeople,
  listUsers,
  sessionInfo,
} from '../server/fns'
import type { RequestFilters } from '../core/types'

export const sessionQuery = () => queryOptions({ queryKey: ['session'], queryFn: () => sessionInfo() })
export const accountMethodsQuery = () => queryOptions({ queryKey: ['account-methods'], queryFn: () => getAccountMethods() })
export const requestsQuery = (filters: RequestFilters = {}) =>
  queryOptions({ queryKey: ['requests', filters], queryFn: () => listRequests({ data: filters }), placeholderData: keepPreviousData })
export const peopleQuery = () => queryOptions({ queryKey: ['people'], queryFn: () => listPeople() })
export const usersQuery = () => queryOptions({ queryKey: ['users'], queryFn: () => listUsers() })
export const invitesQuery = () => queryOptions({ queryKey: ['invites'], queryFn: () => listInvites() })
export const storageQuery = () => queryOptions({ queryKey: ['storage'], queryFn: () => getStorageSettings() })
export const telemetryQuery = () => queryOptions({ queryKey: ['telemetry'], queryFn: () => getTelemetrySettings() })
export const boardQuery = () => queryOptions({ queryKey: ['board-settings'], queryFn: () => getBoardSettings() })
export const diagnosticsQuery = () => queryOptions({ queryKey: ['diagnostics'], queryFn: () => getDiagnostics(), refetchInterval: 30_000 })
export const integrationsQuery = () => queryOptions({ queryKey: ['integrations'], queryFn: () => getIntegrationSettings() })
