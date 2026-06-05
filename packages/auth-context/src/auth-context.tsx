import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import type {
  SessionRole,
  UserDto,
  MasterSessionStartRequest,
  MasterSessionStartResponse,
  AdminSessionStartRequest,
  AdminSessionStartResponse,
  AuthLoginRequest,
  AuthLoginResponse,
} from "@serva/shared-types";
import { ApiClient, unauthorizedBus } from "./api-client.js";
import type { TokenStorage } from "./token-storage.js";

// ---------------------------------------------------------------------------
// Types exposed to consumers
// ---------------------------------------------------------------------------

export interface AuthUser {
  id?: number;
  username?: string;
  isLocked?: boolean;
}

export interface AuthState {
  /** Current access token, or null when logged out */
  token: string | null;
  /** Decoded role from the last login response */
  role: SessionRole | null;
  /** Event the token is scoped to (admin / waiter) */
  eventId: number | null;
  /** User details (waiter sessions) */
  user: AuthUser | null;
  /** True while rehydrating the token on first mount */
  isLoading: boolean;
  /** True when a login request is in-flight */
  isLoggingIn: boolean;
}

export type LoginMasterArgs = MasterSessionStartRequest;
export type LoginAdminArgs = AdminSessionStartRequest;
export type LoginWaiterArgs = AuthLoginRequest;

export interface AuthActions {
  loginMaster(args: LoginMasterArgs): Promise<void>;
  loginAdmin(args: LoginAdminArgs): Promise<void>;
  loginWaiter(args: LoginWaiterArgs): Promise<void>;
  logout(): void;
}

export type AuthContextValue = AuthState & AuthActions & { api: ApiClient };

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface AuthProviderProps {
  children: ReactNode;
  /** Base URL of the Serva API */
  baseUrl: string;
  /** Platform-specific token store */
  tokenStorage: TokenStorage;
  /** Called after logout (e.g. navigate to /login). Optional. */
  onLogout?: () => void;
}

export function AuthProvider({
  children,
  baseUrl,
  tokenStorage,
  onLogout,
}: AuthProviderProps) {
  // ---- state --------------------------------------------------------------
  const [token, setTokenState] = useState<string | null>(null);
  const [role, setRole] = useState<SessionRole | null>(null);
  const [eventId, setEventId] = useState<number | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Stable ref so the 401 listener always sees the latest onLogout
  const onLogoutRef = useRef(onLogout);
  onLogoutRef.current = onLogout;

  // ---- API client (stable across renders) ---------------------------------
  const api = useMemo(
    () => new ApiClient({ baseUrl, tokenStorage }),
    [baseUrl, tokenStorage],
  );

  // ---- helpers ------------------------------------------------------------
  const persistSession = useCallback(
    (t: string, r: SessionRole, eid: number | null, u: AuthUser | null) => {
      tokenStorage.setToken(t);
      setTokenState(t);
      setRole(r);
      setEventId(eid);
      setUser(u);
    },
    [tokenStorage],
  );

  const clearSession = useCallback(() => {
    tokenStorage.removeToken();
    setTokenState(null);
    setRole(null);
    setEventId(null);
    setUser(null);
    onLogoutRef.current?.();
  }, [tokenStorage]);

  // ---- rehydrate on mount -------------------------------------------------
  useEffect(() => {
    const existing = tokenStorage.getToken();
    if (!existing) {
      setIsLoading(false);
      return;
    }

    // Validate the token is still accepted by hitting /auth/me
    api
      .get<{ role: SessionRole; eventId?: number; user?: UserDto }>("/auth/me")
      .then((principal) => {
        setTokenState(existing);
        setRole(principal.role);
        setEventId(principal.eventId ?? null);
        setUser(principal.user ?? null);
      })
      .catch(() => {
        // Token rejected — expired, or signed with a previous JWT secret after
        // an app update. Clear both storage and in-memory state so the app
        // always falls back to the login screen instead of wedging on a stale
        // session; a fresh login then works regardless of the secret change.
        tokenStorage.removeToken();
        setTokenState(null);
        setRole(null);
        setEventId(null);
        setUser(null);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [api, tokenStorage]);

  // ---- listen for 401 from any API call -----------------------------------
  useEffect(() => {
    return unauthorizedBus.subscribe(() => {
      clearSession();
    });
  }, [clearSession]);

  // ---- login actions ------------------------------------------------------
  const loginMaster = useCallback(
    async (args: LoginMasterArgs) => {
      setIsLoggingIn(true);
      try {
        const res = await api.post<MasterSessionStartResponse>(
          "/auth/master/login",
          args,
        );
        persistSession(res.accessToken, "master", null, null);
      } finally {
        setIsLoggingIn(false);
      }
    },
    [api, persistSession],
  );

  const loginAdmin = useCallback(
    async (args: LoginAdminArgs) => {
      setIsLoggingIn(true);
      try {
        const res = await api.post<AdminSessionStartResponse>(
          "/auth/admin/login",
          args,
        );
        persistSession(res.accessToken, "admin", res.eventId, null);
      } finally {
        setIsLoggingIn(false);
      }
    },
    [api, persistSession],
  );

  const loginWaiter = useCallback(
    async (args: LoginWaiterArgs) => {
      setIsLoggingIn(true);
      try {
        const res = await api.post<AuthLoginResponse>("/auth/login", args);
        persistSession(
          res.accessToken,
          "waiter",
          res.eventId,
          res.user ?? null,
        );
      } finally {
        setIsLoggingIn(false);
      }
    },
    [api, persistSession],
  );

  // ---- context value (memoised) -------------------------------------------
  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      role,
      eventId,
      user,
      isLoading,
      isLoggingIn,
      api,
      loginMaster,
      loginAdmin,
      loginWaiter,
      logout: clearSession,
    }),
    [
      token,
      role,
      eventId,
      user,
      isLoading,
      isLoggingIn,
      api,
      loginMaster,
      loginAdmin,
      loginWaiter,
      clearSession,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth() must be used inside <AuthProvider>");
  }
  return ctx;
}
