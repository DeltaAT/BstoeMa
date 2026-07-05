import {
  AnnouncementCreateRequestSchema,
  AnnouncementCreateResponseSchema,
  AnnouncementsResponseSchema,
  type AnnouncementCreateRequest,
  type AnnouncementCreateResponse,
  type AnnouncementsQuery,
  type AnnouncementsResponse,
} from "@bstoema/shared-types";
import type { HttpTransport } from "../http.js";

export interface AnnouncementsClient {
  list(query?: AnnouncementsQuery): Promise<AnnouncementsResponse>;
  create(body: AnnouncementCreateRequest): Promise<AnnouncementCreateResponse>;
}

export function createAnnouncementsClient(http: HttpTransport): AnnouncementsClient {
  return {
    list: (query) =>
      http.get(AnnouncementsResponseSchema, "/announcements", query),

    create: (body) =>
      http.post(
        AnnouncementCreateResponseSchema,
        "/announcements",
        AnnouncementCreateRequestSchema.parse(body),
      ),
  };
}
