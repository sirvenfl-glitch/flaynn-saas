import { z } from 'zod';
import { pool } from '../config/db.js';
import { verifyIntroToken } from '../lib/intro-token.js';
import { isDbUnavailableError } from '../utils/errors.js';
import { n8nBridge } from '../services/n8n-bridge.js';

const IntroRequestSchema = z.object({
  token:   z.string().min(1).max(512),
  message: z.string().trim().max(1000).optional().default('')
}).strict();

export default async function baIntroRequestRoutes(fastify) {
  if (!process.env.INTRO_TOKEN_SECRET) {
    fastify.log.warn('[BA] INTRO_TOKEN_SECRET absent — route /api/ba/intro-request désactivée.');
    return;
  }

  fastify.post('/api/ba/intro-request', {
    config: { rateLimit: { max: 20, timeWindow: '1 hour' } }
  }, async (request, reply) => {
    let body;
    try {
      body = IntroRequestSchema.parse(request.body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.code(422).send({
          error: 'VALIDATION_FAILED',
          details: err.flatten().fieldErrors
        });
      }
      throw err;
    }

    let baId, cardId;
    try {
      ({ baId, cardId } = verifyIntroToken(body.token));
    } catch (err) {
      // ARCHITECT-PRIME: 401 générique — on ne révèle JAMAIS la raison de l'échec
      // (signature invalide vs expiré vs format) pour ne pas aider un attaquant.
      request.log.warn({ reason: err.message }, 'ba_intro_token_rejected');
      return reply.code(401).send({
        error: 'INVALID_TOKEN',
        message: 'Lien invalide ou expiré. Demandez un nouveau digest.'
      });
    }

    // 1. Vérifier que le BA existe et est actif (un cancelled/paused ne peut plus
    //    déclencher une intro).
    let ba;
    try {
      const { rows } = await pool.query(
        `SELECT id, email, status FROM business_angels WHERE id = $1`,
        [baId]
      );
      ba = rows[0];
    } catch (err) {
      if (isDbUnavailableError(err)) {
        request.log.error({ err }, 'ba_intro_db_unavailable_ba_lookup');
        return reply.code(503).send({
          error: 'SERVICE_UNAVAILABLE',
          message: 'Service temporairement indisponible.'
        });
      }
      throw err;
    }

    if (!ba) {
      request.log.warn({ ba_id: baId }, 'ba_intro_ba_not_found');
      return reply.code(401).send({
        error: 'INVALID_TOKEN',
        message: 'Lien invalide ou expiré.'
      });
    }
    if (ba.status !== 'active') {
      request.log.info({ ba_id: baId, status: ba.status }, 'ba_intro_inactive_ba');
      return reply.code(403).send({
        error: 'BA_NOT_ACTIVE',
        message: 'Votre abonnement n\'est plus actif. Réactivez-le pour demander des intros.'
      });
    }

    // 2. Dédup — un BA ne demande pas deux fois la même card.
    //    Statuts "vivants" : pending_founder, founder_notified, founder_accepted, meeting_scheduled.
    let existing;
    try {
      const { rows } = await pool.query(
        `SELECT id, status FROM intro_requests
         WHERE ba_id = $1 AND card_id = $2
           AND status IN ('pending_founder', 'founder_notified', 'founder_accepted', 'meeting_scheduled')
         LIMIT 1`,
        [baId, cardId]
      );
      existing = rows[0];
    } catch (err) {
      if (isDbUnavailableError(err)) {
        request.log.error({ err }, 'ba_intro_db_unavailable_dedup');
        return reply.code(503).send({
          error: 'SERVICE_UNAVAILABLE',
          message: 'Service temporairement indisponible.'
        });
      }
      throw err;
    }

    if (existing) {
      return reply.code(200).send({
        ok: true,
        already_requested: true,
        intro_id: existing.id,
        status: existing.status
      });
    }

    // 3. INSERT — TODO(delta-9) : ajouter un check d'existence de la card_id
    //    contre la table public_cards une fois qu'elle existera.
    let intro;
    try {
      const { rows } = await pool.query(
        `INSERT INTO intro_requests (ba_id, card_id, message, status)
         VALUES ($1, $2, $3, 'pending_founder')
         RETURNING id`,
        [baId, cardId, body.message || null]
      );
      intro = rows[0];
    } catch (err) {
      if (isDbUnavailableError(err)) {
        request.log.error({ err }, 'ba_intro_db_unavailable_insert');
        return reply.code(503).send({
          error: 'SERVICE_UNAVAILABLE',
          message: 'Service temporairement indisponible.'
        });
      }
      throw err;
    }

    request.log.info({ ba_id: baId, card_id: cardId, intro_id: intro.id }, 'ba_intro_requested');

    // 4. Trigger n8n workflow (notif fondateur). Fail-open : la demande est
    //    déjà enregistrée, n8n peut être relancé manuellement par l'admin.
    n8nBridge.submitScore({
      event: 'ba.intro_requested',
      intro_id: intro.id,
      ba_id: baId,
      card_id: cardId,
      message: body.message || null
    }, request.id).catch((err) => {
      request.log.warn({ err: err.message, intro_id: intro.id }, 'ba_intro_n8n_notify_failed');
    });

    return reply.code(200).send({ ok: true, intro_id: intro.id });
  });
}
