import type { Toolmark, ToolManifest } from '@toolmark/core'
import { paramSchema } from './param-schema.js'
import type { Planner, TourEvent, TourMode, TourStep } from './types.js'

const MODES: readonly TourMode[] = ['show', 'guide', 'do']

/** @internal Whether `mode` is a valid tour mode. */
export function isTourMode(mode: unknown): mode is TourMode {
  return MODES.includes(mode as TourMode)
}

/** @internal Why a planned step is invalid, or `undefined` when it is valid. */
function problem(
  step: unknown,
  describe: (name: string) => ToolManifest | undefined,
): 'malformed_step' | 'unknown_tool' | 'unknown_param' | undefined {
  if (typeof step !== 'object' || step === null) return 'malformed_step'
  const s = step as Record<string, unknown>
  if (
    typeof s.tool !== 'string' ||
    typeof s.text !== 'string' ||
    (s.param !== undefined && typeof s.param !== 'string') ||
    (s.title !== undefined && typeof s.title !== 'string') ||
    (s.waitFor !== undefined && s.waitFor !== 'input' && s.waitFor !== 'submit')
  ) {
    return 'malformed_step'
  }
  const manifest = describe(s.tool)
  if (!manifest) return 'unknown_tool'
  if (s.param !== undefined && !paramSchema(manifest.inputSchema, s.param, s.tool)) {
    return 'unknown_param'
  }
  return undefined
}

/** @internal A copy of a step keeping only the known fields. */
function copyStep(s: TourStep): TourStep {
  const out: TourStep = { tool: s.tool, text: s.text }
  if (s.param !== undefined) out.param = s.param
  if (s.title !== undefined) out.title = s.title
  if (s.input !== undefined) out.input = s.input
  if (s.waitFor !== undefined) out.waitFor = s.waitFor
  return Object.freeze(out)
}

/**
 * @internal Runs the app-supplied planner with what caller `tour` can see and validates its
 * steps: a step is kept when its tool is describable for `tour` and its `param` (if any) exists in
 * the tool's input schema. Dropped steps become `step_invalid` events. A planner rejection
 * propagates; a non-array plan is a `TypeError`.
 */
export async function planSteps(
  tm: Toolmark,
  planner: Planner,
  goal: string,
  mode: TourMode,
  signal: AbortSignal,
): Promise<{ steps: TourStep[]; events: TourEvent[] }> {
  const describe = (name: string): ToolManifest | undefined =>
    typeof name === 'string' ? tm.describe(name, { caller: 'tour' }) : undefined
  const planned: unknown = await planner.plan({
    goal,
    mode,
    tools: tm.manifest({ caller: 'tour' }).tools,
    describe,
    signal,
  })
  if (!Array.isArray(planned)) throw new TypeError('Tour planner must resolve an array of steps')
  const steps: TourStep[] = []
  const events: TourEvent[] = []
  for (const step of planned as unknown[]) {
    const reason = problem(step, describe)
    if (reason === undefined) steps.push(copyStep(step as TourStep))
    else events.push({ type: 'step_invalid', step: invalidStep(step), reason })
  }
  return { steps, events }
}

/** @internal A best-effort `TourStep` view of a malformed planned step, for the event. */
function invalidStep(step: unknown): TourStep {
  if (typeof step !== 'object' || step === null) return { tool: String(step), text: '' }
  const s = step as Record<string, unknown>
  const out: TourStep = {
    tool: typeof s.tool === 'string' ? s.tool : String(s.tool),
    text: typeof s.text === 'string' ? s.text : '',
  }
  if (typeof s.param === 'string') out.param = s.param
  return out
}

/** @internal Copies authored steps (shape is trusted: authored by the app). */
export function authoredSteps(steps: readonly TourStep[]): TourStep[] {
  return steps.map(copyStep)
}
