import type { ProjectSummary } from '../../../shared/types.ts'

export function groupProjects(projects: ProjectSummary[]): [string, ProjectSummary[]][] {
  const groups = new Map<string, ProjectSummary[]>()
  for (const project of projects) {
    const list = groups.get(project.group) ?? []
    list.push(project)
    groups.set(project.group, list)
  }
  // Top-level repos first, then folders alphabetically.
  return [...groups.entries()].sort(([a], [b]) =>
    a === '' ? -1 : b === '' ? 1 : a.localeCompare(b),
  )
}
