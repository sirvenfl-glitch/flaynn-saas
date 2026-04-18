/**
 * Wrapper Cloudflare R2 (S3-compatible) pour Flaynn — Delta 13.
 *
 * Design :
 *  - Lazy init du S3Client au 1er appel (pas au module load → n'impacte pas le boot).
 *  - Validation stricte des 4 env vars requises avec liste explicite des manquantes.
 *  - Signed URLs GET clampées entre 60s et 3600s (pas de lien > 1h).
 *  - Pré-check HeadObject sur PUT (best-effort) pour détecter les écrasements.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const REQUIRED_VARS = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];

function assertR2Configured() {
  const missing = REQUIRED_VARS.filter((name) => {
    const v = process.env[name];
    return typeof v !== 'string' || v.length === 0;
  });
  if (missing.length > 0) {
    throw new Error(`R2 not configured. Missing env vars: ${missing.join(', ')}`);
  }
}

let clientSingleton = null;

function getClient() {
  if (clientSingleton) return clientSingleton;
  assertR2Configured();
  const endpoint = process.env.R2_ENDPOINT
    || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  clientSingleton = new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  return clientSingleton;
}

function getBucket() {
  return process.env.R2_BUCKET;
}

function assertValidKey(key) {
  if (typeof key !== 'string' || key.length === 0) {
    throw new Error('Invalid R2 key');
  }
  // Défense en profondeur : refuser les patterns path traversal / suspects
  // même si l'appelant valide déjà en amont.
  if (key.includes('..')) throw new Error('Invalid R2 key');
  if (key.includes('//')) throw new Error('Invalid R2 key');
  if (/[\x00-\x1f\\]/.test(key)) throw new Error('Invalid R2 key');
  if (key.length >= 1024 || key.startsWith('/')) {
    throw new Error('Invalid R2 key');
  }
}

/**
 * Upload un objet vers R2. Détecte les écrasements via HeadObject (best-effort).
 * @param {string} key - Clé absolue dans le bucket (ex: "decks/FLY-XXX.pdf")
 * @param {Buffer|Uint8Array} body - Contenu binaire
 * @param {string} contentType - MIME type (ex: "application/pdf")
 * @param {{ logger?: { warn: Function } }} [options] - Logger optionnel (Pino-compatible)
 * @returns {Promise<{ key: string, size: number, etag: string }>}
 */
export async function putObject(key, body, contentType, options = {}) {
  assertValidKey(key);
  if (!Buffer.isBuffer(body) && !(body instanceof Uint8Array)) {
    throw new Error('putObject: body must be Buffer or Uint8Array');
  }
  const client = getClient();
  const Bucket = getBucket();
  const warn = typeof options.logger?.warn === 'function'
    ? options.logger.warn.bind(options.logger)
    : console.warn;

  // Pré-check HeadObject : best-effort. Un échec (404, réseau, etc.) ne bloque pas le PUT.
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
    warn({
      msg: 'r2_put_overwrite',
      key,
      existing_size: head.ContentLength,
      new_size: body.length,
    });
  } catch {
    // Objet inexistant ou erreur transitoire : on ignore.
  }

  const res = await client.send(new PutObjectCommand({
    Bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    ChecksumAlgorithm: 'CRC32',
  }));

  return { key, size: body.length, etag: res.ETag };
}

/**
 * Génère une URL signée GET pour un objet R2. TTL clampé entre 60s et 3600s.
 * @param {string} key
 * @param {number} [ttlSeconds=300]
 * @returns {Promise<string>}
 */
export async function getSignedGetUrl(key, ttlSeconds = 300) {
  assertValidKey(key);
  const client = getClient();
  const Bucket = getBucket();
  const expiresIn = Math.min(3600, Math.max(60, Number(ttlSeconds) || 300));
  return getSignedUrl(client, new GetObjectCommand({ Bucket, Key: key }), { expiresIn });
}

/**
 * Supprime un objet R2. Throw sur erreur (y compris 404).
 * @param {string} key
 * @returns {Promise<void>}
 */
export async function deleteObject(key) {
  assertValidKey(key);
  const client = getClient();
  const Bucket = getBucket();
  await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
}

/**
 * Lit les métadonnées d'un objet R2. Retourne null si l'objet n'existe pas.
 * @param {string} key
 * @returns {Promise<{ size: number, etag: string, contentType: string, lastModified: Date } | null>}
 */
export async function headObject(key) {
  assertValidKey(key);
  const client = getClient();
  const Bucket = getBucket();
  try {
    const res = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
    return {
      size: res.ContentLength,
      etag: res.ETag,
      contentType: res.ContentType,
      lastModified: res.LastModified,
    };
  } catch (err) {
    if (
      err?.name === 'NotFound'
      || err?.name === 'NoSuchKey'
      || err?.$metadata?.httpStatusCode === 404
    ) {
      return null;
    }
    throw err;
  }
}
