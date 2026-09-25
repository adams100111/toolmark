import { createRequire } from 'node:module'
import { join, resolve as resolvePath } from 'node:path'
import { pathToFileURL } from 'node:url'
import { LintUsageError } from './collect.js'
import type { Judge } from './types.js'

function isModuleNotFound(e: unknown): boolean {
  const code = (e as NodeJS.ErrnoException | undefined)?.code
  return code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND'
}

/**
 * Resolves and imports a `--judge` module spec (Task 3 brief): a spec starting with `.` or `/`
 * resolves against `cwd`; a bare specifier resolves like `require` from `cwd`'s `package.json`.
 * The default export is called with no arguments when it is a function (to get the {@link Judge}
 * it returns); otherwise the default export itself is used as the {@link Judge}.
 * @throws {LintUsageError} `judge module not found: <spec>` when the module cannot be resolved.
 */
export async function loadJudge(spec: string, cwd: string = process.cwd()): Promise<Judge> {
  let resolved: string
  if (spec.startsWith('.') || spec.startsWith('/')) {
    resolved = resolvePath(cwd, spec)
  } else {
    try {
      resolved = createRequire(join(cwd, 'package.json')).resolve(spec)
    } catch (e) {
      if (isModuleNotFound(e)) throw new LintUsageError(`judge module not found: ${spec}`)
      throw e
    }
  }

  let mod: { default?: unknown }
  try {
    mod = (await import(pathToFileURL(resolved).href)) as { default?: unknown }
  } catch (e) {
    if (isModuleNotFound(e)) throw new LintUsageError(`judge module not found: ${spec}`)
    throw e
  }

  const exported = mod.default
  return typeof exported === 'function' ? (exported as () => Judge)() : (exported as Judge)
}
