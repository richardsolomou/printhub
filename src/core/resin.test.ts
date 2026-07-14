import { describe, expect, it } from 'vitest'
import { formatResinMl, resinVolumeMl, summarizeResinMl } from './resin'

describe('resin volume metrics', () => {
  const printer = { id: 'resin', name: 'Resin printer' }

  it('calculates resin for the copies represented by a card', () => {
    expect(resinVolumeMl({ estimatedResinMl: 4.25, printer }, 3)).toBe(12.75)
  })

  it('does not present zero volume from an open mesh as zero resin', () => {
    expect(resinVolumeMl({ estimatedResinMl: 0, printer })).toBeUndefined()
  })

  it('does not show unassigned model volume as production resin', () => {
    expect(resinVolumeMl({ estimatedResinMl: 4.25 })).toBeUndefined()
  })

  it('keeps unknown copies separate from the known backlog volume', () => {
    expect(
      summarizeResinMl([
        { request: { estimatedResinMl: 4.25, printer }, count: 3 },
        { request: { printer }, count: 2 },
        { request: { estimatedResinMl: 20 }, count: 4 },
      ]),
    ).toEqual({ knownMl: 12.75, unknownCopies: 2, resinCopies: 5 })
  })

  it('shows useful precision for small and large estimates', () => {
    expect([formatResinMl(0.04), formatResinMl(4.25), formatResinMl(123.6)]).toEqual(['<0.1', '4.3', '124'])
  })
})
