import { createConnection, createServer } from 'node:net'

function canListen(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', (error: NodeJS.ErrnoException) => {
      // No IPv6 on this machine means nothing can be holding the port there.
      resolve(error.code === 'EADDRNOTAVAIL' || error.code === 'EAFNOSUPPORT')
    })
    server.listen({ port, host, exclusive: true }, () => server.close(() => resolve(true)))
  })
}

/**
 * Dev servers bind to 127.0.0.1, ::1 or a wildcard depending on how `localhost` resolves,
 * so a port only counts as free when both loopback families can take it.
 */
export async function isPortFree(port: number): Promise<boolean> {
  return (await canListen(port, '127.0.0.1')) && (await canListen(port, '::1'))
}

/** Returns the first free port at or above `start` that isn't in `reserved`. */
export async function findFreePort(
  start: number,
  reserved: Set<number> = new Set(),
): Promise<number> {
  for (let port = start; port < start + 200 && port <= 65535; port++) {
    if (!reserved.has(port) && (await isPortFree(port))) return port
  }
  throw new Error(`No free port found between ${start} and ${start + 199}`)
}

/** A just-stopped dev server can take a moment to release its port; waits for it to come free. */
export async function waitForFreePort(port: number, timeoutMs = 2000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (!(await isPortFree(port))) {
    if (Date.now() > deadline) return false
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return true
}

function canConnect(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host })
    const done = (ok: boolean) => {
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(400, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

export async function isPortAccepting(port: number): Promise<boolean> {
  return (await canConnect(port, '127.0.0.1')) || (await canConnect(port, '::1'))
}
