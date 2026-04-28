import {
  AdminSessionStartResponseSchema,
  AuthLoginResponseSchema,
  AuthMeResponseSchema,
  MasterSessionStartResponseSchema,
} from "@serva/shared-types";
import type {
  AdminSessionStartRequest,
  AdminSessionStartResponse,
  AuthLoginRequest,
  AuthLoginResponse,
  AuthMeResponse,
  MasterSessionStartRequest,
  MasterSessionStartResponse,
} from "@serva/shared-types";
import type { HttpTransport } from "../http.js";

export interface AuthClient {
  loginMaster(body: MasterSessionStartRequest): Promise<MasterSessionStartResponse>;
  loginAdmin(body: AdminSessionStartRequest): Promise<AdminSessionStartResponse>;
  loginWaiter(body: AuthLoginRequest): Promise<AuthLoginResponse>;
  me(): Promise<AuthMeResponse>;
}

export function createAuthClient(http: HttpTransport): AuthClient {
  return {
    loginMaster: (body) =>
      http.post(MasterSessionStartResponseSchema, "/auth/master/login", body),

    loginAdmin: (body) =>
      http.post(AdminSessionStartResponseSchema, "/auth/admin/login", body),

    loginWaiter: (body) =>
      http.post(AuthLoginResponseSchema, "/auth/login", body),

    me: () =>
      http.get(AuthMeResponseSchema, "/auth/me"),
  };
}
