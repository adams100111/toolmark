#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
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

function usage(): string {
  return (
    'Usage: toolmark lint [--manifest file]... [--url url]... [--storage-state file] ' +
    '[--judge spec]... [--budget n] [--format pretty|json]'
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
  let values: {
    manifest?: string[]
    url?: string[]
    'storage-state'?: string
    judge?: string[]
    budget?: string
    format?: string
  }
  try {
    ;({ values } = parseArgs({
      args: argv,
      options: {
        manifest: { type: 'string', multiple: true },
        url: { type: 'string', multiple: true },
        'storage-state': { type: 'string' },
        judge: { type: 'string', multiple: true },
        budget: { type: 'string' },
        format: { type: 'string' },
      },
      allowPositionals: false,
    }))
  } catch (e) {
    io.stderr(`${usage()}\n${e instanceof Error ? e.message : String(e)}\n`)
    return EXIT_USAGE_OR_RUNTIME_FAILURE
  }

  const format = values.format ?? 'pretty'
  if (format !== 'pretty' && format !== 'json') {
    io.stderr(`--format must be "pretty" or "json": ${format}\n`)
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

async function main(): Promise<void> {
  try {
    process.exitCode = await runCli(process.argv.slice(2))
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`)
    process.exitCode = EXIT_USAGE_OR_RUNTIME_FAILURE
  }
}

// Only run when executed directly (`toolmark lint` / `node dist/cli.js`), never on import (so
// tests can import `runCli` without triggering a live run against the test process's own argv).
const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMainModule) void main()
