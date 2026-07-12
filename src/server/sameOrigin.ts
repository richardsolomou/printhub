function configuredOrigins() {
  return [process.env.BETTER_AUTH_URL, ...(process.env.BETTER_AUTH_TRUSTED_ORIGINS?.split(',') ?? [])]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => {
      try {
        return [new URL(value).origin]
      } catch {
        return []
      }
    })
}

export function validSameOriginRequest(request: Request) {
  const origin = request.headers.get('origin')
  const site = request.headers.get('sec-fetch-site')
  if (!origin || (site && site !== 'same-origin')) return false
  return [new URL(request.url).origin, ...configuredOrigins()].includes(origin)
}
