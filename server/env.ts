import { loadEnvFile } from 'node:process'
import { fileURLToPath } from 'node:url'

/** Resolve from the repository so starting from another directory still finds local settings. */
export function loadPrivateEnv(
  path = fileURLToPath(new URL('../private.env', import.meta.url)),
): void {
  try {
    // Node preserves variables already supplied by the calling shell.
    loadEnvFile(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}
