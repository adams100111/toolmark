import type { ToolManifest } from '../manifest.js'
import { emitEvent, type Toolmark } from '../registry.js'
import { invalid } from '../result.js'
import type {
  ModelContextLike,
  WebMcpExecuteOptions,
  WebMcpRegisterToolOptions,
  WebMcpToolDescriptor,
} from './model-context.js'

/** @internal Options the sync engine needs from `webmcp()`. */
export interface SyncOptions {
  filter: ((t: ToolManifest) => boolean) | undefined
  exposedTo: string[] | undefined
}

interface Registered {
  fingerprint: string
  controller: AbortController
}

/** @internal The registration state of one consumer against one model context. */
export interface WebMcpSync {
  /** Runs a sync pass (serialized: a request during a pass schedules one more pass). */
  schedule(): void
  /** Aborts every registration and stops syncing. */
  dispose(): void
}

function fingerprintOf(t: ToolManifest): string {
  return JSON.stringify({
    title: t.title ?? null,
    description: t.description,
    hints: t.hints,
    inputSchema: t.inputSchema,
  })
}

function objectSchema(schema: ToolManifest['inputSchema']): object {
  return Object.keys(schema).length === 0 ? { type: 'object' } : schema
}

/** @internal Creates the sync engine for a resolved model context. */
export function createSync(tm: Toolmark, mc: ModelContextLike, opts: SyncOptions): WebMcpSync {
  const registered = new Map<string, Registered>()
  /** Tools whose registration failed, by the fingerprint that failed (retried only on change). */
  const failed = new Map<string, string>()
  let disposed = false
  let running = false
  let again = false

  function reportFailure(tool: string, cause: unknown): void {
    emitEvent(tm, 'error', {
      code: 'webmcp_register_failed',
      message: `WebMCP did not register "${tool}".`,
      tool,
      cause,
    })
  }

  function execute(name: string) {
    return async (input: unknown, options?: WebMcpExecuteOptions): Promise<unknown> => {
      const signal = options?.signal
      let value = input
      if (typeof input === 'string') {
        try {
          value = JSON.parse(input) as unknown
        } catch {
          return invalid([{ path: '', message: 'Input is not valid JSON' }])
        }
      }
      return tm.call(name, value, { caller: 'webmcp', ...(signal ? { signal } : {}) })
    }
  }

  function register(t: ToolManifest, fingerprint: string): void {
    const controller = new AbortController()
    registered.set(t.name, { fingerprint, controller })
    const descriptor: WebMcpToolDescriptor = {
      name: t.name,
      ...(t.title !== undefined ? { title: t.title } : {}),
      description: t.description,
      inputSchema: objectSchema(t.inputSchema),
      annotations: {
        readOnlyHint: !!t.hints.readOnly,
        consequentialHint: !!(t.hints.consequential || t.hints.destructive),
        untrustedContentHint: !!t.hints.untrustedContent,
      },
      execute: execute(t.name),
    }
    const options: WebMcpRegisterToolOptions = {
      signal: controller.signal,
      ...(opts.exposedTo?.length ? { exposedTo: [...opts.exposedTo] } : {}),
    }
    const onFailure = (cause: unknown): void => {
      // Our own abort (change, removal, dispose) surfacing as a rejection is expected.
      if (controller.signal.aborted && cause === controller.signal.reason) return
      if (registered.get(t.name)?.controller === controller) {
        registered.delete(t.name)
        failed.set(t.name, fingerprint)
      }
      controller.abort()
      reportFailure(t.name, cause)
    }
    try {
      // Promise-returning per the live spec; older drafts returned `undefined`.
      void Promise.resolve(mc.registerTool(descriptor, options)).then(undefined, onFailure)
    } catch (e) {
      onFailure(e)
    }
  }

  async function existingNames(): Promise<Set<string>> {
    let list: unknown
    try {
      list = await (mc.getTools ? mc.getTools() : [])
    } catch {
      list = []
    }
    const names = new Set<string>()
    if (Array.isArray(list)) {
      for (const entry of list) {
        const name = (entry as { name?: unknown } | null)?.name
        if (typeof name === 'string') names.add(name)
      }
    }
    return names
  }

  function visibleTools(): ToolManifest[] {
    const tools = tm.manifest({ caller: 'webmcp', detail: 'full' }).tools
    const { filter } = opts
    if (!filter) return tools
    return tools.filter((t) => {
      try {
        return filter(t)
      } catch (e) {
        reportFailure(t.name, e)
        return false
      }
    })
  }

  async function pass(): Promise<void> {
    const existing = await existingNames()
    if (disposed) return
    // Names this consumer registered are ours, not native duplicates.
    for (const name of registered.keys()) existing.delete(name)

    const desired = new Map<string, { tool: ToolManifest; fingerprint: string }>()
    for (const t of visibleTools()) {
      const nativeName = tm.info(t.name)?.nativeName
      if (nativeName !== undefined && existing.has(nativeName)) continue
      desired.set(t.name, { tool: t, fingerprint: fingerprintOf(t) })
    }

    for (const [name, reg] of [...registered]) {
      if (desired.get(name)?.fingerprint === reg.fingerprint) continue
      registered.delete(name)
      reg.controller.abort()
    }
    for (const [name, fingerprint] of [...failed]) {
      if (desired.get(name)?.fingerprint !== fingerprint) failed.delete(name)
    }
    for (const [name, { tool, fingerprint }] of desired) {
      if (registered.has(name) || failed.get(name) === fingerprint) continue
      register(tool, fingerprint)
    }
  }

  async function loop(): Promise<void> {
    try {
      do {
        again = false
        await pass()
      } while (again && !disposed)
    } finally {
      running = false
    }
  }

  return {
    schedule() {
      if (disposed) return
      if (running) {
        again = true
        return
      }
      running = true
      loop().catch((e: unknown) => {
        emitEvent(tm, 'error', {
          code: 'webmcp_register_failed',
          message: 'WebMCP tool sync failed.',
          cause: e,
        })
      })
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const reg of registered.values()) reg.controller.abort()
      registered.clear()
      failed.clear()
    },
  }
}
