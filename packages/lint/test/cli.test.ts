import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { EXIT_ERRORS_FOUND, EXIT_OK, EXIT_USAGE_OR_RUNTIME_FAILURE, runCli } from '../src/cli.js'
import { loadJudge } from '../src/judge.js'

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))
const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))

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

describe('bin_has_shebang', () => {
  it('the built cli.js keeps its shebang', async () => {
    const contents = await readFile(join(PACKAGE_ROOT, 'dist', 'cli.js'), 'utf8')
    expect(contents.split('\n')[0]).toBe('#!/usr/bin/env node')
  })
})
