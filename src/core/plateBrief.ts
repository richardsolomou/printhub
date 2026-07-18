export type PlateBriefItem = {
  requestId: string
  count: number
}

export function parsePlateBrief(value?: string): PlateBriefItem[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed
      .flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const requestId = 'requestId' in item && typeof item.requestId === 'string' ? item.requestId.trim() : ''
        const count = 'count' in item && typeof item.count === 'number' ? Math.floor(item.count) : 0
        return requestId && count > 0 ? [{ requestId, count: Math.min(count, 999) }] : []
      })
      .slice(0, 100)
  } catch {
    return []
  }
}

export function serializePlateBrief(items: PlateBriefItem[]) {
  return JSON.stringify(items)
}

export function plateBriefCopyIds(items: PlateBriefItem[]) {
  return items.flatMap((item) => Array.from({ length: item.count }, (_, index) => `${item.requestId}:${index + 1}`))
}
