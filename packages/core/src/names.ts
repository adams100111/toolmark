const TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/
const LLM_MAX = 64
const LLM_PREFIX = 55

/**
 * Whether `name` is a valid (full) tool name: `^[A-Za-z0-9_.-]{1,128}$` (MCP tool-name rules).
 * @param name - Full tool name including scope prefix.
 */
export function isValidToolName(name: string): boolean {
  return TOOL_NAME.test(name)
}

/**
 * LLM-safe tool name: every `.` becomes `__`; if the result is longer than 64 characters it is
 * truncated to 55 characters + `_` + the 8-hex FNV-1a hash of the full name. The result matches
 * `^[a-zA-Z0-9_-]{1,64}$` for every valid tool name.
 * @param fullName - A valid full tool name.
 */
export function toLlmName(fullName: string): string {
  const replaced = fullName.replaceAll('.', '__')
  if (replaced.length <= LLM_MAX) return replaced
  return `${replaced.slice(0, LLM_PREFIX)}_${fnv1a32(fullName)}`
}

/** 32-bit FNV-1a over the UTF-8 bytes of `s`, as 8 lowercase hex digits. */
function fnv1a32(s: string): string {
  let h = 0x811c9dc5
  for (const byte of new TextEncoder().encode(s)) {
    h ^= byte
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}
