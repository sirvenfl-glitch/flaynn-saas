export class FlaynnError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details = null) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class IntegrationError extends FlaynnError {
  constructor(message = 'Erreur de communication avec le service tiers', details = null) {
    super(message, 502, 'INTEGRATION_FAILED', details);
  }
}