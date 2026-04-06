import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { n8nBridge } from '../services/n8n-bridge.js';
import { pool } from '../config/db.js';

const ScoreSubmissionSchema = z.object({
  previous_ref: z.string().trim().max(50).optional(),
  nom_fondateur: z.string().trim().min(2).max(100),
  email: z.string().email().max(254),
  pays: z.string().trim().min(2).max(100),
  ville: z.string().trim().min(2).max(100),
  nom_startup: z.string().trim().min(2).max(100).regex(/^[\p{L}\p{N}\s\-'.&]+$/u),
  pitch_une_phrase: z.string().trim().min(10).max(300),
  probleme: z.string().trim().min(30).max(2000),
  solution: z.string().trim().min(30).max(2000),
  secteur: z.enum([
    'fintech', 'healthtech', 'saas', 'marketplace', 'deeptech',
    'greentech', 'edtech', 'proptech', 'legaltech', 'foodtech', 'other'
  ]),
  type_client: z.enum(['b2b', 'b2c', 'b2b2c', 'b2g', 'other']),
  tam_usd: z.enum(['<1M', '1M-10M', '10M-100M', '100M-1B', '>1B']),
  estimation_tam: z.string().trim().min(5).max(500),
  acquisition_clients: z.string().trim().min(20).max(2000),
  concurrents: z.string().trim().min(20).max(2000),
  stade: z.enum(['idea', 'mvp', 'seed', 'serieA', 'serieB_plus']),
  revenus: z.enum(['oui', 'non']),
  mrr: z.number().nonnegative().max(100_000_000).optional(),
  clients_payants: z.number().int().nonnegative().max(1_000_000).optional(),
  pourquoi_vous: z.string().trim().min(20).max(2000),
  equipe_temps_plein: z.enum(['oui', 'non']),
  priorite_6_mois: z.enum([
    'produit', 'croissance', 'recrutement', 'levee', 'rentabilite', 'international', 'other'
  ]),
  montant_leve: z.string().trim().min(1).max(100),
  jalons_18_mois: z.string().trim().min(20).max(2000),
  utilisation_fonds: z.string().trim().min(20).max(2000),
  vision_5_ans: z.string().trim().min(20).max(2000),
  pitch_deck_base64: z.string().max(15_000_000).optional(),
  pitch_deck_filename: z.string().max(200).optional(),
  doc_supplementaire_url: z.string().url().max(500).optional(),
}).strip();

export default async function scoringRoutes(fastify) {

  // Endpoint public : servir le pitch deck PDF pour Mistral OCR
  fastify.get('/api/decks/:ref', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const ref = request.params.ref;
    if (!ref || ref.length > 64) {
      return reply.code(400).send({ error: 'INVALID_REF' });
    }

    try {
      const { rows } = await pool.query(
        "SELECT data->'pitch_deck_base64' as pdf_b64 FROM scores WHERE reference_id = $1",
        [ref]
      );

      if (rows.length === 0 || !rows[0].pdf_b64) {
        return reply.code(404).send({ error: 'NOT_FOUND' });
      }

      const b64 = JSON.parse(rows[0].pdf_b64);
      const pdfBuffer = Buffer.from(b64, 'base64');

      return reply
        .header('Content-Type', 'application/pdf')
        .header('Cache-Control', 'private, max-age=3600')
        .send(pdfBuffer);
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ error: 'INTERNAL_ERROR' });
    }
  });

  fastify.post('/api/score', {
    config: {
      rateLimit: { max: 3, timeWindow: '1 minute' }
    }
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

      // Stocker le PDF base64 dans le champ data pour le servir ensuite via /api/decks/:ref
      const initialData = {
        status: 'pending_analysis',
        pitch_deck_base64: parsed.pitch_deck_base64 || null,
        payload: parsed
      };

      await pool.query(
        'INSERT INTO scores (reference_id, user_email, startup_name, data) VALUES ($1, $2, $3, $4::jsonb)',
        [reference, userEmail, parsed.nom_startup, JSON.stringify(initialData)]
      );

      // Construire l'URL du deck pour n8n/Mistral
      const host = request.headers['x-forwarded-host'] || request.headers.host || 'flaynn.tech';
      const protocol = request.headers['x-forwarded-proto'] || 'https';
      const deckUrl = parsed.pitch_deck_base64
        ? `${protocol}://${host}/api/decks/${reference}`
        : '';

      // Envoyer a n8n SANS le base64 (trop lourd), avec l'URL du deck a la place
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
        request.log.warn({ zodErrors: err.flatten().fieldErrors }, 'Validation Zod echouee sur /api/score');
        return reply.code(422).send({ error: 'VALIDATION_FAILED', details: err.flatten().fieldErrors });
      }
      request.log.error({ err }, 'Erreur lors du scoring');
      return reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'Erreur interne lors du scoring.' });
    }
  });
}