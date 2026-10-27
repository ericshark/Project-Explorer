import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, parseSettings } from './settings.ts'

describe('parseSettings', () => {
  it('starts both sections collapsed', () => {
    expect(parseSettings(null)).toEqual({ expandActivity: false, expandBranches: false })
  })

  it('reads saved values and falls back per field', () => {
    expect(parseSettings('{"expandActivity":true,"expandBranches":"yes"}')).toEqual({
      expandActivity: true,
      expandBranches: false,
    })
  })

  it('ignores corrupt storage', () => {
    expect(parseSettings('{nope')).toEqual(DEFAULT_SETTINGS)
  })
})
