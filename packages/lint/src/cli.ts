import { parseArgs } from 'node:util'
import { collectFromUrl, LintUsageError } from './collect.js'
import { formatFindings } from './format.js'
import { loadJudge } from './judge.js'
import { readManifestFile } from './manifest-file.js'
import { lint, type LintOptions } from './run.js'
import type { Judge, ManifestFile } from './types.js'

/** `toolmark lint`'s exit codes (M4 plan, Global constraints). */
export const EXIT_OK = 0
export const EXIT_ERRORS_FOUND = 1
export const EXIT_USAGE_OR_RUNTIME_FAILURE = 2

/** The only accepted positional subcommand; `toolmark <this> ...` and bare `toolmark ...` both work. */
const SUBCOMMAND = 'lint'

function usage(): string {
  return (
    'Usage: toolmark lint [options]\n\n' +
    'Options:\n' +
    '  --manifest <file>        Lint a manifest file (repeatable)\n' +
    '  --url <url>              Lint tools collected from a live page (repeatable)\n' +
    '  --storage-state <file>   Playwright storage state for --url\n' +
    '  --judge <spec>           Load a judge module (repeatable)\n' +
    '  --budget <n>             Tool-budget threshold: max tools per page before the\n' +
    '                           tool-budget rule warns (positive integer, default: 40)\n' +
    '  --format <pretty|json>   Output format (default: pretty)\n' +
    '  --help                   Show this help\n'
  )
}

/** Runs `toolmark lint` for `argv` (after the script path); writes to `stdout`/`stderr`. */
export async function runCli(
  argv: readonly string[],
  io: { stdout: (s: string) => void; stderr: (s: string) => void } = {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
  },
): Promise<number> {
  // `toolmark lint ...` and bare `toolmark ...` both work: strip a single leading `lint`
  // subcommand token before parsing flags. Any other positional (leading or otherwise) is
  // rejected below by `allowPositionals: false`, and the usage text lists `lint` as the
  // only accepted one.
  const rest = argv[0] === SUBCOMMAND ? argv.slice(1) : argv

  let values: {
    manifest?: string[]
    url?: string[]
    'storage-state'?: string
    judge?: string[]
    budget?: string
    format?: string
    help?: boolean
  }
  try {
    ;({ values } = parseArgs({
      args: rest,
      options: {
        manifest: { type: 'string', multiple: true },
        url: { type: 'string', multiple: true },
        'storage-state': { type: 'string' },
        judge: { type: 'string', multiple: true },
        budget: { type: 'string' },
        format: { type: 'string' },
        help: { type: 'boolean' },
      },
      allowPositionals: false,
    }))
  } catch (e) {
    io.stderr(`${usage()}\n${e instanceof Error ? e.message : String(e)}\n`)
    return EXIT_USAGE_OR_RUNTIME_FAILURE
  }

  if (values.help) {
    io.stdout(`${usage()}\n`)
    return EXIT_OK
  }

  const format = values.format ?? 'pretty'
  if (format !== 'pretty' && format !== 'json') {
    io.stderr(`--format must be "pretty" or "json": ${format}\n`)
    return EXIT_USAGE_OR_RUNTIME_FAILURE
  }

  if ((values.manifest ?? []).length === 0 && (values.url ?? []).length === 0) {
    io.stderr(`${usage()}\nNothing to lint: pass --manifest <file> and/or --url <url>\n`)
    return EXIT_USAGE_OR_RUNTIME_FAILURE
  }

  let budget: number | undefined
  if (values.budget !== undefined) {
    const n = Number(values.budget)
    if (!Number.isInteger(n) || n <= 0) {
      io.stderr(`--budget must be a positive integer: ${values.budget}\n`)
      return EXIT_USAGE_OR_RUNTIME_FAILURE
    }
    budget = n
  }

  const manifests: ManifestFile[] = []
  for (const file of values.manifest ?? []) {
    try {
      manifests.push(...(await readManifestFile(file)))
    } catch (e) {
      io.stderr(`${e instanceof Error ? e.message : String(e)}\n`)
      return EXIT_USAGE_OR_RUNTIME_FAILURE
    }
  }

  for (const url of values.url ?? []) {
    try {
      const storageStatePath = values['storage-state']
      manifests.push(
        await collectFromUrl(url, storageStatePath !== undefined ? { storageStatePath } : {}),
      )
    } catch (e) {
      if (e instanceof LintUsageError) {
        io.stderr(`${e.message}\n`)
        return EXIT_USAGE_OR_RUNTIME_FAILURE
      }
      throw e
    }
  }

  const judges: Judge[] = []
  for (const spec of values.judge ?? []) {
    try {
      judges.push(await loadJudge(spec))
    } catch (e) {
      if (e instanceof LintUsageError) {
        io.stderr(`${e.message}\n`)
        return EXIT_USAGE_OR_RUNTIME_FAILURE
      }
      throw e
    }
  }

  const options: LintOptions = { manifests, judges }
  if (budget !== undefined) options.budget = budget
  const findings = await lint(options)
  io.stdout(`${formatFindings(findings, format)}\n`)
  return findings.some((f) => f.severity === 'error') ? EXIT_ERRORS_FOUND : EXIT_OK
}

/**
 * The `toolmark` bin's entry: runs {@link runCli} on `process.argv` and sets `process.exitCode`.
 * Called unconditionally by `bin.ts` (the published bin target), so it works through npm/npx
 * `.bin` symlinks; this module itself never runs anything on import.
 */
export async function main(): Promise<void> {
  try {
    process.exitCode = await runCli(process.argv.slice(2))
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`)
    process.exitCode = EXIT_USAGE_OR_RUNTIME_FAILURE
  }
}
