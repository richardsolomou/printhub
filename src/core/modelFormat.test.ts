import { describe, expect, it } from 'vitest'
import { modelFormatLabel, modelUploadRejection } from './modelFormat'

describe('modelFormatLabel', () => {
  it('labels both supported model formats', () => {
    expect([modelFormatLabel('stl'), modelFormatLabel('3mf')]).toEqual(['STL', '3MF'])
  })
})

describe('modelUploadRejection', () => {
  it('uses the server 3MF archive limit', () => {
    expect(modelUploadRejection({ name: 'model.3mf', size: 128 * 1024 * 1024 })).toBeUndefined()
    expect(modelUploadRejection({ name: 'model.3mf', size: 128 * 1024 * 1024 + 1 })).toBe('model.3mf (over the 128 MiB 3MF limit)')
  })

  it('retains the larger STL limit', () => {
    expect(modelUploadRejection({ name: 'model.stl', size: 128 * 1024 * 1024 + 1 })).toBeUndefined()
    expect(modelUploadRejection({ name: 'model.stl', size: 1024 * 1024 * 1024 + 1 })).toBe('model.stl (over the 1 GiB STL limit)')
  })
})
