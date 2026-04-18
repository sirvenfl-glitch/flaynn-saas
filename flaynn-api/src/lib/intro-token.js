import { createHmac, timingSafeEqual } from 'node:crypto';

// 30 jours — au-delà, le token est expiré et le BA doit demander un nouveau digest.
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function getSecret() {
  const s = process.env.INTRO_TOKEN_SECRET;
  if (!s || s.length < 32) {
    throw new Error('INTRO_TOKEN_SECRET missing or shorter than 32 chars');
  }
  return s;
}

function hmac(payload) {
  return createHmac('sha256', getSecret()).update(payload).digest();
}

export function signIntroToken(baId, cardId, now = Date.now()) {
  if (!Number.isInteger(baId) || baId <= 0) throw new Error('baId must be a positive integer');
  if (!Number.isInteger(cardId) || cardId <= 0) throw new Error('cardId must be a positive integer');

  const payload = `${baId}:${cardId}:${now}`;
  const sigHex = hmac(payload).toString('hex');
  return Buffer.from(`${payload}:${sigHex}`, 'utf8').toString('base64url');
}

export function verifyIntroToken(token, now = Date.now()) {
  if (typeof token !== 'string' || token.length === 0 || token.length > 512) {
    throw new Error('Invalid token format');
  }

  let decoded;
  try {
    decoded = Buffer.from(token, 'base64url').toString('utf8');
  } catch {
    throw new Error('Invalid token encoding');
  }

  const parts = decoded.split(':');
  if (parts.length !== 4) throw new Error('Invalid token structure');

  const [baIdStr, cardIdStr, tsStr, sigHex] = parts;
  const baId = Number(baIdStr);
  const cardId = Number(cardIdStr);
  const ts = Number(tsStr);

  if (!Number.isInteger(baId) || baId <= 0) throw new Error('Invalid ba_id');
  if (!Number.isInteger(cardId) || cardId <= 0) throw new Error('Invalid card_id');
  if (!Number.isInteger(ts) || ts <= 0) throw new Error('Invalid timestamp');
  if (!/^[0-9a-f]{64}$/.test(sigHex)) throw new Error('Invalid signature format');

  const expected = hmac(`${baId}:${cardId}:${ts}`);
  const provided = Buffer.from(sigHex, 'hex');

  // timingSafeEqual exige des buffers de longueur identique : déjà garanti
  // par la regex /^[0-9a-f]{64}$/ (32 octets) côté provided et le digest sha256
  // côté expected. Mais on ajoute la garde au cas où.
  if (provided.length !== expected.length) throw new Error('Invalid signature length');
  if (!timingSafeEqual(provided, expected)) throw new Error('Invalid signature');

  // Expiration vérifiée APRÈS la signature — on ne révèle pas l'expiration
  // d'un token dont la signature aurait pu être forgée.
  if (now - ts > TOKEN_TTL_MS) throw new Error('Token expired');
  if (ts > now + 60_000) throw new Error('Token timestamp in the future');

  return { baId, cardId, issuedAt: ts };
}
