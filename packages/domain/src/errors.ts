export class StoneError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = "StoneError";
    this.code = code;
  }
}

export class ValidationError extends StoneError {
  public constructor(message: string) {
    super("validation", message);
    this.name = "ValidationError";
  }
}

export class StorageError extends StoneError {
  public constructor(message: string) {
    super("storage", message);
    this.name = "StorageError";
  }
}

export class AuthError extends StoneError {
  public constructor(message: string) {
    super("auth", message);
    this.name = "AuthError";
  }
}
