import { describe, expect, it } from 'vitest'
import { isEmbedded } from './embed'

describe('isEmbedded', () => {
  it('can be forced on or off with ?embed', () => {
    expect(isEmbedded('?embed=1')).toBe(true)
    expect(isEmbedded('?embed=true')).toBe(true)
    expect(isEmbedded('?embed=0')).toBe(false)
    expect(isEmbedded('?embed=false')).toBe(false)
  })

  it('ignores other query parameters', () => {
    expect(isEmbedded('?foo=1&embed=0')).toBe(false)
  })
})
