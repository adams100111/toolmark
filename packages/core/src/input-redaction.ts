/**
 * @internal Hook a tool can carry (under this symbol) that maps its sensitive paths
 * (`ToolDefinition.sensitivePaths()`, which are paths of the tool's *values*) onto the shape of
 * its call *input*, for consumers that redact inputs (the OTel exporter). Form fills map `p` →
 * `values.<p>`, wizard fills map `<step>.<p>` → `steps.<step>.<p>`. Returned paths may contain
 * `[]` (any array index); the consumer expands them against the input. A tool without the hook
 * falls back to its `sensitivePaths()` as-is (its input and values share one shape).
 */
export const INPUT_SENSITIVE_PATHS: unique symbol = Symbol('toolmark.inputSensitivePaths')

/** @internal Shape of the {@link INPUT_SENSITIVE_PATHS} hook. */
export type InputSensitivePathsHook = () => string[]

/** @internal Reads the hook from a tool definition, if any. */
export function inputSensitiveHookOf(tool: object): InputSensitivePathsHook | undefined {
  const hook = (tool as { [INPUT_SENSITIVE_PATHS]?: unknown })[INPUT_SENSITIVE_PATHS]
  return typeof hook === 'function' ? (hook as InputSensitivePathsHook) : undefined
}
