import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const cliPath = fileURLToPath(new URL('../dist/cli.js', import.meta.url))
const clientBundle = fileURLToPath(new URL('../dist/client.js', import.meta.url))
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string
}
const USAGE =
  'Usage: toolmark-mcp --allow-origin <origin> [--allow-origin <origin> …] [--port <n>] [--call-timeout <ms>]'

const children: ChildProcessWithoutNullStreams[] = []
afterEach(() => {
  for (const c of children.splice(0)) if (c.exitCode === null && c.signalCode === null) c.kill()
})

interface Run {
  child: ChildProcessWithoutNullStreams
  stdout: () => string
  stderr: () => string
  exited: Promise<number | null>
}

function run(args: string[]): Run {
  const child = spawn(process.execPath, [cliPath, ...args], { stdio: 'pipe' })
  children.push(child)
  let out = ''
  let err = ''
  child.stdout.on('data', (d: Buffer) => (out += d.toString()))
  child.stderr.on('data', (d: Buffer) => (err += d.toString()))
  const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)))
  return { child, stdout: () => out, stderr: () => err, exited }
}

async function waitFor(fn: () => boolean, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (!fn()) {
    if (Date.now() > deadline) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 20))
  }
}

function listenPort(r: Run): number {
  const m = /Toolmark MCP: pairing server on ws:\/\/127\.0\.0\.1:(\d+)/.exec(r.stderr())
  return Number(m![1])
}

const ORIGIN = ['--allow-origin', 'http://localhost:5173']

describe('toolmark-mcp CLI', () => {
  it('help_and_version_exit_0', async () => {
    const help = run(['--help'])
    expect(await help.exited).toBe(0)
    expect(help.stdout().split('\n')[0]).toBe(USAGE)
    expect(help.stderr()).toBe('')
    const version = run(['--version'])
    expect(await version.exited).toBe(0)
    expect(version.stdout().trim()).toBe(pkg.version)
  })

  it('cli_usage_errors_exit_2', async () => {
    const cases = [
      [],
      ['--port', '0'],
      ['--allow-origin', '*'],
      ['--allow-origin', 'null'],
      ['--allow-origin', 'http://localhost:5173/'],
      ['--allow-origin', 'http://localhost:5173/app'],
      ['--allow-origin', 'localhost:5173'],
      ['--allow-origin'],
      [...ORIGIN, '--port', 'abc'],
      [...ORIGIN, '--port', '70000'],
      [...ORIGIN, '--port', '-1'],
      [...ORIGIN, '--call-timeout', '0'],
      [...ORIGIN, '--call-timeout', '1.5'],
      [...ORIGIN, '--bogus'],
      [...ORIGIN, 'extra'],
    ]
    const runs = cases.map((args) => run(args))
    for (const [i, r] of runs.entries()) {
      expect(await r.exited, JSON.stringify(cases[i])).toBe(2)
      expect(r.stderr().split('\n')[0]).toBe(USAGE)
      expect(r.stdout()).toBe('')
    }
  })

  it('stdout_only_frames', async () => {
    const r = run([...ORIGIN, '--port', '0'])
    await waitFor(() => /Toolmark pairing code: /.test(r.stderr()))
    const code = /Toolmark pairing code: (\S+) \(expires in 5 minutes\)/.exec(r.stderr())![1]!
    const send = (m: unknown) => r.child.stdin.write(JSON.stringify(m) + '\n')
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 't', version: '0' },
      },
    })
    await waitFor(() => r.stdout().includes('"id":1'))
    send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    await waitFor(() => r.stdout().includes('"id":2'))
    const lines = r
      .stdout()
      .split('\n')
      .filter((l) => l !== '')
    for (const l of lines) expect((JSON.parse(l) as { jsonrpc: string }).jsonrpc).toBe('2.0')
    expect(r.stdout()).toContain('toolmark_pairing')
    expect(r.stdout()).toContain(`"version":"${pkg.version}"`)
    expect(r.stdout()).not.toContain(code)
    r.child.stdin.end()
    expect(await r.exited).toBe(0)
  })

  it('stdin_eof_exits_and_frees_port', async () => {
    const r = run([...ORIGIN, '--port', '0'])
    await waitFor(() => /pairing server on/.test(r.stderr()))
    const port = listenPort(r)
    r.child.stdin.end()
    expect(await r.exited).toBe(0)
    const probe = createServer()
    await new Promise<void>((resolve, reject) => {
      probe.once('error', reject)
      probe.listen(port, '127.0.0.1', () => resolve())
    })
    await new Promise<void>((resolve) => probe.close(() => resolve()))
  })

  it('sigterm_exits_0', async () => {
    const r = run([...ORIGIN, '--port', '0'])
    await waitFor(() => /pairing server on/.test(r.stderr()))
    r.child.kill('SIGTERM')
    expect(await r.exited).toBe(0)
  })

  it('port_in_use_exits_1', async () => {
    const blocker = createServer()
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', () => resolve()))
    const port = (blocker.address() as { port: number }).port
    try {
      const r = run([...ORIGIN, '--port', String(port)])
      expect(await r.exited).toBe(1)
      expect(r.stderr()).toContain(`Toolmark: port ${port} is in use; pass --port <other>`)
      expect(r.stdout()).toBe('')
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()))
    }
  })

  it('client_bundle_has_no_node_imports', () => {
    const js = readFileSync(clientBundle, 'utf8')
    expect(js).not.toMatch(/from\s*["'](ws|node:[^"']*)["']/)
    expect(js).not.toMatch(/import\(\s*["'](ws|node:[^"']*)["']\s*\)/)
    expect(js).not.toMatch(/require\(/)
    expect(js).toContain('mcpPairing')
  })
})
