import { z } from 'zod';
import Stripe from 'stripe';
import { pool } from '../config/db.js';
import { isDbUnavailableError } from '../utils/errors.js';

const ListQuerySchema = z.object({
  status: z.enum(['pending', 'active', 'paused', 'cancelled', 'rejected']).optional(),
  limit:  z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0)
}).strict();

const IdParamSchema = z.object({
  id: z.coerce.number().int().positive()
}).strict();

const ValidateBodySchema = z.object({
  notes: z.string().trim().max(2000).optional().default('')
}).strict();

const RejectBodySchema = z.object({
  notes: z.string().trim().min(1).max(2000)
}).strict();

function parseAdminEmails(raw) {
  if (!raw) return [];
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export default async function adminBaRoutes(fastify) {
  const adminEmails = parseAdminEmails(process.env.ADMIN_EMAILS);

  if (adminEmails.length === 0) {
    fastify.log.warn('[ADMIN] ADMIN_EMAILS vide — routes /api/admin/ba/* désactivées.');
    return;
  }

  const adminEmailsSet = new Set(adminEmails);

  // ARCHITECT-PRIME: deuxième couche d'auth après fastify.authenticate.
  // Renvoie 404 (pas 403) pour ne pas révéler l'existence des routes admin
  // à un user authentifié non-admin.
  function requireAdmin(request, reply) {
    const email = request.user?.email?.toLowerCase();
    if (!email || !adminEmailsSet.has(email)) {
      request.log.warn({ user_email: email }, 'admin_access_denied');
      reply.code(404).send({ error: 'NOT_FOUND' });
      return false;
    }
    return true;
  }

  const stripe = process.env.STRIPE_SECRET_KEY
    ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' })
    : null;

  // GET /api/admin/ba — liste paginée
  fastify.get('/api/admin/ba', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;

    let q;
    try {
      q = ListQuerySchema.parse(request.query);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.code(422).send({ error: 'VALIDATION_FAILED', details: err.flatten().fieldErrors });
      }
      throw err;
    }

    try {
      const params = [];
      let where = '';
      if (q.status) {
        params.push(q.status);
        where = `WHERE status = $${params.length}`;
      }
      params.push(q.limit, q.offset);
      const { rows } = await pool.query(
        `SELECT id, first_name, last_name, email, linkedin_url, status,
                created_at, activated_at, validated_by_admin_at,
                stripe_customer_id, stripe_subscription_id
         FROM business_angels
         ${where}
         ORDER BY created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );
      return reply.code(200).send({ items: rows, limit: q.limit, offset: q.offset });
    } catch (err) {
      if (isDbUnavailableError(err)) {
        request.log.error({ err }, 'admin_ba_list_db_unavailable');
        return reply.code(503).send({ error: 'SERVICE_UNAVAILABLE' });
      }
      throw err;
    }
  });

  // GET /api/admin/ba/:id — détail
  fastify.get('/api/admin/ba/:id', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;

    let params;
    try {
      params = IdParamSchema.parse(request.params);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.code(422).send({ error: 'VALIDATION_FAILED', details: err.flatten().fieldErrors });
      }
      throw err;
    }

    try {
      const { rows } = await pool.query(
        `SELECT id, first_name, last_name, email, linkedin_url, exit_context,
                thesis, referral_source, status, consent_rgpd_at,
                created_at, activated_at, paused_at, cancelled_at,
                validated_by_admin_at, admin_notes,
                stripe_customer_id, stripe_subscription_id
         FROM business_angels WHERE id = $1`,
        [params.id]
      );
      if (rows.length === 0) {
        return reply.code(404).send({ error: 'NOT_FOUND' });
      }
      return reply.code(200).send(rows[0]);
    } catch (err) {
      if (isDbUnavailableError(err)) {
        request.log.error({ err }, 'admin_ba_detail_db_unavailable');
        return reply.code(503).send({ error: 'SERVICE_UNAVAILABLE' });
      }
      throw err;
    }
  });

  // PATCH /api/admin/ba/:id/validate — validation manuelle
  fastify.patch('/api/admin/ba/:id/validate', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;

    let params, body;
    try {
      params = IdParamSchema.parse(request.params);
      body = ValidateBodySchema.parse(request.body || {});
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.code(422).send({ error: 'VALIDATION_FAILED', details: err.flatten().fieldErrors });
      }
      throw err;
    }

    try {
      const { rowCount, rows } = await pool.query(
        `UPDATE business_angels
         SET validated_by_admin_at = NOW(),
             admin_notes = COALESCE(NULLIF($2, ''), admin_notes)
         WHERE id = $1
         RETURNING id, email, status, validated_by_admin_at`,
        [params.id, body.notes]
      );
      if (rowCount === 0) {
        return reply.code(404).send({ error: 'NOT_FOUND' });
      }
      request.log.info({ ba_id: params.id, admin: request.user.email }, 'ba_validated');
      return reply.code(200).send(rows[0]);
    } catch (err) {
      if (isDbUnavailableError(err)) {
        request.log.error({ err }, 'admin_ba_validate_db_unavailable');
        return reply.code(503).send({ error: 'SERVICE_UNAVAILABLE' });
      }
      throw err;
    }
  });

  // PATCH /api/admin/ba/:id/reject — rejet + cancel subscription Stripe (best-effort)
  fastify.patch('/api/admin/ba/:id/reject', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply;

    let params, body;
    try {
      params = IdParamSchema.parse(request.params);
      body = RejectBodySchema.parse(request.body || {});
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.code(422).send({ error: 'VALIDATION_FAILED', details: err.flatten().fieldErrors });
      }
      throw err;
    }

    let ba;
    try {
      const { rows } = await pool.query(
        `SELECT id, email, status, stripe_subscription_id
         FROM business_angels WHERE id = $1`,
        [params.id]
      );
      ba = rows[0];
    } catch (err) {
      if (isDbUnavailableError(err)) {
        request.log.error({ err }, 'admin_ba_reject_db_unavailable_lookup');
        return reply.code(503).send({ error: 'SERVICE_UNAVAILABLE' });
      }
      throw err;
    }

    if (!ba) return reply.code(404).send({ error: 'NOT_FOUND' });
    if (ba.status === 'rejected') {
      return reply.code(409).send({ error: 'ALREADY_REJECTED' });
    }

    // Best-effort : cancel subscription Stripe immediate. Si Stripe fail, on
    // continue le rejet en DB et on log — l'admin peut cancel manuellement
    // depuis le dashboard Stripe. On NE rembourse PAS proactivement les
    // paiements passés (à faire manuellement pour éviter les remboursements
    // accidentels en chaîne).
    let stripeCancelledOk = false;
    if (stripe && ba.stripe_subscription_id) {
      try {
        await stripe.subscriptions.cancel(ba.stripe_subscription_id);
        stripeCancelledOk = true;
      } catch (err) {
        request.log.warn(
          { err: err.message, ba_id: ba.id, sub_id: ba.stripe_subscription_id },
          'admin_ba_reject_stripe_cancel_failed'
        );
      }
    }

    try {
      const { rows } = await pool.query(
        `UPDATE business_angels
         SET status = 'rejected',
             cancelled_at = NOW(),
             admin_notes = $2
         WHERE id = $1
         RETURNING id, email, status, cancelled_at`,
        [params.id, body.notes]
      );
      request.log.info(
        { ba_id: params.id, admin: request.user.email, stripe_cancelled: stripeCancelledOk },
        'ba_rejected'
      );
      return reply.code(200).send({
        ...rows[0],
        stripe_cancelled: stripeCancelledOk
      });
    } catch (err) {
      if (isDbUnavailableError(err)) {
        request.log.error({ err }, 'admin_ba_reject_db_unavailable_update');
        return reply.code(503).send({ error: 'SERVICE_UNAVAILABLE' });
      }
      throw err;
    }
  });
}
