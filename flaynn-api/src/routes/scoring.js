import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { n8nBridge } from '../services/n8n-bridge.js';
import { pool } from '../config/db.js';
import { ScoreSubmissionSchema } from '../schemas/scoring.js';

export default async function scoringRoutes(fastify) {

  // Servir le pitch deck PDF stocke en base pour Mistral OCR
  fastify.get('/api/decks/:ref', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const ref = request.params.ref;
    if (!ref || ref.length > 64) {
      return reply.code(400).send({ error: 'INVALID_REF' });
    }
    try {
      // ->> retourne du texte brut (pas du JSON avec guillemets)
      const { rows } = await pool.query(
        "SELECT COALESCE(data->>'pitch_deck_base64', data->'payload'->>'pitch_deck_base64') as pdf_b64 FROM scores WHERE reference_id = $1",
        [ref]
      );
      if (rows.length === 0 || !rows[0].pdf_b64) {
        return reply.code(404).send({ error: 'NOT_FOUND' });
      }
      const pdfBuffer = Buffer.from(rows[0].pdf_b64, 'base64');
      if (pdfBuffer.length < 100) {
        request.log.warn(`PDF trop petit pour ref ${ref} (${pdfBuffer.length} bytes)`);
        return reply.code(404).send({ error: 'INVALID_PDF' });
      }
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Cache-Control', 'private, max-age=3600')
        .send(pdfBuffer);
    } catch (err) {
      request.log.error(err, 'Erreur serving deck PDF');
      return reply.code(500).send({ error: 'INTERNAL_ERROR' });
    }
  });

  fastify.post('/api/score', {
    config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
    bodyLimit: 16 * 1024 * 1024
  }, async (request, reply) => {
    try {
      const parsed = ScoreSubmissionSchema.parse(request.body);
      let userEmail = null;

      const accessToken = request.cookies?.flaynn_at;
      if (accessToken) {
        try {
          const decoded = fastify.jwt.verify(accessToken);
          userEmail = decoded.email;
        } catch {
          request.log.warn('Token invalide ou expire lors du scoring.');
        }
      }

      if (!userEmail) {
        try {
          const userCheck = await pool.query('SELECT email FROM users WHERE email = $1', [parsed.email]);
          if (userCheck.rowCount > 0) userEmail = userCheck.rows[0].email;
        } catch {
          request.log.warn('Erreur verification utilisateur existant.');
        }
      }

      const reference = `FLY-${randomBytes(4).toString('hex').toUpperCase()}`;

      // Stocker le base64 du deck dans data pour le servir via /api/decks/:ref
      const initialData = {
        status: 'pending_analysis',
        pitch_deck_base64: parsed.pitch_deck_base64 || null,
        payload: parsed
      };

      await pool.query(
        'INSERT INTO scores (reference_id, user_email, startup_name, data) VALUES ($1, $2, $3, $4::jsonb)',
        [reference, userEmail, parsed.nom_startup, JSON.stringify(initialData)]
      );

      // Construire l URL du deck pour n8n/Mistral
      const host = request.headers['x-forwarded-host'] || request.headers.host || 'flaynn.tech';
      const protocol = request.headers['x-forwarded-proto'] || 'https';
      const deckUrl = parsed.pitch_deck_base64
        ? `${protocol}://${host}/api/decks/${reference}`
        : '';

      // Envoyer a n8n SANS le base64, avec l URL du deck
      const { pitch_deck_base64, ...payloadWithoutBase64 } = parsed;
      n8nBridge.submitScore({
        ...payloadWithoutBase64,
        reference,
        pitch_deck_url: deckUrl
      }, request.id)
        .catch(async (err) => {
          request.log.error(err, `Echec envoi n8n pour ${reference}`);
          await pool.query(
            `UPDATE scores SET data = jsonb_set(data, '{status}', '"error"') WHERE reference_id = $1`,
            [reference]
          ).catch(dbErr => request.log.error(dbErr, 'Echec sauvegarde statut erreur'));
        });

      return reply.code(200).send({ success: true, reference });
    } catch (err) {
      if (err instanceof z.ZodError) {
        request.log.warn({ zodErrors: err.flatten().fieldErrors }, 'Validation Zod echouee');
        return reply.code(422).send({ error: 'VALIDATION_FAILED', details: err.flatten().fieldErrors });
      }
      request.log.error({ err }, 'Erreur lors du scoring');
      return reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'Erreur interne lors du scoring.' });
    }
  });
}