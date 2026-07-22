export function secureResponseCookies(request: Request, response: Response) {
  if (requestProtocol(request) !== 'https') return response
  const cookies = response.headers.getSetCookie()
  if (!cookies.length) return response
  const headers = new Headers(response.headers)
  headers.delete('set-cookie')
  for (const cookie of cookies) headers.append('set-cookie', /;\s*secure(?:;|$)/i.test(cookie) ? cookie : `${cookie}; Secure`)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

function requestProtocol(request: Request) {
  const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  if (forwarded === 'http' || forwarded === 'https') return forwarded
  return new URL(request.url).protocol.slice(0, -1)
}
