import { realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import type { MiddlewareHandler } from 'hono'

export class HttpError extends Error {
  status: 400 | 403 | 404 | 409 | 500

  constructor(status: 400 | 403 | 404 | 409 | 500, message: string) {
    super(message)
    this.status = status
  }
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

function hostname(host: string): string {
  return host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]
}

/**
 * The hub can launch commands, so only same-origin pages served from loopback may drive it.
 * The Host check stops DNS rebinding; the Origin check stops other sites (and other local dev
 * servers) from POSTing to it.
 */
export const localOnly: MiddlewareHandler = async (c, next) => {
  const host = c.req.header('host') ?? ''
  if (!LOOPBACK_HOSTS.has(hostname(host))) {
    return c.json({ error: 'The hub only answers on localhost' }, 403)
  }
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    const origin = c.req.header('origin')
    if (origin !== `http://${host}`) {
      return c.json({ error: 'Cross-origin requests are not allowed' }, 403)
    }
  }
  await next()
}

/** Resolves `rel` inside `root`, following symlinks, and refuses anything that escapes it. */
export function safeJoin(root: string, rel: string): string {
  if (!rel || isAbsolute(rel)) throw new HttpError(400, 'Expected a relative path')
  let realRoot: string
  let target: string
  try {
    realRoot = realpathSync(root)
    target = realpathSync(resolve(root, rel))
  } catch {
    throw new HttpError(404, 'File not found')
  }
  const fromRoot = relative(realRoot, target)
  if (!fromRoot || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new HttpError(403, 'Path is outside the project')
  }
  return target
}
