import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

/** `next dev` port (fixed by the M4 plan's port table). */
export const DEV_PORT = 3100
/** `next start` (production) port (fixed by the M4 plan's port table). */
export const START_PORT = 3101

// `localhost`, not `127.0.0.1`: Next.js 16 dev blocks cross-origin dev requests by default
// (`allowedDevOrigins`) unless the request's origin is `localhost`, and navigating via `127.0.0.1`
// silently breaks client hydration (no thrown error, no console message — verified by hand while
// debugging this task: the browser never installs `__toolmark_test__`/`__toolmark_agent__`,
// react-hook-form's client-only submit handler never attaches, so `next start` (no such guard) is
// unaffected either way). `next start` uses the same host for consistency.
/** Base URL of the running `next dev` server. */
export const DEV_URL = `http://localhost:${DEV_PORT}/`
/** Base URL of the running `next start` (production) server. */
export const START_URL = `http://localhost:${START_PORT}/`

const ROOT = path.resolve(import.meta.dirname, '..')
/** Where `next dev` / `next build` / `next start` output is appended (also `.gitignore`d). */
export const RESULTS_DIR = path.join(ROOT, 'test-results')

const READY_TIMEOUT_MS = 120_000
const BUILD_TIMEOUT_MS = 300_000
const POLL_INTERVAL_MS = 300

/** Long-running server handles started by {@link default}; `global-teardown.ts` stops them. */
export const handles: { dev?: ChildProcess; start?: ChildProcess } = {}

const NEXT_BIN = path.join(
  ROOT,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'next.cmd' : 'next',
)

// NEXT_TELEMETRY_DISABLED=1 for every spawned `next` process (brief "Exact values").
const ENV = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' }

function spawnLogged(args: string[], logName: string): ChildProcess {
  const log = createWriteStream(path.join(RESULTS_DIR, logName), { flags: 'a' })
  const child = spawn(NEXT_BIN, args, { cwd: ROOT, env: ENV, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout?.pipe(log)
  child.stderr?.pipe(log)
  return child
}

async function waitForReady(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  for (;;) {
    try {
      const res = await fetch(url)
      if (res.status < 500) return
    } catch (err) {
      lastError = err
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${url}${lastError ? `: ${String(lastError)}` : ''}`)
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
}

function runBuild(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawnLogged(['build'], 'next-build.log')
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`next build did not finish within ${BUILD_TIMEOUT_MS}ms`))
    }, BUILD_TIMEOUT_MS)
    child.once('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`next build exited with code ${String(code)}`))
    })
    child.once('error', (err) => {
      clearTimeout(timer)
      reject(err instanceof Error ? err : new Error(String(err)))
    })
  })
}

/**
 * Starts `next dev -p 3100`, then (after a fresh `next build`) `next start -p 3101`. Next.js 16
 * writes `next dev` output to `.next/dev`, separate from `next build`'s `.next` (verified against
 * the Next.js 16 upgrade docs), so the two run concurrently without a custom `distDir`. Output is
 * appended to `test-results/next-{dev,build,start}.log`; `global-teardown.ts` stops both servers.
 */
export default async function globalSetup(): Promise<void> {
  await mkdir(RESULTS_DIR, { recursive: true })
  handles.dev = spawnLogged(['dev', '-p', String(DEV_PORT)], 'next-dev.log')
  await runBuild()
  handles.start = spawnLogged(['start', '-p', String(START_PORT)], 'next-start.log')
  await Promise.all([
    waitForReady(DEV_URL, READY_TIMEOUT_MS),
    waitForReady(START_URL, READY_TIMEOUT_MS),
  ])
}
