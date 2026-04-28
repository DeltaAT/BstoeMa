import {
  UserCreateRequestSchema,
  UserCreateResponseSchema,
  UserGetResponseSchema,
  UsersResponseSchema,
  UserUpdateRequestSchema,
  UserUpdateResponseSchema,
  type UserCreateRequest,
  type UserCreateResponse,
  type UserGetResponse,
  type UsersQuery,
  type UsersResponse,
  type UserUpdateRequest,
  type UserUpdateResponse,
} from "@serva/shared-types";
import type { HttpTransport } from "../http.js";

export interface UsersClient {
  list(query?: UsersQuery): Promise<UsersResponse>;
  create(body: UserCreateRequest): Promise<UserCreateResponse>;
  getById(userId: number): Promise<UserGetResponse>;
  update(userId: number, body: UserUpdateRequest): Promise<UserUpdateResponse>;
  delete(userId: number): Promise<void>;
}

export function createUsersClient(http: HttpTransport): UsersClient {
  return {
    list: (query) =>
      http.get(UsersResponseSchema, "/users", {
        locked: query?.locked,
        search: query?.search,
      }),

    create: (body) =>
      http.post(
        UserCreateResponseSchema,
        "/users",
        UserCreateRequestSchema.parse(body),
      ),

    getById: (userId) =>
      http.get(UserGetResponseSchema, `/users/${userId}`),

    update: (userId, body) =>
      http.patch(
        UserUpdateResponseSchema,
        `/users/${userId}`,
        UserUpdateRequestSchema.parse(body),
      ),

    delete: (userId) =>
      http.deleteVoid(`/users/${userId}`),
  };
}
