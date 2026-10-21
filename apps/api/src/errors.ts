export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
  }
}

export function invalidCredentials(): ApiError {
  return new ApiError(
    401,
    "INVALID_CREDENTIALS",
    "Unable to authenticate. Sign in with an existing method or try again."
  );
}
