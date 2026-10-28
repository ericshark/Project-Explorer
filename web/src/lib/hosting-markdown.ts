interface Node {
  type: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: Node[]
}

/** Assign IDs before React renders headings, so StrictMode cannot alter anchor names. */
export function hostingHeadings() {
  return (tree: Node) => {
    const used = new Set<string>()
    const text = (node: Node): string => node.value ?? node.children?.map(text).join('') ?? ''
    const visit = (node: Node) => {
      if (/^h[1-6]$/.test(node.tagName ?? '')) {
        const base =
          text(node)
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s-]/gu, '')
            .trim()
            .replace(/\s+/g, '-') || 'section'
        let id = base
        let suffix = 1
        while (used.has(id)) id = `${base}-${suffix++}`
        used.add(id)
        node.properties = { ...node.properties, id }
      }
      node.children?.forEach(visit)
    }
    visit(tree)
  }
}
