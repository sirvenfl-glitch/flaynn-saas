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

/** Codes SQLSTATE PostgreSQL : échec / perte de connexion (pas une erreur métier type 23505) */
const PG_UNAVAILABLE = new Set([
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '08007',
  '57P01',
  '57P02',
  '57P03',
  '57P04',
  '57P05'
]);

/** Erreurs réseau / pool PG typiques quand la base est injoignable ou saturée */
export function isDbUnavailableError(err) {
  if (!err || typeof err !== 'object') return false;
  const c = err.code;
  if (typeof c === 'string') {
    if (['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'ECONNRESET'].includes(c)) {
      return true;
    }
    if (PG_UNAVAILABLE.has(c)) return true;
  }
  const msg = String(err.message || '');
  if (/connection.*(refused|terminated|closed)|timeout|ECONNREFUSED|getaddrinfo/i.test(msg)) {
    return true;
  }
  return false;
}