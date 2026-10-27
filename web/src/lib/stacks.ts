/** Fixed color per stack bucket, so a stack keeps its color whatever else is on the chart. */
const STACK_COLORS: Record<string, string> = {
  'Full-stack (Python + JS)': 'var(--stack-fullstack)',
  'Next.js': 'var(--stack-next)',
  'Vite + React': 'var(--stack-vite-react)',
  Python: 'var(--stack-python)',
  Node: 'var(--stack-node)',
  Vite: 'var(--stack-vite)',
}

export function stackColor(name: string): string {
  return STACK_COLORS[name] ?? 'var(--stack-other)'
}
