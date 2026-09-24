import { createContext } from 'react'
import type { Scope, Toolmark } from '@toolmark/core'

/** @internal Carries the active {@link Toolmark} registry; `null` outside a `<ToolmarkProvider>`. */
export const ToolmarkContext = createContext<Toolmark | null>(null)

/** @internal Carries the current {@link Scope}; `undefined` means the registry root. */
export const ScopeContext = createContext<Scope | undefined>(undefined)
