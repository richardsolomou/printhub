import { describe, expect, it } from 'vitest'
import { workflow } from './workflow'

describe('resin workflow', () => {
  it('tracks a print through resin post-processing', () => {
    expect(workflow.statuses.map((status) => status.id)).toEqual(['todo', 'in_progress', 'post_processing', 'done'])
  })
})
