import { describe, expect, it } from 'vitest'
import { commitTime, fullDate } from './format.ts'

const HOUR = 60 * 60 * 1000

describe('commitTime', () => {
  it('stays relative for the first two days', () => {
    const when = Date.now() - 47 * HOUR
    expect(commitTime(when)).toBe('1d ago')
  })

  it('adds the date and time after two days', () => {
    const when = Date.now() - 49 * HOUR
    expect(commitTime(when)).toBe(`2d ago · ${fullDate(when)}`)
  })
})
