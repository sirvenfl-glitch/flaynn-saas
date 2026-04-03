import { z } from 'zod';
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
    // Vérification stricte du token interne (Zero Trust Policy)
    const signature = request.headers['x-flaynn-signature'];
    if (!signature || signature !== process.env.N8N_SECRET_TOKEN) {
      request.log.warn('Tentative d\'accès non autorisée au webhook n8n');
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Signature invalide.' });
    }

    const parsed = WebhookPayloadSchema.parse(request.body);

    // Mise à jour de la base de données avec le résultat de l'IA
    const { rowCount } = await pool.query(
      'UPDATE scores SET data = $1 WHERE reference_id = $2',
      [JSON.stringify(parsed.data), parsed.reference]
    );

    if (rowCount === 0) {
      request.log.error(`Réception n8n: Référence ${parsed.reference} introuvable en DB.`);
      throw new FlaynnError('Référence introuvable', 404, 'NOT_FOUND');
    }

    return reply.code(200).send({ success: true, message: 'Score mis à jour avec succès.' });
  });
}