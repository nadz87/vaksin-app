import { describe, expect, it } from 'vitest'
import { formatMyKid, fullYear, parseMyKid } from './mykid'

const today = new Date('2026-10-29T00:00:00Z')

describe('formatMyKid', () => {
  it('adds dashes while typing', () => {
    expect(formatMyKid('150312')).toBe('150312')
    expect(formatMyKid('1503121')).toBe('150312-1')
    expect(formatMyKid('150312101235')).toBe('150312-10-1235')
    expect(formatMyKid('150312-10-1235999')).toBe('150312-10-1235')
  })
})

describe('fullYear', () => {
  it('maps a primary/secondary school child to the 2000s', () => {
    expect(fullYear(15, today)).toBe(2015)
    expect(fullYear(20, today)).toBe(2020)
  })

  it('never returns a year in the future', () => {
    for (let yy = 0; yy <= 99; yy++) {
      expect(fullYear(yy, today)).toBeLessThanOrEqual(2026)
    }
  })
})

describe('parseMyKid', () => {
  it('reads DOB and gender (odd last digit = male)', () => {
    expect(parseMyKid('150312-10-1235', today)).toEqual({
      digits: '150312101235',
      dob: '2015-03-12',
      gender: 'male',
    })
    expect(parseMyKid('170601141234', today)?.gender).toBe('female')
  })

  it('rejects incomplete numbers and impossible dates', () => {
    expect(parseMyKid('15031210', today)).toBeNull()
    expect(parseMyKid('150231101235', today)).toBeNull() // 31 Feb
    expect(parseMyKid('151301101235', today)).toBeNull() // month 13
  })
})
