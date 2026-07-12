import { getRequest } from '@tanstack/react-start/server'
import { validSameOriginRequest } from './sameOrigin'

export function requireMutationOrigin(request = getRequest()) {
  if (!validSameOriginRequest(request)) {
    throw new Response('cross-origin mutation rejected', { status: 403 })
  }
}
