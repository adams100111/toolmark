import { DEFAULT_PAIRING_PORT } from './pairing/constants.js'
import { DEFAULT_CALL_TIMEOUT_MS } from './pairing/ws-server.js'

/** First line of the CLI usage text. */
export const USAGE_LINE =
  'Usage: toolmark-mcp --allow-origin <origin> [--allow-origin <origin> …] [--port <n>] [--call-timeout <ms>]'

/** The full `--help` text. */
export const HELP_TEXT = `${USAGE_LINE}

Serves the tools of a paired Toolmark page to an MCP client over stdio.

Options:
  --allow-origin <origin>  Page origin allowed to pair, e.g. http://localhost:5173 (required, repeatable)
  --port <n>               Pairing WebSocket port on 127.0.0.1 (default ${DEFAULT_PAIRING_PORT}; 0 picks a free port)
  --call-timeout <ms>      Deadline of each page call (default ${DEFAULT_CALL_TIMEOUT_MS})
  --help                   Show this help
  --version                Show the version
`

/** Parsed command line of `toolmark-mcp`. */
export type CliArgs =
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'run'; allowOrigins: string[]; port: number; callTimeoutMs: number }
  | { kind: 'error'; message: string }

const MAX_TIMEOUT_MS = 2_147_483_647

function isExactOrigin(value: string): boolean {
  if (value === '*' || value === 'null') return false
  try {
    const origin = new URL(value).origin
    return origin !== 'null' && origin === value
  } catch {
    return false
  }
}

function integer(value: string): number | null {
  return /^\d+$/.test(value) ? Number(value) : null
}

/**
 * Parses `toolmark-mcp` arguments (spec §17 CLI flags). `--flag value` and `--flag=value` are both
 * accepted. `--help` / `--version` win over everything else.
 * @param argv - Arguments after the script path.
 */
export function parseArgs(argv: readonly string[]): CliArgs {
  if (argv.includes('--help')) return { kind: 'help' }
  if (argv.includes('--version')) return { kind: 'version' }
  const allowOrigins: string[] = []
  let port = DEFAULT_PAIRING_PORT
  let callTimeoutMs = DEFAULT_CALL_TIMEOUT_MS
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    const eq = arg.startsWith('--') ? arg.indexOf('=') : -1
    const flag = eq >= 0 ? arg.slice(0, eq) : arg
    const inline = eq >= 0 ? arg.slice(eq + 1) : undefined
    if (flag !== '--allow-origin' && flag !== '--port' && flag !== '--call-timeout') {
      return { kind: 'error', message: `Unknown argument: ${arg}` }
    }
    const value = inline ?? argv[++i]
    if (value === undefined) return { kind: 'error', message: `Missing value for ${flag}` }
    if (flag === '--allow-origin') {
      if (!isExactOrigin(value)) {
        return {
          kind: 'error',
          message: `--allow-origin must be an exact origin such as http://localhost:5173: ${value}`,
        }
      }
      allowOrigins.push(value)
    } else if (flag === '--port') {
      const n = integer(value)
      if (n === null || n > 65535) {
        return { kind: 'error', message: `--port must be an integer from 0 to 65535: ${value}` }
      }
      port = n
    } else {
      const n = integer(value)
      if (n === null || n <= 0 || n > MAX_TIMEOUT_MS) {
        return { kind: 'error', message: `--call-timeout must be a positive integer: ${value}` }
      }
      callTimeoutMs = n
    }
  }
  if (allowOrigins.length === 0) return { kind: 'error', message: '--allow-origin is required' }
  return { kind: 'run', allowOrigins, port, callTimeoutMs }
}
