import { expect, it } from 'vitest'
import { hostingHeadings } from './hosting-markdown.ts'

it('assigns repeatable unique section IDs including duplicate and colliding headings', () => {
  const children = ['Run locally', 'Run locally', 'Run locally-1', 'Cost & limits'].map(
    (value) => ({
      type: 'element',
      tagName: 'h2',
      properties: {} as Record<string, unknown>,
      children: [{ type: 'text', value }],
    }),
  )
  const tree = { type: 'root', children }
  const render = hostingHeadings()
  render(tree)
  expect(children.map((n) => n.properties.id)).toEqual([
    'run-locally',
    'run-locally-1',
    'run-locally-1-1',
    'cost-limits',
  ])
  render(tree)
  expect(children[0].properties.id).toBe('run-locally')
})
