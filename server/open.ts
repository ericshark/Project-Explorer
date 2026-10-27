import { execFileSync, spawn } from 'node:child_process'
import type { HubMeta, OpenTarget } from '../shared/types.ts'

function which(command: string): string | null {
  try {
    return execFileSync('which', [command], { encoding: 'utf8' }).trim() || null
  } catch {
    return null
  }
}

const tools = {
  code: which('code'),
  explorer: which('explorer.exe'),
  wslpath: which('wslpath'),
  wt: which('wt.exe'),
}

export const capabilities: HubMeta['can'] = {
  vscode: Boolean(tools.code),
  explorer: Boolean(tools.explorer && tools.wslpath),
  terminal: Boolean(tools.wt && process.env.WSL_DISTRO_NAME),
}

function launch(command: string, args: string[]): void {
  const child = spawn(command, args, { detached: true, stdio: 'ignore' })
  child.on('error', (error) =>
    console.error(`[project-explorer] ${command} failed: ${error.message}`),
  )
  child.unref()
}

export function openIn(target: OpenTarget, path: string): void {
  switch (target) {
    case 'vscode':
      if (!tools.code) throw new Error('VS Code (`code`) is not on PATH')
      launch(tools.code, [path])
      return
    case 'explorer': {
      if (!tools.explorer || !tools.wslpath) throw new Error('Explorer is only available under WSL')
      const windowsPath = execFileSync(tools.wslpath, ['-w', path], { encoding: 'utf8' }).trim()
      // explorer.exe exits with 1 even when it opens the folder, so its exit code is ignored.
      launch(tools.explorer, [windowsPath])
      return
    }
    case 'terminal': {
      const distro = process.env.WSL_DISTRO_NAME
      if (!tools.wt || !distro) throw new Error('Windows Terminal is only available under WSL')
      // `;` separates Windows Terminal subcommands, so it has to be escaped inside the path.
      launch(tools.wt, [
        '-w',
        '0',
        'nt',
        'wsl.exe',
        '-d',
        distro,
        '--cd',
        path.replaceAll(';', '\\;'),
      ])
      return
    }
  }
}
