import { createContext } from 'react'
import type { BstoemaApiClient } from '@bstoema/api-client'

/**
 * Pure-data context — kept in its own file so neither {@link ApiClientProvider}
 * nor {@link useApiClient} share a module that exports something other than a
 * component (which would break Vite Fast Refresh).
 */
export const ApiClientContext = createContext<BstoemaApiClient | null>(null)
