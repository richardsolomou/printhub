import { describe, expect, it } from 'vitest'
import { parsePlateBrief, plateBriefCopyIds, serializePlateBrief } from './plateBrief'

describe('plate brief', () => {
  it('round trips selected request copy counts', () => {
    const items = [
      { requestId: 'first', count: 2 },
      { requestId: 'second', count: 1 },
    ]

    expect(parsePlateBrief(serializePlateBrief(items))).toEqual(items)
  })

  it('expands request counts into planner copy ids', () => {
    expect(plateBriefCopyIds([{ requestId: 'model', count: 3 }])).toEqual(['model:1', 'model:2', 'model:3'])
  })

  it('rejects malformed entries', () => {
    expect(
      parsePlateBrief(
        JSON.stringify([
          { requestId: '', count: 2 },
          { requestId: 'valid', count: 0 },
        ]),
      ),
    ).toEqual([])
  })
})
