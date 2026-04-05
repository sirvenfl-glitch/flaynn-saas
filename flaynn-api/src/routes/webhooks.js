import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import { pool } from '../config/db.js';
import { FlaynnError } from '../utils/errors.js';

const WebhookPayloadSchema = z.object({
  reference: z.string(),
  data: z.record(z.any()) // Validation souple car la structure de Claude peut varier
}).strict();

export default async function webhookRoutes(fastify) {
  fastify.post('/api/webhooks/n8n/score', {
    config: {
      rateLimit: { max: 100, timeWindow: '1 minute' }
    }
  }, async (request, reply) => {
    // ARCHITECT-PRIME: Vérification en temps constant pour immuniser contre les timing attacks
    const signature = request.headers['x-flaynn-signature'];
    const expected = process.env.N8N_SECRET_TOKEN;
    if (!signature || !expected || signature.length !== expected.length ||
        !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      request.log.warn('[SECOPS] Tentative d\'accès non autorisée au webhook n8n');
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Signature invalide.' });
    }

    const parsed = WebhookPayloadSchema.parse(request.body);

    // Mise à jour de la base de données avec le résultat de l'IA
    const { rowCount } = await pool.query(
  'INSERT INTO scores (reference_id, data) VALUES ($1, $2) ON CONFLICT (reference_id) DO UPDATE SET data = $2',
  [parsed.reference, JSON.stringify(parsed.data)]
);

  

    return reply.code(200).send({ success: true, message: 'Score mis à jour avec succès.' });
  });
}