/** Domain error with a stable machine-readable code, mapped by the global exception filter. */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const ERROR_CODES = {
  unauthenticated: 'AUTHENTICATION_REQUIRED',
  invalidCredentials: 'AUTH_INVALID_CREDENTIALS',
  accountLocked: 'AUTH_ACCOUNT_LOCKED',
  accountDisabled: 'AUTH_ACCOUNT_DISABLED',
  csrfInvalid: 'CSRF_TOKEN_INVALID',
  forbidden: 'AUTHORIZATION_FORBIDDEN',
  escalationBlocked: 'AUTHORIZATION_ESCALATION_BLOCKED',
  notFound: 'NOT_FOUND',
  conflict: 'CONFLICT',
  validation: 'VALIDATION_ERROR',
  internal: 'INTERNAL_ERROR',
} as const;
