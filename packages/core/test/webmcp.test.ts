import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ok, type ToolmarkErrorEvent, type ToolmarkOptions } from '@toolmark/core'
import { webmcp, type ModelContextLike, type WebMcpToolDescriptor } from '@toolmark/core/webmcp'
import { createTestRegistry } from './helpers/create-test-registry.js'
import { settle } from './helpers/deferred.js'
import { tool } from './helpers/tools.js'

type RegisterOptions = { signal?: AbortSignal; exposedTo?: string[] }

interface FakeOptions {
  /** Reject (or throw synchronously when `sync`) for these tool names. */
  reject?: Record<string, { reason: Error; sync?: boolean }>
  /** Names of native (declarative) tools the browser already exposes. */
  native?: string[]
  /** Keep the registration promise pending until the signal aborts, then reject with its reason. */
  pendingUntilAbort?: boolean
}

/** A fake `ModelContextLike` recording every registration (async `getTools`, like the spec). */
function fakeModelContext(opts: FakeOptions = {}) {
  const calls: { tool: WebMcpToolDescriptor; options: RegisterOptions | undefined }[] = []
  const live = new Map<string, WebMcpToolDescriptor>()
  const mc: ModelContextLike = {
    registerTool(t, options) {
      calls.push({ tool: t, options })
      const rejection = opts.reject?.[t.name]
      if (rejection?.sync) throw rejection.reason
      if (rejection) return Promise.reject(rejection.reason)
      const signal = options?.signal
      live.set(t.name, t)
      signal?.addEventListener(
        'abort',
        () => {
          if (live.get(t.name) === t) live.delete(t.name)
        },
        { once: true },
      )
      if (opts.pendingUntilAbort && signal) {
        return new Promise<void>((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason as Error), { once: true })
        })
      }
      return Promise.resolve()
    },
    async getTools() {
      await new Promise((r) => setTimeout(r, 0))
      return [...(opts.native ?? []), ...live.keys()].map((name) => ({ name }))
    },
  }
  return {
    mc,
    calls,
    live,
    callsFor: (name: string) => calls.filter((c) => c.tool.name === name),
    tool(name: string): WebMcpToolDescriptor {
      const t = live.get(name)
      if (!t) throw new Error(`not registered: ${name}`)
      return t
    },
  }
}

/** A permissive object schema for echo tools. */
const anyObject = z.object({}).catchall(z.unknown())

const approve: NonNullable<ToolmarkOptions['confirm']> = () => Promise.resolve({ approved: true })

function setup(options: ToolmarkOptions = {}) {
  const tm = createTestRegistry({ confirm: approve, ...options })
  const errors: ToolmarkErrorEvent[] = []
  tm.events.on('error', (e) => errors.push(e))
  return { tm, errors }
}

let unhandled: unknown[] = []
const onUnhandled = (reason: unknown): void => {
  unhandled.push(reason)
}
beforeEach(() => {
  unhandled = []
  process.on('unhandledRejection', onUnhandled)
})
afterEach(() => {
  process.off('unhandledRejection', onUnhandled)
})

