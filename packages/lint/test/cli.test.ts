import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { EXIT_ERRORS_FOUND, EXIT_OK, EXIT_USAGE_OR_RUNTIME_FAILURE, runCli } from '../src/cli.js'
import { loadJudge } from '../src/judge.js'

const execFileAsync = promisify(execFile)

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))
const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))
const CLI_JS = join(PACKAGE_ROOT, 'dist', 'bin.js')

/** Spawns the built `dist/cli.js` (regression coverage for the real `toolmark` bin entrypoint). */
async function runBuiltCli(
  args: readonly string[],
  binPath: string = CLI_JS,
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [binPath, ...args])
    return { code: 0, stdout, stderr }
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string }
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' }
  }
}

function fakeIo(): {
  stdout: () => string
  stderr: () => string
  io: Parameters<typeof runCli>[1]
} {
  let out = ''
  let err = ''
  return {
    stdout: () => out,
    stderr: () => err,
    io: {
      stdout: (s) => {
        out += s
      },
      stderr: (s) => {
        err += s
      },
    },
  }
}

let tmpDir: string | undefined

afterEach(async () => {
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true })
  tmpDir = undefined
})

describe('runCli', () => {
  it('cli_exit_codes (clean manifest exits 0)', async () => {
    const { io, stdout } = fakeIo()
    const code = await runCli(['--manifest', `${FIXTURES}manifest-shape.json`], io)
    expect(code).toBe(EXIT_OK)
    expect(stdout()).toContain('0 error(s)')
  })

  it('cli_exit_codes (a rule error exits 1)', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'toolmark-lint-cli-'))
    const file = join(tmpDir, 'bad.json')
    await writeFile(
      file,
      JSON.stringify({
        page: 'p',
        tools: [
          {
            name: 'bad..name',
            llmName: 'bad',
            description: 'A tool with an invalid name, long enough to avoid other warnings.',
            hints: {},
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      }),
    )
    const { io, stdout } = fakeIo()
    const code = await runCli(['--manifest', file], io)
    expect(code).toBe(EXIT_ERRORS_FOUND)
    expect(stdout()).toContain('name-format')
  })

  it('cli_exit_codes (invalid manifest file exits 2)', async () => {
    const { io, stderr } = fakeIo()
    const code = await runCli(['--manifest', `${FIXTURES}manifest-invalid.json`], io)
    expect(code).toBe(EXIT_USAGE_OR_RUNTIME_FAILURE)
    expect(stderr()).toContain('invalid manifest file:')
  })

  it('i1_manifest_with_tool_missing_hints_and_inputSchema_exits_2_not_a_TypeError', async () => {
    const { io, stderr } = fakeIo()
    const code = await runCli(['--manifest', `${FIXTURES}manifest-invalid-tool.json`], io)
    expect(code).toBe(EXIT_USAGE_OR_RUNTIME_FAILURE)
    expect(stderr()).toContain(`invalid manifest file: ${FIXTURES}manifest-invalid-tool.json`)
  })

  it('no --manifest and no --url exits 2 with usage', async () => {
    const { io, stderr, stdout } = fakeIo()
    const code = await runCli([], io)
    expect(code).toBe(EXIT_USAGE_OR_RUNTIME_FAILURE)
    expect(stderr()).toContain('toolmark lint [options]')
    expect(stdout()).toBe('')
    const lintOnly = fakeIo()
    expect(await runCli(['lint', '--format', 'json'], lintOnly.io)).toBe(
      EXIT_USAGE_OR_RUNTIME_FAILURE,
    )
  })

  it('--help describes --budget as the tool-budget threshold (default 40)', async () => {
    const { io, stdout } = fakeIo()
    await runCli(['--help'], io)
    expect(stdout()).toMatch(/--budget <n>\s+Tool-budget threshold/)
    expect(stdout()).toContain('default: 40')
  })

  it('cli_exit_codes (unknown flag exits 2)', async () => {
    const { io } = fakeIo()
    const code = await runCli(['--not-a-real-flag'], io)
    expect(code).toBe(EXIT_USAGE_OR_RUNTIME_FAILURE)
  })

  it('cli_pretty_format', async () => {
    const { io, stdout } = fakeIo()
    await runCli(['--manifest', `${FIXTURES}manifest-shape.json`, '--format', 'pretty'], io)
    const lines = stdout().trimEnd().split('\n')
    expect(lines.at(-1)).toBe('0 error(s), 0 warning(s)')
  })

  it('cli_json_format', async () => {
    const { io, stdout } = fakeIo()
    await runCli(['--manifest', `${FIXTURES}manifest-shape.json`, '--format', 'json'], io)
    const parsed = JSON.parse(stdout()) as { findings: unknown[]; summary: Record<string, number> }
    expect(parsed).toEqual({ findings: [], summary: { errors: 0, warnings: 0 } })
  })

  it('judge_errors_become_warnings', async () => {
    const { io, stdout } = fakeIo()
    const code = await runCli(
      [
        '--manifest',
        `${FIXTURES}manifest-shape.json`,
        '--judge',
        `${FIXTURES}judge-throws.mjs`,
        '--format',
        'json',
      ],
      io,
    )
    expect(code).toBe(EXIT_OK) // judge-failed is a warn, never an error
    const parsed = JSON.parse(stdout()) as { findings: { rule: string; message: string }[] }
    expect(parsed.findings).toEqual([
      expect.objectContaining({
        rule: 'judge-failed',
        message: expect.stringContaining('fixture-throws') as unknown as string,
      }),
    ])
    expect(parsed.findings[0]?.message).toContain('judge blew up')
  })

  it('judge module not found exits 2', async () => {
    const { io, stderr } = fakeIo()
    const code = await runCli(
      ['--manifest', `${FIXTURES}manifest-shape.json`, '--judge', `${FIXTURES}does-not-exist.mjs`],
      io,
    )
    expect(code).toBe(EXIT_USAGE_OR_RUNTIME_FAILURE)
    expect(stderr()).toContain('judge module not found:')
  })
})

