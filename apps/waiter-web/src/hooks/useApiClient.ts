import { useContext } from 'react'
import type { BstoemaApiClient } from '@bstoema/api-client'
import { ApiClientContext } from '../contexts/api-client-context'

export function useApiClient(): BstoemaApiClient {
  const ctx = useContext(ApiClientContext)
  if (!ctx) {
    throw new Error('useApiClient() must be used inside <ApiClientProvider>')
  }
  
  return ctx
}
