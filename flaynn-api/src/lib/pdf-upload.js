/**
 * Helpers métier PDF/documents — Delta 13.
 *
 * Niveau : couche métier au-dessus de lib/r2-storage.js.
 *  - r2-storage.js = couche S3 bas-niveau (signe les requêtes, parle à R2).
 *  - pdf-upload.js = helpers métier (valide l'extension, extrait le base64,
 *    mappe les MIME types). Ne parle pas à R2 directement.
 *
 * Consommateurs : routes/scoring.js (POST /api/score) et routes/stripe.js
 * (POST /api/checkout + handler checkout.session.completed).
 */

import { extname } from 'node:path';

export const ALLOWED_EXTRA_EXTENSIONS = new Set(['.pdf', '.pptx', '.docx']);

// Mapping partagé extension → MIME pour extra_docs (upload R2 + routes legacy GET).
export const EXTRA_MIME_MAP = {
  '.pdf': 'application/pdf',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/**
 * Décode un payload base64 (data URI optionnel) en Buffer.
 * @param {string} input - base64 brut ou data URI "data:<mime>;base64,<b64>"
 * @returns {{ buffer: Buffer, contentType: string|null }}
 * @throws Error si input vide, data URI malformé, ou buffer décodé vide.
 */
export function extractBase64Payload(input) {
  if (typeof input !== 'string' || input.length === 0) {
    throw new Error('base64 payload empty');
  }
  let contentType = null;
  let b64 = input;
  if (input.startsWith('data:')) {
    const match = /^data:([^;,]+);base64,(.+)$/.exec(input);
    if (!match) throw new Error('invalid data URI');
    contentType = match[1];
    b64 = match[2];
  }
  const buffer = Buffer.from(b64, 'base64');
  if (buffer.length === 0) {
    throw new Error('base64 decode produced empty buffer');
  }
  return { buffer, contentType };
}

/**
 * Normalise une extension de fichier vers un whitelist {.pdf, .pptx, .docx}.
 * Fallback vers .pdf si extension absente ou non autorisée.
 * @param {string} filename
 * @returns {'.pdf' | '.pptx' | '.docx'}
 */
export function sanitizeExtension(filename) {
  if (typeof filename !== 'string' || filename.length === 0) return '.pdf';
  const ext = extname(filename).toLowerCase();
  return ALLOWED_EXTRA_EXTENSIONS.has(ext) ? ext : '.pdf';
}
