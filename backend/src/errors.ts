/**
 * Typed application errors.
 *
 * Each subclass carries the HTTP status it should surface as, so the terminal
 * error handler can respond correctly without services needing to know anything
 * about HTTP. Anything thrown that is *not* an `AppError` is treated as an
 * unexpected fault and reported as a generic 500.
 */

export class AppError extends Error {
  readonly status: number;
  /** Stable, machine-readable discriminator. Safe to expose to clients. */
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
  }
}

/** 400 — the request was malformed or failed validation. */
export class ValidationError extends AppError {
  constructor(message: string, code = 'VALIDATION_ERROR') {
    super(message, 400, code);
  }
}

/** 400 — the supplied password does not meet the policy. */
export class PasswordPolicyError extends AppError {
  constructor(message: string) {
    super(message, 400, 'PASSWORD_POLICY');
  }
}

/** 401 — no valid credentials were presented. */
export class AuthenticationError extends AppError {
  constructor(message = 'Authentication required.', code = 'UNAUTHENTICATED') {
    super(message, 401, code);
  }
}

/**
 * 404 — the resource does not exist **within the caller's business**.
 *
 * A resource that exists but belongs to another tenant is reported this way
 * too, so the API never confirms the existence of another tenant's data.
 */
export class NotFoundError extends AppError {
  constructor(message = 'Resource not found.', code = 'NOT_FOUND') {
    super(message, 404, code);
  }
}

/** 403 — authenticated, but not permitted to perform this action. */
export class AuthorizationError extends AppError {
  constructor(message = 'You do not have permission to perform this action.') {
    super(message, 403, 'FORBIDDEN');
  }
}

/** 409 — the request conflicts with existing data. */
export class ConflictError extends AppError {
  constructor(message: string, code = 'CONFLICT') {
    super(message, 409, code);
  }
}

/** 429 — too many requests. */
export class RateLimitError extends AppError {
  constructor(message = 'Too many requests. Please try again later.') {
    super(message, 429, 'RATE_LIMITED');
  }
}
