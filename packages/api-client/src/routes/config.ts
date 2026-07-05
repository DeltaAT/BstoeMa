import {
  ConfigGetResponseSchema,
  ConfigPatchRequestSchema,
  ConfigPatchResponseSchema,
  type ConfigGetResponse,
  type ConfigPatchRequest,
  type ConfigPatchResponse,
} from "@bstoema/shared-types";
import type { HttpTransport } from "../http.js";

export interface ConfigClient {
  get(): Promise<ConfigGetResponse>;
  patch(body: ConfigPatchRequest): Promise<ConfigPatchResponse>;
}

export function createConfigClient(http: HttpTransport): ConfigClient {
  return {
    get: () =>
      http.get(ConfigGetResponseSchema, "/config"),

    patch: (body) =>
      http.patch(
        ConfigPatchResponseSchema,
        "/config",
        ConfigPatchRequestSchema.parse(body),
      ),
  };
}