describe('webmcp consumer', () => {
  it('registers_visible_tools_with_hints', async () => {
    const { tm } = setup()
    const fake = fakeModelContext()
    tm.register(tool('orders.list', { readOnly: true, untrustedContent: true }, { title: 'List' }))
    tm.register(tool('orders.cancel', { consequential: true }))
    tm.register(tool('orders.note'))
    tm.use(webmcp({ modelContext: () => fake.mc }))
    await settle()

    expect([...fake.live.keys()].sort()).toEqual(['orders.cancel', 'orders.list', 'orders.note'])
    const list = fake.tool('orders.list')
    expect(list.title).toBe('List')
    expect(list.description).toBe('Tool orders.list')
    expect(list.annotations).toEqual({
      readOnlyHint: true,
      consequentialHint: false,
      untrustedContentHint: true,
    })
    expect(fake.tool('orders.cancel').annotations).toEqual({
      readOnlyHint: false,
      consequentialHint: true,
      untrustedContentHint: false,
    })
    expect(fake.tool('orders.note').annotations).toEqual({
      readOnlyHint: false,
      consequentialHint: false,
      untrustedContentHint: false,
    })
    // A tool without input schema registers an object schema, never `{}`.
    expect(fake.tool('orders.note').inputSchema).toEqual(
      expect.objectContaining({ type: 'object' }),
    )
    for (const c of fake.calls) expect(c.options?.signal).toBeInstanceOf(AbortSignal)
    // One controller per tool.
    const signals = new Set(fake.calls.map((c) => c.options?.signal))
    expect(signals.size).toBe(3)
  })

  it('destructive_not_exposed_by_default', async () => {
    const { tm } = setup()
    const fake = fakeModelContext()
    tm.register(tool('rm', { destructive: true }))
    tm.register(tool('ok'))
    tm.use(webmcp({ modelContext: () => fake.mc }))
    await settle()
    expect([...fake.live.keys()]).toEqual(['ok'])

    // An app policy that widens webmcp exposes it, with consequentialHint set.
    const widened = setup({ policy: { webmcp: { allow: ['readOnly', 'default', 'destructive'] } } })
    const fake2 = fakeModelContext()
    widened.tm.register(tool('rm', { destructive: true }))
    widened.tm.use(webmcp({ modelContext: () => fake2.mc }))
    await settle()
    expect(fake2.tool('rm').annotations?.consequentialHint).toBe(true)
  })

  it('filter_limits_registered_tools', async () => {
    const { tm } = setup()
    const fake = fakeModelContext()
    tm.register(tool('a'))
    tm.register(tool('b'))
    tm.use(webmcp({ modelContext: () => fake.mc, filter: (t) => t.name !== 'b' }))
    await settle()
    expect([...fake.live.keys()]).toEqual(['a'])
  })

  it('exposed_to_passed_through', async () => {
    const { tm } = setup()
    const fake = fakeModelContext()
    tm.register(tool('a'))
    tm.use(webmcp({ modelContext: () => fake.mc, exposedTo: ['https://agent.example'] }))
    await settle()
    expect(fake.callsFor('a')[0]?.options?.exposedTo).toEqual(['https://agent.example'])

    const plain = setup()
    const fake2 = fakeModelContext()
    plain.tm.register(tool('a'))
    plain.tm.use(webmcp({ modelContext: () => fake2.mc, exposedTo: [] }))
    await settle()
    expect(fake2.callsFor('a')[0]?.options).not.toHaveProperty('exposedTo')
  })

  it('execute_routes_through_call_with_caller_webmcp', async () => {
    const { tm } = setup()
    const fake = fakeModelContext()
    const seen: string[] = []
    tm.events.on('call', (e) => seen.push(`${e.tool}:${e.caller}`))
    let aborted: boolean | undefined
    tm.register(
      tool(
        'echo',
        { readOnly: true },
        {
          input: anyObject,
          run: (input, ctx) => {
            aborted = ctx.signal.aborted
            return ok(input)
          },
        },
      ),
    )
    tm.use(webmcp({ modelContext: () => fake.mc }))
    await settle()

    const controller = new AbortController()
    await fake.tool('echo').execute({ x: 1 }, { signal: controller.signal })
    expect(seen).toEqual(['echo:webmcp'])
    expect(aborted).toBe(false)

    // The execute signal is forwarded to tm.call.
    controller.abort()
    const r = await fake.tool('echo').execute({ x: 1 }, { signal: controller.signal })
    expect(r).toEqual({ status: 'cancelled', by: 'signal' })

    // Consequential tools confirm inline through the app's handler.
    const confirm = vi.fn(approve)
    const c = setup({ confirm })
    const fake2 = fakeModelContext()
    c.tm.register(
      tool(
        'pay',
        { consequential: true },
        {
          run: async (_i, ctx) => {
            const outcome = await ctx.confirm({ summary: 'Pay?' })
            return ok(outcome.approved)
          },
        },
      ),
    )
    c.tm.use(webmcp({ modelContext: () => fake2.mc }))
    await settle()
    await expect(fake2.tool('pay').execute({})).resolves.toEqual(ok(true))
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ tool: 'pay', caller: 'webmcp' }))
  })

  it('execute_returns_object_not_string', async () => {
    const { tm } = setup()
    const fake = fakeModelContext()
    tm.register(
      tool('echo', { readOnly: true }, { input: anyObject, run: (input) => ok({ got: input }) }),
    )
    tm.use(webmcp({ modelContext: () => fake.mc }))
    await settle()
    const r = await fake.tool('echo').execute({ q: 'x' })
    expect(typeof r).toBe('object')
    expect(r).toEqual({ status: 'ok', data: { got: { q: 'x' } } })
  })

  it('execute_accepts_json_string_input', async () => {
    const { tm } = setup()
    const fake = fakeModelContext()
    tm.register(
      tool('echo', { readOnly: true }, { input: anyObject, run: (input) => ok({ got: input }) }),
    )
    tm.use(webmcp({ modelContext: () => fake.mc }))
    await settle()
    const r = await fake.tool('echo').execute(JSON.stringify({ q: 'x' }))
    expect(r).toEqual({ status: 'ok', data: { got: { q: 'x' } } })
  })

  it('execute_invalid_json_string_returns_invalid', async () => {
    const { tm } = setup()
    const fake = fakeModelContext()
    const run = vi.fn(() => ok(1))
    tm.register(tool('echo', { readOnly: true }, { input: anyObject, run }))
    tm.use(webmcp({ modelContext: () => fake.mc }))
    await settle()
    const r = await fake.tool('echo').execute('{not json')
    expect(r).toEqual({
      status: 'invalid',
      issues: [{ path: '', message: 'Input is not valid JSON' }],
    })
    expect(run).not.toHaveBeenCalled()
  })

  it('execute_without_options_arg_works', async () => {
    const { tm } = setup()
    const fake = fakeModelContext()
    tm.register(tool('echo', { readOnly: true }, { input: anyObject, run: (input) => ok(input) }))
    tm.use(webmcp({ modelContext: () => fake.mc }))
    await settle()
    // The polyfill calls `execute(args)` with exactly one argument.
    await expect(fake.tool('echo').execute({ a: 1 })).resolves.toEqual(ok({ a: 1 }))
  })

  it('resync_on_change_aborts_old', async () => {
    const { tm } = setup()
    const fake = fakeModelContext()
    const reg = tm.register(tool('a', undefined, { description: 'First.' }))
    const b = tm.register(tool('b'))
    tm.use(webmcp({ modelContext: () => fake.mc }))
    await settle()
    const oldA = fake.callsFor('a')[0]?.options?.signal
    const oldB = fake.callsFor('b')[0]?.options?.signal

    reg.dispose()
    tm.register(tool('a', undefined, { description: 'Second.' }))
    b.dispose()
    await settle()

    expect(oldA?.aborted).toBe(true)
    expect(oldB?.aborted).toBe(true)
    expect(fake.callsFor('a')).toHaveLength(2)
    expect(fake.tool('a').description).toBe('Second.')
    expect(fake.live.has('b')).toBe(false)
    expect(fake.callsFor('a')[1]?.options?.signal?.aborted).toBe(false)
  })

  it('unchanged_tools_not_reregistered', async () => {
    const { tm } = setup()
    const fake = fakeModelContext()
    tm.register(tool('a'))
    tm.use(webmcp({ modelContext: () => fake.mc }))
    await settle()
    tm.register(tool('b'))
    await settle()
    tm.register(tool('c'))
    await settle()
    expect(fake.callsFor('a')).toHaveLength(1)
    expect(fake.callsFor('a')[0]?.options?.signal?.aborted).toBe(false)
    expect([...fake.live.keys()].sort()).toEqual(['a', 'b', 'c'])
  })

  it('skips_native_form_duplicates', async () => {
    const { tm } = setup()
    // `order` is exposed by the browser's own declarative form; `book` is not (yet).
    const fake = fakeModelContext({ native: ['order'] })
    tm.register(tool('dom.order', undefined, { origin: 'native-form', nativeName: 'order' }))
    tm.register(tool('book', undefined, { origin: 'native-form', nativeName: 'book' }))
    tm.register(tool('plain'))
    tm.use(webmcp({ modelContext: () => fake.mc }))
    await settle()
    expect(fake.callsFor('dom.order')).toHaveLength(0)
    expect(fake.callsFor('book')).toHaveLength(1)

    // Next pass: `getTools` now lists our own `book`; it must not count as a native duplicate.
    tm.register(tool('later'))
    await settle()
    expect(fake.callsFor('book')).toHaveLength(1)
    expect(fake.callsFor('book')[0]?.options?.signal?.aborted).toBe(false)
    expect([...fake.live.keys()].sort()).toEqual(['book', 'later', 'plain'])
  })

  it('register_rejection_emits_event_no_unhandled', async () => {
    const { tm, errors } = setup()
    const dup = new DOMException('Tool already registered: bad', 'InvalidStateError')
    const sec = new DOMException('nope', 'SecurityError')
    const fake = fakeModelContext({
      reject: { bad: { reason: dup }, sync: { reason: sec, sync: true } },
    })
    tm.register(tool('bad'))
    tm.register(tool('sync'))
    tm.register(tool('good'))
    tm.use(webmcp({ modelContext: () => fake.mc }))
    await settle()

    const failed = errors.filter((e) => e.code === 'webmcp_register_failed')
    expect(failed.map((e) => e.tool).sort()).toEqual(['bad', 'sync'])
    expect(failed.find((e) => e.tool === 'bad')?.cause).toBe(dup)
    expect(failed.find((e) => e.tool === 'sync')?.cause).toBe(sec)
    expect(fake.live.has('good')).toBe(true)

    // Not retried while its fingerprint is unchanged.
    tm.register(tool('other'))
    await settle()
    expect(fake.callsFor('bad')).toHaveLength(1)
    expect(fake.callsFor('sync')).toHaveLength(1)
    expect(errors.filter((e) => e.code === 'webmcp_register_failed')).toHaveLength(2)
    expect(unhandled).toEqual([])
  })

  it('abort_rejection_ignored', async () => {
    const { tm, errors } = setup()
    const fake = fakeModelContext({ pendingUntilAbort: true })
    const reg = tm.register(tool('a'))
    tm.register(tool('b'))
    const dispose = tm.use(webmcp({ modelContext: () => fake.mc }))
    await settle()
    reg.dispose()
    await settle()
    dispose()
    await settle()
    expect(errors).toEqual([])
    expect(unhandled).toEqual([])
  })

  it('inactive_emits_unavailable_once', async () => {
    const { tm, errors } = setup()
    const factory = vi.fn(() => undefined)
    tm.register(tool('a'))
    expect(() => tm.use(webmcp({ modelContext: factory }))).not.toThrow()
    await settle()
    tm.register(tool('b'))
    await settle()
    const unavailable = errors.filter((e) => e.code === 'webmcp_unavailable')
    expect(unavailable).toHaveLength(1)
    expect(errors).toHaveLength(1)
    expect(unhandled).toEqual([])
  })

  it('polyfill_noop_reports_unavailable', async () => {
    const { tm, errors } = setup()
    const initializeWebMCPPolyfill = vi.fn()
    const loader = vi.fn(() => Promise.resolve({ initializeWebMCPPolyfill }))
    tm.use(webmcp({ polyfill: loader, modelContext: () => undefined }))
    await settle()
    expect(loader).toHaveBeenCalledTimes(1)
    expect(initializeWebMCPPolyfill).toHaveBeenCalledTimes(1)
    expect(errors.map((e) => e.code)).toEqual(['webmcp_unavailable'])
    expect('document' in globalThis).toBe(false)

    // A rejecting loader is reported the same way (with its cause), never thrown.
    const failing = setup()
    const boom = new Error('chunk load failed')
    failing.tm.use(webmcp({ polyfill: () => Promise.reject(boom), modelContext: () => undefined }))
    await settle()
    expect(failing.errors).toEqual([
      expect.objectContaining({ code: 'webmcp_unavailable', cause: boom }),
    ])
    expect(unhandled).toEqual([])
  })

  it('polyfill_loader_used_only_when_no_model_context', async () => {
    const { tm } = setup()
    const fake = fakeModelContext()
    const loader = vi.fn(() => Promise.resolve({ initializeWebMCPPolyfill: vi.fn() }))
    tm.register(tool('a'))
    tm.use(webmcp({ polyfill: loader, modelContext: () => fake.mc }))
    await settle()
    expect(loader).not.toHaveBeenCalled()
    expect(fake.live.has('a')).toBe(true)
  })

  it('disposer_aborts_all', async () => {
    const { tm } = setup()
    const fake = fakeModelContext()
    tm.register(tool('a'))
    tm.register(tool('b'))
    const dispose = tm.use(webmcp({ modelContext: () => fake.mc }))
    await settle()
    dispose()
    for (const c of fake.calls) expect(c.options?.signal?.aborted).toBe(true)
    expect(fake.live.size).toBe(0)

    tm.register(tool('c'))
    await settle()
    expect(fake.calls).toHaveLength(2)
  })

  it('disposer_before_resolution_cancels_everything', async () => {
    const { tm, errors } = setup()
    const fake = fakeModelContext()
    let release!: (m: { initializeWebMCPPolyfill(): void }) => void
    const loader = () =>
      new Promise<{ initializeWebMCPPolyfill(): void }>((r) => {
        release = r
      })
    let installed: ModelContextLike | undefined
    tm.register(tool('a'))
    const dispose = tm.use(webmcp({ polyfill: loader, modelContext: () => installed }))
    await settle()
    dispose()
    release({
      initializeWebMCPPolyfill: () => {
        installed = fake.mc
      },
    })
    await settle()
    expect(fake.calls).toHaveLength(0)
    expect(errors).toEqual([])
  })

  it('change_during_pass_schedules_one_more_pass', async () => {
    const { tm } = setup()
    const fake = fakeModelContext()
    const getTools = vi.spyOn(fake.mc, 'getTools')
    tm.register(tool('a'))
    tm.use(webmcp({ modelContext: () => fake.mc }))
    // While the first pass awaits getTools, several changes arrive.
    await Promise.resolve()
    tm.register(tool('b'))
    await Promise.resolve()
    tm.register(tool('c'))
    await settle(6)
    expect([...fake.live.keys()].sort()).toEqual(['a', 'b', 'c'])
    expect(getTools.mock.calls.length).toBeLessThanOrEqual(3)
    for (const name of ['a', 'b', 'c']) expect(fake.callsFor(name)).toHaveLength(1)
  })
})