describe('loadJudge', () => {
  it('judge_resolved_from_cwd (relative spec resolves against the given cwd)', async () => {
    const judge = await loadJudge('./test/fixtures/judge-object.mjs', PACKAGE_ROOT)
    expect(judge.name).toBe('fixture-object')
  })

  it('judge_module_factory_or_object (object default export)', async () => {
    const judge = await loadJudge(`${FIXTURES}judge-object.mjs`)
    expect(judge.name).toBe('fixture-object')
    const findings = await judge.judge({ page: 'p', tools: [] })
    expect(findings[0]?.message).toContain('0 tool(s)')
  })

  it('judge_module_factory_or_object (factory default export)', async () => {
    const judge = await loadJudge(`${FIXTURES}judge-factory.mjs`)
    expect(judge.name).toBe('fixture-factory')
  })

  it('resolves a bare specifier through cwd package.json (createRequire)', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'toolmark-lint-bare-'))
    await writeFile(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'host', version: '0.0.0' }),
    )
    const pkgDir = join(tmpDir, 'node_modules', 'fixture-bare-judge')
    await mkdir(pkgDir, { recursive: true })
    await writeFile(
      join(pkgDir, 'package.json'),
      JSON.stringify({ name: 'fixture-bare-judge', main: 'index.js' }),
    )
    await writeFile(
      join(pkgDir, 'index.js'),
      "module.exports = { name: 'fixture-bare', judge: async () => [] }\n",
    )
    const judge = await loadJudge('fixture-bare-judge', tmpDir)
    expect(judge.name).toBe('fixture-bare')
  })

  it('rejects a bare specifier that cannot be resolved', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'toolmark-lint-bare-'))
    await writeFile(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'host', version: '0.0.0' }),
    )
    await expect(loadJudge('no-such-judge-package', tmpDir)).rejects.toThrow(
      'judge module not found: no-such-judge-package',
    )
  })
})

describe('lint subcommand (spawned dist/cli.js)', () => {
  it('toolmark lint --manifest <valid fixture> exits 0', async () => {
    const { code, stdout } = await runBuiltCli([
      'lint',
      '--manifest',
      `${FIXTURES}manifest-shape.json`,
    ])
    expect(code).toBe(EXIT_OK)
    expect(stdout).toContain('0 error(s)')
  })

  it('bare toolmark --manifest <valid fixture> (no subcommand) still exits 0', async () => {
    const { code, stdout } = await runBuiltCli(['--manifest', `${FIXTURES}manifest-shape.json`])
    expect(code).toBe(EXIT_OK)
    expect(stdout).toContain('0 error(s)')
  })

  it('an unknown subcommand exits 2 with usage text listing "lint"', async () => {
    const { code, stderr } = await runBuiltCli([
      'bogus',
      '--manifest',
      `${FIXTURES}manifest-shape.json`,
    ])
    expect(code).toBe(EXIT_USAGE_OR_RUNTIME_FAILURE)
    expect(stderr).toContain('lint')
  })

  it('--help shows "toolmark lint [options]"', async () => {
    const { code, stdout } = await runBuiltCli(['--help'])
    expect(code).toBe(EXIT_OK)
    expect(stdout).toContain('toolmark lint [options]')
  })

  it('toolmark lint --help also shows "toolmark lint [options]"', async () => {
    const { code, stdout } = await runBuiltCli(['lint', '--help'])
    expect(code).toBe(EXIT_OK)
    expect(stdout).toContain('toolmark lint [options]')
  })
})

describe('bin through a symlink (npm/npx .bin)', () => {
  it('c1_symlinked_bin_runs_main (bad manifest exits 2, not a silent 0)', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'toolmark-lint-bin-'))
    const link = join(tmpDir, 'toolmark')
    await symlink(CLI_JS, link)
    const { code, stderr } = await runBuiltCli(['lint', '--manifest', '/nonexistent.json'], link)
    expect(code).toBe(EXIT_USAGE_OR_RUNTIME_FAILURE)
    expect(stderr).toContain('invalid manifest file: /nonexistent.json')
  })

  it('c1_symlinked_bin_runs_main (--help prints usage)', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'toolmark-lint-bin-'))
    const link = join(tmpDir, 'toolmark')
    await symlink(CLI_JS, link)
    const { code, stdout } = await runBuiltCli(['--help'], link)
    expect(code).toBe(EXIT_OK)
    expect(stdout).toContain('toolmark lint [options]')
  })
})

describe('bin_has_shebang', () => {
  it('the built bin.js keeps its shebang', async () => {
    const contents = await readFile(CLI_JS, 'utf8')
    expect(contents.split('\n')[0]).toBe('#!/usr/bin/env node')
  })
})
