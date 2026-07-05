import {
  ActiveEventResponseSchema,
  AdminEventActivateResponseSchema,
  AdminEventCreateRequestSchema,
  AdminEventCreateResponseSchema,
  AdminEventDeactivateResponseSchema,
  EventListResponseSchema,
  EventPasscodeResponseSchema,
  RotatePasscodeRequestSchema,
  RotatePasscodeResponseSchema,
  type ActiveEventResponse,
  type AdminEventActivateResponse,
  type AdminEventCreateRequest,
  type AdminEventCreateResponse,
  type AdminEventDeactivateResponse,
  type EventListResponse,
  type EventPasscodeResponse,
  type RotatePasscodeResponse,
} from "@bstoema/shared-types";
import type { HttpTransport } from "../http.js";

export interface AdminEventsClient {
  list(): Promise<EventListResponse>;
  create(body: AdminEventCreateRequest): Promise<AdminEventCreateResponse>;
  activate(eventId: number): Promise<AdminEventActivateResponse>;
  deactivate(eventId: number): Promise<AdminEventDeactivateResponse>;
  /** Closes the event permanently (sets `closedAt`). A closed event cannot be re-activated. */
  close(eventId: number): Promise<AdminEventDeactivateResponse>;
  getActive(): Promise<ActiveEventResponse>;
  delete(eventId: number): Promise<void>;
  /** Returns the plaintext passcode of the currently active event (admin-scoped). */
  getPasscode(): Promise<EventPasscodeResponse>;
  /** Rotates the passcode of the currently active event and returns the new value. */
  rotatePasscode(newPasscode: string): Promise<RotatePasscodeResponse>;
}

export function createAdminEventsClient(http: HttpTransport): AdminEventsClient {
  return {
    list: () =>
      http.get(EventListResponseSchema, "/admin/events"),

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

    getPasscode: () =>
      http.get(EventPasscodeResponseSchema, "/admin/event-passcode"),

    rotatePasscode: (newPasscode) =>
      http.put(
        RotatePasscodeResponseSchema,
        "/admin/event-passcode",
        RotatePasscodeRequestSchema.parse({ newPasscode }),
      ),
  };
}
