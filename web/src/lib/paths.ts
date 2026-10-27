/** Resolves a link inside a doc against the doc's own folder (POSIX paths, repo-relative). */
export function resolveRelative(fromDoc: string, target: string): string | null {
  const base = fromDoc.split('/').slice(0, -1)
  const parts = target.startsWith('/') ? [] : base
  for (const segment of target.replace(/^\//, '').split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (parts.length === 0) return null
      parts.pop()
    } else {
      parts.push(segment)
    }
  }
  return parts.join('/')
}
