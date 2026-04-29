import { createContext, useContext, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { createApiClient } from '@serva/api-client'
import type { ServaApiClient } from '@serva/api-client'
import { useAuth } from '@serva/auth-context'

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ''

const ApiClientContext = createContext<ServaApiClient | null>(null)

export function ApiClientProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth()

  // Keep a ref so the stable `getToken` closure always reads the latest token
  // without the client needing to be recreated on every auth state change.
  const tokenRef = useRef(token)
  tokenRef.current = token

  const client = useMemo(
    () =>
      createApiClient({
        baseUrl: API_BASE_URL,
        getToken: () => tokenRef.current,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  return (
    <ApiClientContext.Provider value={client}>
      {children}
    </ApiClientContext.Provider>
  )
}

export function useApiClient(): ServaApiClient {
  const ctx = useContext(ApiClientContext)
  if (!ctx) {
    throw new Error('useApiClient() must be used inside <ApiClientProvider>')
  }
  return ctx
}
