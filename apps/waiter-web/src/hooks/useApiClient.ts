import { useContext } from 'react'
import type { ServaApiClient } from '@serva/api-client'
import { ApiClientContext } from '../contexts/api-client-context'

export function useApiClient(): ServaApiClient {
  const ctx = useContext(ApiClientContext)
  if (!ctx) {
    throw new Error('useApiClient() must be used inside <ApiClientProvider>')
  }
  
  return ctx
}
