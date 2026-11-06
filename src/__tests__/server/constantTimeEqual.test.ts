import { describe, expect, it } from 'bun:test'
import { constantTimeEqual } from '../../../server/security/constantTimeEqual'

describe('constantTimeEqual', () => {
  it('compares equal-length UTF-8 strings and rejects different values or lengths', () => {
    expect(constantTimeEqual('token', 'token')).toBe(true)
    expect(constantTimeEqual('token', 't0ken')).toBe(false)
    expect(constantTimeEqual('é', 'é')).toBe(true)
    expect(constantTimeEqual('é', 'e')).toBe(false)
  })
})
