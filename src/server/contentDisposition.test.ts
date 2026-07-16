import { describe, expect, it } from 'vitest'
import { attachmentContentDisposition } from './contentDisposition'

describe('attachmentContentDisposition', () => {
  it('removes controls and emits ASCII plus RFC 5987 filenames', () => {
    expect(attachmentContentDisposition('résumé\r\n"model".3mf')).toBe(
      `attachment; filename="r_sum__model_.3mf"; filename*=UTF-8''r%C3%A9sum%C3%A9%22model%22.3mf`,
    )
  })

  it('falls back when the filename contains only controls', () => {
    expect(attachmentContentDisposition('\u0000\r\n')).toBe(`attachment; filename="model"; filename*=UTF-8''model`)
  })
})
