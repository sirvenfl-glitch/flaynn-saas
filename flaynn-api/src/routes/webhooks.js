import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import { pool } from '../config/db.js';
import { putObject } from '../lib/r2-storage.js';


const WebhookPayloadSchema = z.object({
  reference: z.string(),
  data: z.record(z.string(), z.any())
});

const PdfPayloadSchema = z.object({
  reference: z.string(),
  pdf_base64: z.string()
}).strict();

function verifySignature(signature, expected) {
  if (!signature || !expected || signature.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// ARCHITECT-PRIME: Delta 13 — helper local, ciblé PDF uniquement.
// Volontairement distinct de extractBase64Payload() de scoring.js : ici on impose
// un seuil de sanité > 100 bytes pour rejeter les payloads garbage de n8n.
function decodeBase64Pdf(input) {
  if (typeof input !== 'string' || input.length === 0) {
    throw new Error('Invalid base64');
  }
  let b64 = input;
  if (input.startsWith('data:')) {
    const match = /^data:[^;,]+;base64,(.+)$/.exec(input);
    if (!match) throw new Error('Invalid base64');
    b64 = match[1];
  }
  const buffer = Buffer.from(b64, 'base64');
  if (buffer.length < 100) {
    throw new Error('Invalid base64');
  }
  return buffer;
}

export default async function webhookRoutes(fastify) {

  // Endpoint 1 : Recevoir le scoring de n8n
  fastify.post('/api/webhooks/n8n/score', {
    config: { rateLimit: { max: 100, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const signature = request.headers['x-flaynn-signature'];
    if (!verifySignature(signature, process.env.N8N_SECRET_TOKEN)) {
      request.log.warn('[SECOPS] Tentative d\'acces non autorisee au webhook n8n/score');
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Signature invalide.' });
    }

    let parsed;
    try {
      parsed = WebhookPayloadSchema.parse(request.body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.code(422).send({
          error: 'VALIDATION_FAILED',
          details: err.flatten().fieldErrors,
        });
      }
      throw err;
    }

    // Vérifier que la référence existe en DB avant de merger
    const exists = await pool.query('SELECT 1 FROM scores WHERE reference_id = $1', [parsed.reference]);
    if (exists.rowCount === 0) {
      request.log.warn(`[SECOPS] Webhook n8n/score reçu pour référence inexistante: ${parsed.reference}`);
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Référence inconnue.' });
    }

    // ARCHITECT-PRIME: force un statut "completed" si n8n n'en fournit pas
    const scoringData = { ...parsed.data, status: parsed.data.status || 'completed' };

    // ARCHITECT-PRIME: || fusionne le JSONB au lieu d'écraser — préserve payload (réconciliation auth)
    // et pitch_deck_base64 (endpoint /api/decks/:ref) tout en ajoutant les résultats du scoring
    await pool.query(
      `INSERT INTO scores (reference_id, data) VALUES ($1, $2::jsonb)
       ON CONFLICT (reference_id) DO UPDATE SET data = scores.data || $2::jsonb`,
      [parsed.reference, JSON.stringify(scoringData)]
    );

    return reply.code(200).send({ success: true, message: 'Score mis a jour avec succes.' });
  });

  // Endpoint 2 : Recevoir le PDF du rapport depuis n8n → upload R2 + metadata DB
  fastify.post('/api/webhooks/n8n/pdf', {
    config: { rateLimit: { max: 50, timeWindow: '1 minute' } },
    bodyLimit: 10 * 1024 * 1024
  }, async (request, reply) => {
    const signature = request.headers['x-flaynn-signature'];
    if (!verifySignature(signature, process.env.N8N_SECRET_TOKEN)) {
      request.log.warn('[SECOPS] Tentative d\'acces non autorisee au webhook n8n/pdf');
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Signature invalide.' });
    }

    let parsed;
    try {
      parsed = PdfPayloadSchema.parse(request.body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.code(422).send({
          error: 'VALIDATION_FAILED',
          details: err.flatten().fieldErrors,
        });
      }
      throw err;
    }

    // Référence doit exister : évite de créer un row orphelin via UPDATE sur ref inconnue
    // (parallèle défensif avec /api/webhooks/n8n/score).
    const exists = await pool.query('SELECT 1 FROM scores WHERE reference_id = $1', [parsed.reference]);
    if (exists.rowCount === 0) {
      request.log.warn(`[SECOPS] Webhook n8n/pdf reçu pour référence inexistante: ${parsed.reference}`);
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Référence inconnue.' });
    }

    // Décodage base64 + sanity check (≥ 100 bytes). Pas d'upload R2 sur garbage.
    let buffer;
    try {
      buffer = decodeBase64Pdf(parsed.pdf_base64);
    } catch {
      request.log.warn({ reference: parsed.reference }, 'webhook_pdf_invalid_base64');
      return reply.code(400).send({ error: 'INVALID_PDF', message: 'PDF invalide ou trop petit.' });
    }

    // Upload R2. Si échec : 502, aucune mutation DB (préférable à enregistrer un storage fantôme).
    let meta;
    try {
      const key = `reports/${parsed.reference}.pdf`;
      meta = await putObject(key, buffer, 'application/pdf', { logger: request.log });
    } catch (err) {
      request.log.error({ err, reference: parsed.reference }, 'webhook_pdf_r2_upload_failed');
      return reply.code(502).send({
        error: 'STORAGE_UNAVAILABLE',
        message: 'Le stockage est temporairement indisponible. Réessayez dans quelques instants.',
      });
    }

    const storageMeta = {
      kind: 'r2',
      key: meta.key,
      size: meta.size,
      content_type: 'application/pdf',
      uploaded_at: new Date().toISOString(),
    };

    try {
      await pool.query(
        `UPDATE scores SET data = jsonb_set(data, '{pdf_report_storage}', $2::jsonb) WHERE reference_id = $1`,
        [parsed.reference, JSON.stringify(storageMeta)]
      );
    } catch (err) {
      // R2 upload OK mais DB KO → orphelin R2 (cf. TODO tracker, cleanup V2).
      // Log dédié pour retrouver la key et nettoyer manuellement.
      request.log.error(
        { err, reference: parsed.reference, r2_key: meta.key },
        'webhook_pdf_db_update_failed_r2_orphan'
      );
      return reply.code(500).send({
        error: 'INTERNAL_ERROR',
        message: 'Erreur serveur lors de l\'enregistrement du PDF.',
      });
    }

    return reply.code(200).send({
      success: true,
      message: 'PDF stocké sur R2.',
      key: meta.key,
      size: meta.size,
    });
  });
}