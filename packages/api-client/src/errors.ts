// ---------------------------------------------------------------------------
// Base error
// ---------------------------------------------------------------------------

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

// ---------------------------------------------------------------------------
// Specific subtypes — matched by status + code
// ---------------------------------------------------------------------------

/** 401 UNAUTHORIZED — token missing, invalid, or expired. */
export class ApiAuthError extends ApiClientError {
  constructor(message: string, details?: unknown) {
    super(401, "UNAUTHORIZED", message, details);
    this.name = "ApiAuthError";
  }
}

/** 403 FORBIDDEN — authenticated but not allowed for this role. */
export class ApiForbiddenError extends ApiClientError {
  constructor(code: string, message: string, details?: unknown) {
    super(403, code, message, details);
    this.name = "ApiForbiddenError";
  }
}

/** 404 NOT_FOUND — the requested resource does not exist. */
export class ApiNotFoundError extends ApiClientError {
  constructor(code: string, message: string, details?: unknown) {
    super(404, code, message, details);
    this.name = "ApiNotFoundError";
  }
}

/** 409 NO_ACTIVE_EVENT — the operation requires an active event but none exists. */
export class ApiNoActiveEventError extends ApiClientError {
  constructor(message: string, details?: unknown) {
    super(409, "NO_ACTIVE_EVENT", message, details);
    this.name = "ApiNoActiveEventError";
  }
}

/** 409 PRINTER_* — printer-specific conflict (connection failure, not found, etc.).
 *  `target` is the address that was attempted; `hint` is a human-readable suggestion. */
export class ApiPrinterError extends ApiClientError {
  constructor(
    code: string,
    message: string,
    public readonly target?: string,
    public readonly hint?: string,
    details?: unknown,
  ) {
    super(409, code, message, details);
    this.name = "ApiPrinterError";
  }
}

/** 409 — any other conflict (duplicate name, already locked, etc.). */
export class ApiConflictError extends ApiClientError {
  constructor(code: string, message: string, details?: unknown) {
    super(409, code, message, details);
    this.name = "ApiConflictError";
  }
}

/** 422 — server-side validation failure on the submitted body. */
export class ApiValidationError extends ApiClientError {
  constructor(message: string, details?: unknown) {
    super(422, "UNPROCESSABLE_ENTITY", message, details);
    this.name = "ApiValidationError";
  }
}
