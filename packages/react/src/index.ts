/**
 * `@toolmark/react` — provider, scopes and hooks for React ≥ 18.3 (spec §9).
 * @packageDocumentation
 * @module @toolmark/react
 */
export { ToolmarkProvider, useToolmark, type ToolmarkProviderProps } from './provider.js'
export { ToolScope, useCurrentScope, type ToolScopeProps } from './scope.js'
export { useTool } from './use-tool.js'
export { useToolAnchor } from './use-tool-anchor.js'
export { useAgentActivity, type ActiveCall, type AgentActivity } from './use-agent-activity.js'
export { useFormTool } from './use-form-tool.js'
export { useWizardTool, type UseWizardToolOptions } from './use-wizard-tool.js'
export { useConfirmQueue, type ConfirmQueueState } from './use-confirm-queue.js'
export {
  usePendingConfirmations,
  type PendingConfirmationsState,
} from './use-pending-confirmations.js'
