import { getRequest } from '@tanstack/react-start/server'

export function requireMutationOrigin(request = getRequest()) {
  if (process.env.AUTH_PROVIDER === 'trusted-header') return
  const origin = request.headers.get('origin')
  const site = request.headers.get('sec-fetch-site')
  if (origin !== new URL(request.url).origin || (site && site !== 'same-origin')) {
    throw new Response('cross-origin mutation rejected', { status: 403 })
  }
}
