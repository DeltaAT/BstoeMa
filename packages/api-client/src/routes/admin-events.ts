import {
  ActiveEventResponseSchema,
  AdminEventActivateResponseSchema,
  AdminEventCreateRequestSchema,
  AdminEventCreateResponseSchema,
  AdminEventDeactivateResponseSchema,
  type ActiveEventResponse,
  type AdminEventActivateResponse,
  type AdminEventCreateRequest,
  type AdminEventCreateResponse,
  type AdminEventDeactivateResponse,
} from "@serva/shared-types";
import type { HttpTransport } from "../http.js";

export interface AdminEventsClient {
  create(body: AdminEventCreateRequest): Promise<AdminEventCreateResponse>;
  activate(eventId: number): Promise<AdminEventActivateResponse>;
  deactivate(eventId: number): Promise<AdminEventDeactivateResponse>;
  /** Closes the event permanently (sets `closedAt`). A closed event cannot be re-activated. */
  close(eventId: number): Promise<AdminEventDeactivateResponse>;
  getActive(): Promise<ActiveEventResponse>;
  delete(eventId: number): Promise<void>;
}

export function createAdminEventsClient(http: HttpTransport): AdminEventsClient {
  return {
    create: (body) =>
      http.post(
        AdminEventCreateResponseSchema,
        "/admin/events",
        AdminEventCreateRequestSchema.parse(body),
      ),

    activate: (eventId) =>
      http.post(AdminEventActivateResponseSchema, `/admin/events/${eventId}/activate`),

    deactivate: (eventId) =>
      http.post(AdminEventDeactivateResponseSchema, `/admin/events/${eventId}/deactivate`),

    close: (eventId) =>
      http.post(AdminEventDeactivateResponseSchema, `/admin/events/${eventId}/close`),

    getActive: () =>
      http.get(ActiveEventResponseSchema, "/admin/events/active"),

    delete: (eventId) =>
      http.deleteVoid(`/admin/events/${eventId}`),
  };
}
