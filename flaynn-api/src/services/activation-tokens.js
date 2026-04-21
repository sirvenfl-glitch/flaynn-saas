import crypto from 'node:crypto';
import { pool } from '../config/db.js';

// 72h : laisse au fondateur le temps de l'utiliser même si l'email arrive un vendredi soir.
const TOKEN_TTL_HOURS = 72;
const TOKEN_BYTES = 32;

export function hashToken(tokenClear) {
  return crypto.createHash('sha256').update(tokenClear).digest('hex');
}

export async function issueActivationToken({ email, referenceId }) {
  const tokenClear = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  const tokenHash = hashToken(tokenClear);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 3600 * 1000);
  await pool.query(
    `INSERT INTO account_activations (token_hash, email, reference_id, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [tokenHash, email, referenceId, expiresAt]
  );
  return { tokenClear, tokenHash, expiresAt };
}

// Lecture sans consommation : alimente la page /auth/activate (pré-remplit le formulaire).
export async function lookupActivationToken(tokenClear) {
  if (typeof tokenClear !== 'string' || tokenClear.length < 20 || tokenClear.length > 100) {
    return { ok: false, reason: 'TOKEN_INVALID' };
  }
  const tokenHash = hashToken(tokenClear);
  const { rows } = await pool.query(
    `SELECT a.email, a.expires_at, a.used_at, s.startup_name
     FROM account_activations a
     LEFT JOIN scores s ON s.reference_id = a.reference_id
     WHERE a.token_hash = $1`,
    [tokenHash]
  );
  if (rows.length === 0) return { ok: false, reason: 'TOKEN_INVALID' };
  const row = rows[0];
  if (row.used_at) return { ok: false, reason: 'TOKEN_ALREADY_USED' };
  if (new Date(row.expires_at) < new Date()) return { ok: false, reason: 'TOKEN_EXPIRED' };
  return { ok: true, email: row.email, startupName: row.startup_name };
}

// Validation pour /api/auth/register : ne marque pas le token used (le caller le fait après INSERT user OK).
export async function validateActivationToken(tokenClear) {
  if (typeof tokenClear !== 'string' || tokenClear.length < 20 || tokenClear.length > 100) {
    return { ok: false, reason: 'TOKEN_INVALID' };
  }
  const tokenHash = hashToken(tokenClear);
  const { rows } = await pool.query(
    `SELECT email, reference_id, expires_at, used_at
     FROM account_activations WHERE token_hash = $1`,
    [tokenHash]
  );
  if (rows.length === 0) return { ok: false, reason: 'TOKEN_INVALID' };
  const row = rows[0];
  if (row.used_at) return { ok: false, reason: 'TOKEN_ALREADY_USED' };
  if (new Date(row.expires_at) < new Date()) return { ok: false, reason: 'TOKEN_EXPIRED' };
  return { ok: true, email: row.email, referenceId: row.reference_id, tokenHash };
}

export async function markTokenUsed(tokenHash) {
  await pool.query(
    `UPDATE account_activations SET used_at = NOW() WHERE token_hash = $1 AND used_at IS NULL`,
    [tokenHash]
  );
}

// Pré-check côté webhook /certify : évite d'émettre 2 tokens si certify est rappelé.
export async function hasUnusedActivationFor(referenceId) {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM account_activations
     WHERE reference_id = $1 AND used_at IS NULL AND expires_at > NOW()
     LIMIT 1`,
    [referenceId]
  );
  return rowCount > 0;
}
