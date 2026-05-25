import {
  LogsResponseSchema,
  type LogsQuery,
  type LogsResponse,
} from "@serva/shared-types";
import type { HttpTransport, QueryParams } from "../http.js";

export interface LogsClient {
  list(query?: LogsQuery): Promise<LogsResponse>;
}

export function createLogsClient(http: HttpTransport): LogsClient {
  return {
    list: (query) => {
      const params: QueryParams = {};
      if (query?.since !== undefined) params.since = query.since;
      if (query?.minLevel !== undefined) params.minLevel = query.minLevel;
      if (query?.limit !== undefined) params.limit = query.limit;
      return http.get(LogsResponseSchema, "/logs", params);
    },
  };
}
