import {
  AdminSessionStartResponseSchema,
  AuthLoginResponseSchema,
  AuthMeResponseSchema,
  MasterSessionStartResponseSchema,
  MasterSetupResponseSchema,
  MasterStatusResponseSchema,
} from "@bstoema/shared-types";
import type {
  AdminSessionStartRequest,
  AdminSessionStartResponse,
  AuthLoginRequest,
  AuthLoginResponse,
  AuthMeResponse,
  MasterSessionStartRequest,
  MasterSessionStartResponse,
  MasterSetupRequest,
  MasterSetupResponse,
  MasterStatusResponse,
} from "@bstoema/shared-types";
import type { HttpTransport } from "../http.js";

export interface AuthClient {
  masterStatus(): Promise<MasterStatusResponse>;
  masterSetup(body: MasterSetupRequest): Promise<MasterSetupResponse>;
  loginMaster(body: MasterSessionStartRequest): Promise<MasterSessionStartResponse>;
  loginAdmin(body: AdminSessionStartRequest): Promise<AdminSessionStartResponse>;
  loginWaiter(body: AuthLoginRequest): Promise<AuthLoginResponse>;
  me(): Promise<AuthMeResponse>;
}

export function createAuthClient(http: HttpTransport): AuthClient {
  return {
    masterStatus: () =>
      http.get(MasterStatusResponseSchema, "/auth/master/status"),

    masterSetup: (body) =>
      http.post(MasterSetupResponseSchema, "/auth/master/setup", body),

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
