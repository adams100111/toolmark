import { readFileSync } from 'node:fs'
import { HELP_TEXT, parseArgs, USAGE_LINE } from './args.js'
import { createPairingServer, type PairingServer } from './pairing/ws-server.js'
import { startMcpServer } from './server/server.js'

// `toolmark-mcp`: stdout carries only MCP frames once serving; every diagnostic goes to stderr.

/** Longest diagnostic line written for an `onerror` report. */
const MAX_ERROR_LINE = 500
/** Time allowed for an orderly shutdown before the process exits anyway. */
const SHUTDOWN_DEADLINE_MS = 3000

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

  let pairing: PairingServer
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

  const mcp = startMcpServer({
    link: pairing.link,
    version: packageVersion(),
    onerror: (e) => {
      process.stderr.write(`${errorLine(e)}\n`)
    },
  })

  let stopping = false
  const shutdown = (): void => {
    if (stopping) return
    stopping = true
    setTimeout(() => process.exit(0), SHUTDOWN_DEADLINE_MS).unref()
    void (async () => {
      try {
        await mcp.close()
      } catch {
        // Closing a finished transport may throw; the process exits anyway.
      }
      await pairing.close()
      process.exit(0)
    })()
  }
  process.stdin.on('end', shutdown)
  process.stdin.on('close', shutdown)
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

void main()
