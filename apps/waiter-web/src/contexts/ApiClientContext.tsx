import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createApiClient } from '@serva/api-client'
import type { ServaApiClient } from '@serva/api-client'
import { useAuth } from '@serva/auth-context'
import { ApiClientContext } from './api-client-context'

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ''

export function ApiClientProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth()

  // Keep a ref so the stable `getToken` closure always reads the latest token
  // without the client needing to be recreated on every auth state change.
  // We sync the ref in an effect (not during render) to satisfy
  // react-hooks/refs.
  const tokenRef = useRef(token)
  useEffect(() => {
    tokenRef.current = token
  }, [token])

  // The client is created exactly once via useState's lazy initializer and
  // pulls the current token from the ref on every API call.
  // eslint-disable-next-line react-hooks/refs -- the getToken closure is stored by createApiClient and only invoked later (from event handlers / fetches), never during render
  const [client] = useState<ServaApiClient>(() =>
    createApiClient({
      baseUrl: API_BASE_URL,
      getToken: () => tokenRef.current,
    }),
  )

  return (
    <ApiClientContext.Provider value={client}>
      {children}
    </ApiClientContext.Provider>
  )
}
