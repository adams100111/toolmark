import type { ChildProcess } from 'node:child_process'
import { handles } from './global-setup.js'

const SHUTDOWN_TIMEOUT_MS = 5000

/** SIGTERM, then SIGKILL after {@link SHUTDOWN_TIMEOUT_MS} if the process ignores it. */
function stop(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
    }, SHUTDOWN_TIMEOUT_MS)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    child.kill('SIGTERM')
  })
}

/** Stops `next dev` and `next start` — never leaves a dev/production server running. */
export default async function globalTeardown(): Promise<void> {
  await Promise.all([stop(handles.dev), stop(handles.start)])
}
