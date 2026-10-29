import { describe, expect, it } from 'vitest'
import { displayMyPhone, normalizeMyPhone } from './phone'

describe('normalizeMyPhone', () => {
  it('accepts the ways parents type a mobile number', () => {
    expect(normalizeMyPhone('012-345 6789')).toBe('+60123456789')
    expect(normalizeMyPhone('+60 12 345 6789')).toBe('+60123456789')
    expect(normalizeMyPhone('60123456789')).toBe('+60123456789')
    expect(normalizeMyPhone('011-2345 6789')).toBe('+601123456789')
  })

  it('rejects landlines, short numbers and foreign numbers', () => {
    expect(normalizeMyPhone('03-1234 5678')).toBeNull()
    expect(normalizeMyPhone('012345')).toBeNull()
    expect(normalizeMyPhone('+65 9123 4567')).toBeNull()
  })
})

describe('displayMyPhone', () => {
  it('formats for display', () => {
    expect(displayMyPhone('+60123456789')).toBe('012-345 6789')
    expect(displayMyPhone('+601123456789')).toBe('011-2345 6789')
  })
})
