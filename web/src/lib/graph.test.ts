import { describe, expect, it } from 'vitest'
import { assignBranches, BRANCH_COLOR_COUNT, branchColors, layoutGraph } from './graph.ts'

const c = (hash: string, ...parents: string[]) => ({ hash, parents })

describe('layoutGraph', () => {
  it('keeps linear history in one lane', () => {
    const layout = layoutGraph([c('c', 'b'), c('b', 'a'), c('a')])
    expect(layout.lanes).toEqual([0, 0, 0])
    expect(layout.laneCount).toBe(1)
    expect(layout.edges).toEqual([
      { parentIndex: 0, fromRow: 0, fromLane: 0, viaLane: 0, toRow: 1, toLane: 0 },
      { parentIndex: 0, fromRow: 1, fromLane: 0, viaLane: 0, toRow: 2, toLane: 0 },
    ])
  })

  it('gives a second branch tip its own lane until it joins its parent', () => {
    // main: m2 -> base, feature: f1 -> base
    const layout = layoutGraph([c('m2', 'base'), c('f1', 'base'), c('base')])
    expect(layout.lanes).toEqual([0, 1, 0])
    expect(layout.edges[1]).toEqual({
      parentIndex: 0,
      fromRow: 1,
      fromLane: 1,
      viaLane: 1,
      toRow: 2,
      toLane: 0,
    })
  })

  it('reserves a lane for the second parent of a merge', () => {
    const layout = layoutGraph([
      c('merge', 'm1', 'f1'),
      c('f1', 'base'),
      c('m1', 'base'),
      c('base'),
    ])
    expect(layout.lanes).toEqual([0, 1, 0, 0])
    const toFeature = layout.edges.find((e) => e.fromRow === 0 && e.toRow === 1)
    expect(toFeature).toMatchObject({ parentIndex: 1, viaLane: 1, toLane: 1 })
    expect(layout.laneCount).toBe(2)
  })

  it('runs edges to parents outside the loaded history off the bottom', () => {
    const layout = layoutGraph([c('b', 'a')])
    expect(layout.edges).toEqual([
      { parentIndex: 0, fromRow: 0, fromLane: 0, viaLane: 0, toRow: 1, toLane: 0 },
    ])
  })
})

describe('assignBranches', () => {
  const opts = { current: 'feature', defaultBranch: 'main' }
  // main: m2 -> base; feature: f2 -> f1 -> base; origin/main is at m2 too.
  const commits = [c('f2', 'f1'), c('m2', 'base'), c('f1', 'base'), c('base')]
  const tip = (key: string, head: string, remote = false) => ({ key, head, remote })

  it('gives each commit to the first branch whose first-parent chain reaches it', () => {
    const owners = assignBranches(commits, [tip('main', 'm2'), tip('feature', 'f2')], opts)
    expect(owners).toEqual(['feature', 'main', 'feature', 'feature'])
  })

  it('lets the default branch beat other local branches, and a remote share its local key', () => {
    const owners = assignBranches(
      commits,
      [tip('other', 'f2'), tip('main', 'm2'), tip('main', 'm2', true)],
      { current: null, defaultBranch: 'main' },
    )
    // base is reachable from both, but the default branch is walked first and keeps it.
    expect(owners).toEqual(['other', 'main', 'other', 'main'])
    const shared = assignBranches(
      [c('m1', 'base'), c('base')],
      [tip('x', 'm1'), tip('main', 'm1')],
      {
        current: null,
        defaultBranch: 'main',
      },
    )
    expect(shared).toEqual(['main', 'main'])
  })

  it('leaves commits no branch reaches unowned', () => {
    expect(assignBranches([c('orphan', 'gone')], [], opts)).toEqual([null])
  })
})

describe('branchColors', () => {
  it('always gives the default branch the first color', () => {
    expect(branchColors(['zeta', 'main', 'alpha'], 'main').get('main')).toBe(0)
  })

  it('does not depend on the order branches are listed in', () => {
    const keys = ['feat/a', 'feat/b', 'main', 'fix']
    expect([...branchColors(keys, 'main')]).toEqual([...branchColors([...keys].reverse(), 'main')])
  })

  it('uses distinct colors until they run out, then repeats', () => {
    const few = branchColors(['main', 'a', 'b', 'c', 'd'], 'main')
    expect(new Set(few.values()).size).toBe(BRANCH_COLOR_COUNT)
    const many = branchColors(
      Array.from({ length: 12 }, (_, i) => `branch-${i}`),
      null,
    )
    expect(many.size).toBe(12)
    expect([...many.values()].every((slot) => slot >= 0 && slot < BRANCH_COLOR_COUNT)).toBe(true)
  })
})
