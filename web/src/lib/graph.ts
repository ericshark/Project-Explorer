export interface GraphEdge {
  /** Which of the child's parents this edge leads to; 0 is the first parent. */
  parentIndex: number
  fromRow: number
  fromLane: number
  /** Lane the edge runs down between the two rows. */
  viaLane: number
  /** Equal to the row count when the parent is past the end of the loaded history. */
  toRow: number
  toLane: number
}

export interface GraphLayout {
  lanes: number[]
  edges: GraphEdge[]
  laneCount: number
}

/**
 * Assigns each commit (in topo order, newest first) a lane, the way `git log --graph` does: a
 * commit takes the lowest lane reserved for it by a child, its first parent inherits that lane,
 * and extra parents of a merge reuse a lane already waiting for them or reserve a free one. A
 * reserved lane stays taken until its commit shows up, so an edge never crosses a node.
 */
export function layoutGraph(commits: { hash: string; parents: string[] }[]): GraphLayout {
  const rowOf = new Map(commits.map((commit, row) => [commit.hash, row]))
  // reserved[lane] is the hash that lane is waiting for.
  const reserved: (string | null)[] = []
  const lanes: number[] = []
  const pending: {
    parentIndex: number
    fromRow: number
    fromLane: number
    viaLane: number
    parent: string
  }[] = []

  const freeLane = () => {
    const index = reserved.indexOf(null)
    if (index !== -1) return index
    reserved.push(null)
    return reserved.length - 1
  }

  commits.forEach((commit, row) => {
    let lane = reserved.indexOf(commit.hash)
    if (lane === -1) lane = freeLane()
    // Other children waiting for this commit in other lanes merge into it here.
    for (let i = 0; i < reserved.length; i++) if (reserved[i] === commit.hash) reserved[i] = null
    lanes[row] = lane

    commit.parents.forEach((parent, index) => {
      // The first parent continues this lane even if another lane already waits for it; the
      // lanes converge when the parent's row is reached.
      let via = index === 0 ? lane : reserved.indexOf(parent)
      if (via === -1) via = freeLane()
      reserved[via] = parent
      pending.push({ parentIndex: index, fromRow: row, fromLane: lane, viaLane: via, parent })
    })
  })

  const edges = pending.map(({ parentIndex, fromRow, fromLane, viaLane, parent }) => {
    const toRow = rowOf.get(parent)
    return toRow === undefined
      ? { parentIndex, fromRow, fromLane, viaLane, toRow: commits.length, toLane: viaLane }
      : { parentIndex, fromRow, fromLane, viaLane, toRow, toLane: lanes[toRow] }
  })
  return { lanes, edges, laneCount: Math.max(1, reserved.length) }
}

/** How many distinct branch colors there are (`--branch-1` … in styles.css). */
export const BRANCH_COLOR_COUNT = 5

interface BranchTip {
  /** Local name; a remote branch passes the name of its local counterpart (`origin/x` → `x`). */
  key: string
  head: string
  remote: boolean
}

/**
 * Names the branch each commit belongs to: the first branch, in priority order (the checked-out
 * one, the default branch, other local branches, then remote ones), whose first-parent chain
 * reaches it. Commits no branch reaches (history of deleted branches) get null. A remote branch
 * shares its local counterpart's key, so `main` and `origin/main` are one branch.
 */
export function assignBranches(
  commits: { hash: string; parents: string[] }[],
  tips: BranchTip[],
  { current, defaultBranch }: { current: string | null; defaultBranch: string | null },
): (string | null)[] {
  const byHash = new Map(commits.map((commit, row) => [commit.hash, row]))
  const rank = (tip: BranchTip) =>
    tip.remote ? 3 : tip.key === current ? 0 : tip.key === defaultBranch ? 1 : 2
  const owner: (string | null)[] = commits.map(() => null)
  // Array.sort is stable, so equal ranks keep the caller's order (most recent first).
  for (const tip of [...tips].sort((a, b) => rank(a) - rank(b))) {
    let row = byHash.get(tip.head)
    while (row !== undefined && owner[row] === null) {
      owner[row] = tip.key
      row = byHash.get(commits[row].parents[0])
    }
  }
  return owner
}

function hashSlot(key: string): number {
  let hash = 0
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash % BRANCH_COLOR_COUNT
}

/**
 * Gives every branch a color slot (0-based). The default branch always gets slot 0; the rest
 * start from a hash of their name, so a branch tends to keep its color between visits, and move
 * on to the next free slot when taken. Past `BRANCH_COLOR_COUNT` branches, colors repeat.
 */
export function branchColors(keys: string[], defaultBranch: string | null): Map<string, number> {
  const slots = new Map<string, number>()
  const used = new Set<number>()
  const assign = (key: string, preferred: number) => {
    let slot = preferred
    for (let i = 0; i < BRANCH_COLOR_COUNT && used.has(slot); i++) {
      slot = (slot + 1) % BRANCH_COLOR_COUNT
    }
    if (used.has(slot)) slot = preferred
    used.add(slot)
    slots.set(key, slot)
  }
  const unique = [...new Set(keys)].sort()
  if (defaultBranch && unique.includes(defaultBranch)) assign(defaultBranch, 0)
  for (const key of unique) if (!slots.has(key)) assign(key, hashSlot(key))
  return slots
}
