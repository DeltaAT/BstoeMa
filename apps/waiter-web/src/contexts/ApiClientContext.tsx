import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createApiClient } from '@bstoema/api-client'
import type { BstoemaApiClient } from '@bstoema/api-client'
import { useAuth } from '@bstoema/auth-context'
import { ApiClientContext } from './api-client-context'

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ''

export function ApiClientProvider({ children }: { children: ReactNode }) {
  const { token, refreshWaiterSession } = useAuth()

  // Keep a ref so the stable `getToken` closure always reads the latest token
  // without the client needing to be recreated on every auth state change.
  // We sync the ref in an effect (not during render) to satisfy
  // react-hooks/refs.
  const tokenRef = useRef(token)
  useEffect(() => {
    tokenRef.current = token
  }, [token])

  // Same ref trick for the renewal action so the stable `onUnauthorized`
  // closure always calls the latest one.
  const refreshRef = useRef(refreshWaiterSession)
  useEffect(() => {
    refreshRef.current = refreshWaiterSession
  }, [refreshWaiterSession])

  // The client is created exactly once via useState's lazy initializer and
  // pulls the current token from the ref on every API call.
  // eslint-disable-next-line react-hooks/refs -- the getToken/onUnauthorized closures are stored by createApiClient and only invoked later (from event handlers / fetches), never during render
  const [client] = useState<BstoemaApiClient>(() =>
    createApiClient({
      baseUrl: API_BASE_URL,
      getToken: () => tokenRef.current,
      // On a 401, silently re-login from stored waiter credentials and retry
      // once with the fresh token. Update the ref immediately so any follow-up
      // call (e.g. printing the bon right after creating the order) already
      // sees the new token instead of triggering a second renewal.
      onUnauthorized: async () => {
        const fresh = await refreshRef.current()
        if (fresh) tokenRef.current = fresh
        return fresh
      },
    }),
  )

  return (
    <ApiClientContext.Provider value={client}>
      {children}
    </ApiClientContext.Provider>
  )
}

