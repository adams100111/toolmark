import { ok, type ToolDefinition, type ToolHints } from '@toolmark/core'

/** Minimal tool for registry tests. */
export function tool(
  name: string,
  hints?: ToolHints,
  extra?: Partial<ToolDefinition>,
): ToolDefinition {
  return {
    name,
    description: `Tool ${name}`,
    ...(hints ? { hints } : {}),
    run: () => ok({ name }),
    ...extra,
  }
}

/** Resolves after pending microtasks (revision notifications) have run. */
export function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
