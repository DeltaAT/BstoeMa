import { ApiError } from "./api-error";
import { EventStore } from "./event-store";
import { MasterCredentialsStore } from "./master-credentials-store";
import type { UserStore } from "./user-store";

export class AuthStore {
  constructor(
    private readonly eventStore: EventStore,
    private readonly userStore: UserStore,
    private readonly masterCredentials = new MasterCredentialsStore()
  ) {}

  /**
   * Master credentials come from MASTER_USERNAME/MASTER_PASSWORD env vars when
   * set (dev, tests, advanced deployments). Otherwise the bundled desktop app
   * uses the file-backed store the operator populates via first-run setup.
   */
  private masterEnvConfigured(): boolean {
    return Boolean(process.env.MASTER_USERNAME && process.env.MASTER_PASSWORD);
  }

  isMasterConfigured(): boolean {
    return this.masterEnvConfigured() || this.masterCredentials.hasCredentials();
  }

  setupMaster(input: { username: string; password: string }) {
    if (this.isMasterConfigured()) {
      throw new ApiError(409, "MASTER_ALREADY_CONFIGURED", "Master credentials are already configured");
    }
    this.masterCredentials.create(input.username, input.password);
  }

  authenticateMaster(input: { username: string; password: string }) {
    if (this.masterEnvConfigured()) {
      if (
        input.username !== process.env.MASTER_USERNAME ||
        input.password !== process.env.MASTER_PASSWORD
      ) {
        throw new ApiError(401, "UNAUTHORIZED", "Invalid master credentials");
      }
      return;
    }

    if (!this.masterCredentials.hasCredentials()) {
      throw new ApiError(500, "MASTER_AUTH_NOT_CONFIGURED", "Master credentials are not configured");
    }

    if (!this.masterCredentials.verify(input.username, input.password)) {
      throw new ApiError(401, "UNAUTHORIZED", "Invalid master credentials");
    }
  }

  authenticateAdmin(input: { eventId: number; username: string; password: string }) {
    this.eventStore.verifyEventAdminCredentials(input.eventId, input.username, input.password);
    return { eventId: input.eventId };
  }

  loginWaiter(input: { username: string; eventPasscode: string }) {
    const eventId = this.eventStore.verifyActiveEventPasscode(input.eventPasscode);
    const user = this.userStore.getOrCreateUserForEvent(eventId, input.username);

    if (user.isLocked) {
      throw new ApiError(423, "USER_LOCKED", "User account is locked");
    }

    return {
      eventId,
      user,
    };
  }

  getPrincipalFromClaims(claims: {
    role: "master" | "admin" | "waiter";
    eventId?: number;
    username?: string;
  }) {
    if (claims.role === "master") {
      return { role: "master" as const };
    }

    if (claims.role === "admin") {
      if (!claims.eventId || !claims.username) {
        throw new ApiError(401, "UNAUTHORIZED", "Invalid admin token");
      }

      const event = this.eventStore.getEvent(claims.eventId);
      if (!event || event.adminUsername !== claims.username) {
        throw new ApiError(401, "UNAUTHORIZED", "Invalid admin token");
      }

      return {
        role: "admin" as const,
        eventId: claims.eventId,
      };
    }

    if (!claims.eventId || !claims.username) {
      throw new ApiError(401, "UNAUTHORIZED", "Invalid waiter token");
    }

    if (!this.eventStore.getEvent(claims.eventId)) {
      throw new ApiError(401, "UNAUTHORIZED", "Invalid waiter token");
    }

    const user = this.userStore.getUserForEventByUsername(claims.eventId, claims.username);
    if (!user) {
      throw new ApiError(401, "UNAUTHORIZED", "Waiter session not found");
    }

    if (user.isLocked) {
      throw new ApiError(423, "USER_LOCKED", "User account is locked");
    }

    return {
      role: "waiter" as const,
      eventId: claims.eventId,
      user: {
        id: user.id,
        username: user.username,
        isLocked: user.isLocked,
      },
    };
  }
}

