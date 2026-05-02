import {
  createContext,
  useContext,
  useMemo,
  useRef,
} from "react";
import type { ReactNode } from "react";
import { createApiClient } from "@serva/api-client";
import type { ServaApiClient } from "@serva/api-client";
import { useAuth } from "@serva/auth-context";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ApiClientContext = createContext<ServaApiClient | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface ApiClientProviderProps {
  baseUrl: string;
  children: ReactNode;
}

/**
 * Wraps the typed Serva API client and makes it available via `useApiClient()`.
 * Must be rendered inside `<AuthProvider>` so it can access the current token.
 */
export function ApiClientProvider({ baseUrl, children }: ApiClientProviderProps) {
  const { token } = useAuth();

  // Keep a ref so the factory-created getToken closure always sees the latest
  // token without recreating the client on every render.
  const tokenRef = useRef<string | null>(token);
  tokenRef.current = token;

  const client = useMemo(
    () => createApiClient({ baseUrl, getToken: () => tokenRef.current }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseUrl],
  );

  return (
    <ApiClientContext.Provider value={client}>
      {children}
    </ApiClientContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useApiClient(): ServaApiClient {
  const ctx = useContext(ApiClientContext);
  if (!ctx) {
    throw new Error("useApiClient() must be used inside <ApiClientProvider>");
  }
  return ctx;
}
