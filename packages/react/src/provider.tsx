import { useContext, type JSX, type ReactNode } from 'react'
import type { Toolmark } from '@toolmark/core'
import { ToolmarkContext } from './context.js'

/** Props for {@link ToolmarkProvider}. */
export interface ToolmarkProviderProps {
  /** The registry created with `createToolmark`. */
  toolmark: Toolmark
  /** Subtree that can use `useToolmark`, `useTool` and the other hooks. */
  children: ReactNode
}

/**
 * Makes a {@link Toolmark} registry available to `useToolmark`, `useTool`, `ToolScope` and the
 * other hooks in the subtree.
 * @param props - See {@link ToolmarkProviderProps}.
 */
export function ToolmarkProvider(props: ToolmarkProviderProps): JSX.Element {
  return (
    <ToolmarkContext.Provider value={props.toolmark}>{props.children}</ToolmarkContext.Provider>
  )
}

/**
 * Reads the {@link Toolmark} registry from the nearest `<ToolmarkProvider>`.
 * @throws When rendered outside a `<ToolmarkProvider>`.
 */
export function useToolmark(): Toolmark {
  const tm = useContext(ToolmarkContext)
  if (tm === null) {
    throw new Error('useToolmark must be used inside <ToolmarkProvider>')
  }
  return tm
}
