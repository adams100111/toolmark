import { afterEach, describe, expect, it } from 'vitest'
import { createToolmark, ok, type ToolDefinition, type Toolmark } from '@toolmark/core'
import {
  startTour,
  type Planner,
  type PlannerContext,
  type TourEvent,
  type TourStep,
} from '../src/index.js'

const created: Element[] = []
function el(): HTMLElement {
  const node = document.createElement('div')
  document.body.append(node)
  created.push(node)
  return node
}
afterEach(() => {
  for (const node of created.splice(0)) node.remove()
})

function tool(name: string, extra: Partial<ToolDefinition> = {}): ToolDefinition {
  const anchor = el()
  return {
    name,
    description: `Tool ${name} for tests`,
    jsonSchema: { type: 'object', properties: {} },
    anchors: { element: () => anchor, resolve: () => anchor },
    run: () => ok({ changes: [], skipped: [] }),
    ...extra,
  }
}

function registry(): Toolmark {
  return createToolmark({ confirm: () => Promise.resolve({ approved: true }) })
}

function planner(steps: unknown[], seen?: PlannerContext[]): Planner {
  return {
    plan(ctx) {
      seen?.push(ctx)
      return Promise.resolve(steps as TourStep[])
    },
  }
}

function invalidReasons(events: TourEvent[]): string[] {
  return events.flatMap((e) =>
    e.type === 'step_invalid' ? [`${e.step.tool}:${e.step.param ?? ''}:${e.reason}`] : [],
  )
}

