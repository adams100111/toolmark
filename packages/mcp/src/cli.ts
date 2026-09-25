import { readFileSync } from 'node:fs'

// `toolmark-mcp`: stdout carries only MCP frames once serving; every diagnostic goes to stderr.

/** Longest diagnostic line written for an `onerror` report. */
const MAX_ERROR_LINE = 500
/** Time allowed for an orderly shutdown before the process exits anyway. */
const SHUTDOWN_DEADLINE_MS = 3000

/** Anything started during `main()` that needs an orderly close on shutdown. */
interface Closeable {
  close(): Promise<void>
}

// Install the signal/stdin handlers as the very first thing this module does — before importing
// anything else — so a signal delivered at any point, including while the rest of the module
// graph (the pairing server's `ws` dependency, the MCP SDK) is still loading, or while the
// pairing/MCP servers are still starting, reaches this graceful shutdown path (exit 0) instead of
// Node's default action for SIGINT/SIGTERM (killed by signal, exit code/signalCode null). Loading
// those dependencies and starting the servers is exactly the "import-heavy setup" this guards
// against: `resources` is filled in as each piece finishes starting, and `shutdown` closes
// whatever already exists.
const resources: { pairing?: Closeable; mcp?: Closeable } = {}
let stopping = false
const shutdown = (): void => {
  if (stopping) return
  stopping = true
  setTimeout(() => process.exit(0), SHUTDOWN_DEADLINE_MS).unref()
  void (async () => {
    try {
      await resources.mcp?.close()
    } catch {
      // Closing a finished transport may throw; the process exits anyway.
    }
    try {
      await resources.pairing?.close()
    } catch {
      // Best-effort close; the process exits anyway.
    }
    process.exit(0)
  })()
}
process.stdin.on('end', shutdown)
process.stdin.on('close', shutdown)
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

function packageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version?: unknown
    }
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

function errorLine(e: Error): string {
  const text = `Toolmark MCP: ${e.message}`.replace(/[\r\n]+/g, ' ')
  return text.length > MAX_ERROR_LINE ? `${text.slice(0, MAX_ERROR_LINE)}…` : text
}

async function main(): Promise<void> {
  // Deferred until after the handlers above are installed: `./args.js` transitively imports the
  // pairing server (for `DEFAULT_CALL_TIMEOUT_MS`), which imports the `ws` package.
  const { HELP_TEXT, parseArgs, USAGE_LINE } = await import('./args.js')

  const args = parseArgs(process.argv.slice(2))
  if (args.kind === 'help') {
    process.stdout.write(HELP_TEXT)
    return
  }
  if (args.kind === 'version') {
    process.stdout.write(`${packageVersion()}\n`)
    return
  }
  if (args.kind === 'error') {
    process.stderr.write(`${USAGE_LINE}\n${args.message}\n`)
    process.exitCode = 2
    return
  }
  if (stopping) return

  const { createPairingServer } = await import('./pairing/ws-server.js')

  let pairing: Awaited<ReturnType<typeof createPairingServer>>
  try {
    pairing = await createPairingServer({
      port: args.port,
      allowOrigins: args.allowOrigins,
      callTimeoutMs: args.callTimeoutMs,
      stderr: process.stderr,
    })
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    process.stderr.write(
      err.code === 'EADDRINUSE'
        ? `Toolmark: port ${args.port} is in use; pass --port <other>\n`
        : `${errorLine(err instanceof Error ? err : new Error(String(err)))}\n`,
    )
    process.exit(1)
  }
  resources.pairing = pairing
  // A signal already arrived while the pairing server was starting; `shutdown` picked up
  // `resources.pairing` above (or will on its next microtask) and is closing it — don't also
  // start the MCP server.
  if (stopping) return

  const { startMcpServer } = await import('./server/server.js')
  resources.mcp = startMcpServer({
    link: pairing.link,
    version: packageVersion(),
    onerror: (e) => {
      process.stderr.write(`${errorLine(e)}\n`)
    },
  })
}

void main()
