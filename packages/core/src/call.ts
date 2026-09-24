import { ToolmarkError } from './errors.js'
import { newId } from './ids.js'
import { isAllowed } from './policy.js'
import type { RegistryState } from './registry.js'
import { errorResult, refuse, type ToolResult } from './result.js'
import { invalid } from './result.js'
import { validateInput } from './schema.js'
import type { Caller, ToolContext } from './tool.js'

/** @internal The call pipeline behind `tm.call` (spec §5–§7, §14). */
export async function runCall(
  state: RegistryState,
  name: string,
  input: unknown,
  opts: { caller: Caller; rev?: number; signal?: AbortSignal },
): Promise<ToolResult<unknown>> {
  const { caller } = opts
  if (!state.browser) return refuse('unknown_tool', `Unknown tool "${name}"`, { rev: 0 })
  const entry = state.entries.get(name)
  if (!entry || !entry.alive || !entry.scope.isShown()) {
    if (opts.rev !== undefined && opts.rev !== state.rev) {
      return refuse('stale', `Tool "${name}" is not available at rev ${state.rev}`, {
        rev: state.rev,
      })
    }
    return refuse('unknown_tool', `Unknown tool "${name}"`, { rev: state.rev })
  }
  if (
    !isAllowed(state.policy, caller, entry.cls, entry.fullName) ||
    !state.visible(entry, caller)
  ) {
    return refuse('not_allowed', `Caller "${caller}" may not call "${name}"`)
  }

  const callId = newId()
  const started = Date.now()
  state.emitter.emit('call', { callId, tool: name, caller, input })
  const finish = (result: ToolResult<unknown>): ToolResult<unknown> => {
    state.emitter.emit('result', {
      callId,
      tool: name,
      caller,
      result,
      durationMs: Date.now() - started,
    })
    return result
  }

  const validated = await validateInput(entry.tool.input, input)
  if (!validated.ok) return finish(invalid(validated.issues))

  const ctx: ToolContext = {
    signal: opts.signal ?? new AbortController().signal,
    callId,
    caller,
    confirm: () => Promise.resolve({ approved: false, reason: 'confirmation_unavailable' }),
    registerUndo: () => {},
    files: {
      resolve: () =>
        Promise.reject(
          new ToolmarkError('files_not_configured', 'File resolution is not configured'),
        ),
    },
  }
  try {
    return finish(await entry.tool.run(validated.value, ctx))
  } catch (cause) {
    state.report({ code: 'tool_threw', message: `Tool "${name}" threw`, tool: name, cause })
    return finish(errorResult('Tool failed'))
  }
}