describe('tour planner contract', () => {
  it('planner_steps_validated_and_invalid_dropped', async () => {
    const tm = registry()
    tm.register(
      tool('f.fill', {
        jsonSchema: {
          type: 'object',
          properties: {
            values: { type: 'object', properties: { email: { type: 'string' } } },
          },
        },
      }),
    )
    tm.register(tool('remove', { hints: { destructive: true } }))
    tm.register(tool('hidden'), { scope: tm.scope('off', { when: false }) })
    const seen: PlannerContext[] = []
    const valid = { tool: 'f.fill', param: 'email', text: 'Email' }
    const tour = await startTour(tm, {
      mode: 'show',
      goal: 'Sign up',
      planner: planner(
        [
          { tool: 'missing', text: 'Unknown tool' },
          { tool: 'remove', text: 'Hidden from tour by policy' },
          { tool: 'off.hidden', text: 'Hidden by when' },
          { tool: 'f.fill', param: 'nope', text: 'Unknown param' },
          { tool: 'f.fill', param: '__proto__', text: 'Forbidden segment' },
          { tool: 42, text: 'Malformed' },
          { tool: 'f.fill', text: 5 },
          null,
          valid,
        ],
        seen,
      ),
    })
    // The planner sees what caller `tour` sees.
    expect(seen).toHaveLength(1)
    const ctx = seen[0]!
    expect(ctx.goal).toBe('Sign up')
    expect(ctx.mode).toBe('show')
    expect(ctx.signal).toBeInstanceOf(AbortSignal)
    expect(ctx.tools.map((t) => t.name)).toEqual(['f.fill'])
    expect(ctx.describe('f.fill')?.inputSchema).toBeDefined()
    expect(ctx.describe('remove')).toBeUndefined()

    const events: TourEvent[] = []
    tour.on((e) => events.push(e))
    expect(invalidReasons(events)).toEqual([
      'missing::unknown_tool',
      'remove::unknown_tool',
      'off.hidden::unknown_tool',
      'f.fill:nope:unknown_param',
      'f.fill:__proto__:unknown_param',
      '42::malformed_step',
      'f.fill::malformed_step',
      'null::malformed_step',
    ])
    expect(tour.state.steps).toEqual([valid])
    expect(tour.state).toMatchObject({ status: 'running', index: 0 })

    // A planner rejection rejects startTour with the same error.
    const boom = new Error('planner down')
    await expect(
      startTour(tm, { mode: 'show', goal: 'x', planner: { plan: () => Promise.reject(boom) } }),
    ).rejects.toBe(boom)
    // A non-array plan is a TypeError.
    await expect(
      startTour(tm, { mode: 'show', goal: 'x', planner: planner('nope' as unknown as unknown[]) }),
    ).rejects.toBeInstanceOf(TypeError)

    // Zero valid steps: stopped with "no valid steps".
    const none = await startTour(tm, {
      mode: 'do',
      goal: 'x',
      planner: planner([{ tool: 'missing', text: 'x' }]),
    })
    expect(none.state).toMatchObject({ status: 'stopped', message: 'no valid steps', steps: [] })

    // The start signal reaches the planner; aborting it stops the tour.
    const ac = new AbortController()
    const withSignal = await startTour(tm, {
      mode: 'show',
      goal: 'x',
      signal: ac.signal,
      planner: {
        plan(c) {
          expect(c.signal).toBe(ac.signal)
          ac.abort()
          return Promise.resolve([valid])
        },
      },
    })
    expect(withSignal.state.status).toBe('stopped')
  })

  it('planner_validates_nested_and_wizard_params', async () => {
    const tm = registry()
    tm.register(
      tool('order.fill', {
        jsonSchema: {
          type: 'object',
          properties: {
            values: {
              type: 'object',
              properties: {
                address: { $ref: '#/$defs/address' },
                items: {
                  anyOf: [
                    {
                      type: 'array',
                      items: { type: 'object', properties: { qty: { type: 'number' } } },
                    },
                    { type: 'object', properties: { $append: { type: 'array' } } },
                  ],
                },
                tags: { type: 'array', items: { type: 'string' } },
              },
            },
            overwrite: { type: 'boolean' },
          },
          $defs: {
            address: { type: 'object', properties: { city: { type: 'string' } } },
          },
        },
      }),
    )
    tm.register(
      tool('wiz.fill', {
        jsonSchema: {
          type: 'object',
          properties: {
            steps: {
              type: 'object',
              properties: {
                details: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    meta: { $ref: '#/$defs/details__meta' },
                  },
                },
                review: { type: 'object', properties: {} },
              },
            },
            overwrite: { type: 'boolean' },
          },
          $defs: {
            details__meta: { type: 'object', properties: { note: { type: 'string' } } },
          },
        },
      }),
    )
    tm.register(
      tool('search', {
        jsonSchema: { type: 'object', properties: { query: { type: 'string' } } },
      }),
    )
    const steps = [
      { tool: 'order.fill', param: 'address.city', text: 'ok: $ref' },
      { tool: 'order.fill', param: 'address.zip', text: 'bad' },
      { tool: 'order.fill', param: 'items.0.qty', text: 'ok: array op branch' },
      { tool: 'order.fill', param: 'items.x.qty', text: 'bad: non-numeric index' },
      { tool: 'order.fill', param: 'tags.3', text: 'ok' },
      { tool: 'order.fill', param: 'values', text: 'bad: wrapper is not a field' },
      { tool: 'order.fill', param: '', text: 'bad: empty' },
      { tool: 'order.fill', param: 'address..city', text: 'bad: empty segment' },
      { tool: 'wiz.fill', param: 'details.title', text: 'ok: wizard' },
      { tool: 'wiz.fill', param: 'details.meta.note', text: 'ok: wizard $ref' },
      { tool: 'wiz.fill', param: 'details', text: 'ok: step itself' },
      { tool: 'wiz.fill', param: 'details.nope', text: 'bad' },
      { tool: 'wiz.fill', param: 'nostep.title', text: 'bad' },
      { tool: 'wiz.fill', param: 'constructor', text: 'bad' },
      { tool: 'search', param: 'query', text: 'ok: plain tool' },
      { tool: 'search', param: 'values', text: 'bad' },
      { tool: 'search', text: 'ok: no param' },
    ]
    const tour = await startTour(tm, { mode: 'show', goal: 'g', planner: planner(steps) })
    const events: TourEvent[] = []
    tour.on((e) => events.push(e))
    expect(invalidReasons(events)).toEqual([
      'order.fill:address.zip:unknown_param',
      'order.fill:items.x.qty:unknown_param',
      'order.fill:values:unknown_param',
      'order.fill::unknown_param',
      'order.fill:address..city:unknown_param',
      'wiz.fill:details.nope:unknown_param',
      'wiz.fill:nostep.title:unknown_param',
      'wiz.fill:constructor:unknown_param',
      'search:values:unknown_param',
    ])
    expect(tour.state.steps.map((s) => s.text)).toEqual(
      steps.map((s) => s.text).filter((t) => t.startsWith('ok')),
    )
  })
})
