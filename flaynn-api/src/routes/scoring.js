import { z } from 'zod';
import { n8nBridge } from '../services/n8n-bridge.js';
import { pool } from '../config/db.js';

// Schéma Zod strict - Red Team Policy
const ScoreSubmissionSchema = z.object({
  startup_name: z.string().trim().min(2).max(100).regex(/^[\p{L}\p{N}\s\-'.&]+$/u),
  url: z.union([z.string().trim().url().max(500), z.literal('').transform(() => undefined)]).optional(),
  email: z.string().email().max(254),
  sector: z.enum(['fintech','healthtech','saas','marketplace','deeptech','greentech','other']),
  stage: z.enum(['idea','mvp','seed','serieA','serieB_plus']),
  pitch: z.string().trim().min(50).max(2000),
  revenue_monthly: z.number().nonnegative().max(100_000_000).optional(),
  team_size: z.number().int().min(1).max(10000).optional()
}).strict();

export default async function scoringRoutes(fastify) {
  fastify.post('/api/score', {
    config: {
      rateLimit: { max: 3, timeWindow: '1 minute' }
    }
  }, async (request, reply) => {
    const parsed = ScoreSubmissionSchema.parse(request.body);

    const reference = `FLY-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    // 1. Résilience : Persistance initiale (Outbox)
    let userEmail = null;
    try {
      const userCheck = await pool.query('SELECT email FROM users WHERE email = $1', [parsed.email]);
      if (userCheck.rowCount > 0) userEmail = userCheck.rows[0].email;
    } catch (err) {
      request.log.warn('Vérification utilisateur échouée.');
    }

    const initialData = { status: 'pending_webhook', payload: parsed };
    await pool.query(
      'INSERT INTO scores (reference_id, user_email, startup_name, data) VALUES ($1, $2, $3, $4)',
      [reference, userEmail, parsed.startup_name, JSON.stringify(initialData)]
    );

    // 2. Délégation au webhook (Asynchrone). Si n8n plante, la base a quand même la trace.
    try {
      await n8nBridge.submitScore({ ...parsed, reference }, request.id);
    } catch (err) {
      request.log.error(err, `Échec n8n pour ${reference}, mais score persisté en attente.`);
    }

    return reply.code(200).send({ success: true, reference });
  });
}
