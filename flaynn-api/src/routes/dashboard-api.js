import { z } from 'zod';
import { pool } from '../config/db.js';

const idSchema = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/);

export default async function dashboardApiRoutes(fastify) {
  // Route 1 : Récupérer la liste des analyses d'un utilisateur
  fastify.get('/api/dashboard/list', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const userEmail = request.user.email;
      const { rows } = await pool.query(
        'SELECT reference_id, startup_name, created_at FROM scores WHERE user_email = $1 ORDER BY created_at DESC',
        [userEmail]
      );
      return reply.code(200).send(rows);
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'Erreur lors de la récupération des analyses.' });
    }
  });

  // Route 2 : Récupérer une analyse spécifique par son ID
  fastify.get('/api/dashboard/:id', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const raw = request.params.id;
    const parsed = idSchema.safeParse(raw);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'INVALID_ID', message: 'Identifiant de dossier invalide.' });
    }

    try {
      const userEmail = request.user.email;
      const { rows } = await pool.query(
        'SELECT data, startup_name FROM scores WHERE reference_id = $1 AND user_email = $2',
        [parsed.data, userEmail]
      );

      if (rows.length === 0) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Analyse introuvable ou en cours de génération.' });
      }

      const { pdf_base64, ...dataWithoutPdf } = rows[0].data || {};
      return reply.code(200).send({
        id: parsed.data,
        startupName: rows[0].startup_name,
        has_pdf: !!pdf_base64,
        ...dataWithoutPdf
      });
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'Erreur serveur.' });
    }
  });

  // Route 3 : Telecharger le PDF du rapport
  fastify.get('/api/dashboard/:id/pdf', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const raw = request.params.id;
    const parsed = idSchema.safeParse(raw);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'INVALID_ID', message: 'Identifiant invalide.' });
    }

    try {
      const userEmail = request.user.email;
      const { rows } = await pool.query(
        "SELECT data->'pdf_base64' as pdf, startup_name FROM scores WHERE reference_id = $1 AND user_email = $2",
        [parsed.data, userEmail]
      );

      if (rows.length === 0 || !rows[0].pdf) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'PDF non disponible.' });
      }

      const pdfBuffer = Buffer.from(JSON.parse(rows[0].pdf), 'base64');
      const filename = `Flaynn-Scoring-${rows[0].startup_name || parsed.data}.pdf`;

      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(pdfBuffer);
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'Erreur serveur.' });
    }
  });
}