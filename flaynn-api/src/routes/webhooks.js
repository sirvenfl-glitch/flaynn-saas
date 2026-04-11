import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import { pool } from '../config/db.js';


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

    const parsed = WebhookPayloadSchema.parse(request.body);

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

  // Endpoint 2 : Recevoir le PDF du rapport depuis n8n
  fastify.post('/api/webhooks/n8n/pdf', {
    config: { rateLimit: { max: 50, timeWindow: '1 minute' } },
    bodyLimit: 10 * 1024 * 1024
  }, async (request, reply) => {
    const signature = request.headers['x-flaynn-signature'];
    if (!verifySignature(signature, process.env.N8N_SECRET_TOKEN)) {
      request.log.warn('[SECOPS] Tentative d\'acces non autorisee au webhook n8n/pdf');
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Signature invalide.' });
    }

    const parsed = PdfPayloadSchema.parse(request.body);

    await pool.query(
      `INSERT INTO scores (reference_id, data) VALUES ($1, jsonb_build_object('pdf_base64', $2::jsonb))
       ON CONFLICT (reference_id) DO UPDATE SET data = jsonb_set(COALESCE(scores.data, '{}'::jsonb), '{pdf_base64}', $2::jsonb)`,
      [parsed.reference, JSON.stringify(parsed.pdf_base64)]
    );

    return reply.code(200).send({ success: true, message: 'PDF stocke avec succes.' });
  });
}