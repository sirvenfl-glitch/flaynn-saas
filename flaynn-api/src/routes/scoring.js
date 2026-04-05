import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { n8nBridge } from '../services/n8n-bridge.js';
import { pool } from '../config/db.js';

// Schéma Zod strict — aligné sur les champs attendus par n8n
const ScoreSubmissionSchema = z.object({
  // Référence précédente (optionnel)
  previous_ref: z.string().trim().max(50).optional(),

  // Étape 1 : Identité
  nom_fondateur: z.string().trim().min(2).max(100),
  email: z.string().email().max(254),
  pays: z.string().trim().min(2).max(100),
  ville: z.string().trim().min(2).max(100),
  nom_startup: z.string().trim().min(2).max(100).regex(/^[\p{L}\p{N}\s\-'.&]+$/u),

  // Étape 2 : Problème & Solution
  pitch_une_phrase: z.string().trim().min(5).max(300),
  probleme: z.string().trim().min(10).max(2000),
  solution: z.string().trim().min(10).max(2000),
  secteur: z.enum([
    'fintech', 'healthtech', 'saas', 'marketplace', 'deeptech',
    'greentech', 'edtech', 'proptech', 'legaltech', 'foodtech', 'other'
  ]),
  type_client: z.enum(['b2b', 'b2c', 'b2b2c', 'b2g', 'other']),

  // Étape 3 : Marché & Concurrence
  tam_usd: z.enum(['<1M', '1M-10M', '10M-100M', '100M-1B', '>1B']),
  estimation_tam: z.string().trim().min(5).max(500),
  acquisition_clients: z.string().trim().min(10).max(2000),
  concurrents: z.string().trim().min(10).max(2000),

  // Étape 4 : Traction
  stade: z.enum(['idea', 'mvp', 'seed', 'serieA', 'serieB_plus']),
  revenus: z.enum(['oui', 'non']),
  mrr: z.number().nonnegative().max(100_000_000).optional(),
  clients_payants: z.number().int().nonnegative().max(1_000_000).optional(),

  // Étape 5 : Équipe
  pourquoi_vous: z.string().trim().min(10).max(2000),
  equipe_temps_plein: z.enum(['oui', 'non']),

  // Étape 6 : Vision & Levée
  priorite_6_mois: z.enum([
    'produit', 'croissance', 'recrutement', 'levee', 'rentabilite', 'international', 'other'
  ]),
  montant_leve: z.string().trim().min(1).max(100),
  jalons_18_mois: z.string().trim().min(10).max(2000),
  utilisation_fonds: z.string().trim().min(10).max(2000),
  vision_5_ans: z.string().trim().min(10).max(2000),

  // Étape 7 : Documents (URLs après upload)
  pitch_deck_url: z.string().url().max(500).optional(),
  doc_supplementaire_url: z.string().url().max(500).optional(),
}).strip();

export default async function scoringRoutes(fastify) {
  fastify.post('/api/score', {
    config: {
      rateLimit: { max: 3, timeWindow: '1 minute' }
    }
  }, async (request, reply) => {
    try {
      const parsed = ScoreSubmissionSchema.parse(request.body);
      let userEmail = null;

      // Tente de récupérer l'email depuis le cookie JWT
      const accessToken = request.cookies?.flaynn_at;
      if (accessToken) {
        try {
          const decoded = fastify.jwt.verify(accessToken);
          userEmail = decoded.email;
        } catch {
          request.log.warn('Token invalide ou expiré lors du scoring, passage en mode invité.');
        }
      }

      // Si non connecté, vérifie si l'email existe déjà
      if (!userEmail) {
        try {
          const userCheck = await pool.query('SELECT email FROM users WHERE email = $1', [parsed.email]);
          if (userCheck.rowCount > 0) userEmail = userCheck.rows[0].email;
        } catch {
          request.log.warn('Erreur lors de la vérification de l\'utilisateur existant.');
        }
      }

      const reference = `FLY-${randomBytes(4).toString('hex').toUpperCase()}`;
      const initialData = { status: 'pending_analysis', payload: parsed };

      // ARCHITECT-PRIME: user_email = null si le fondateur n'est pas inscrit
      // (la contrainte FK REFERENCES users(email) interdit un email inexistant)
      await pool.query(
        'INSERT INTO scores (reference_id, user_email, startup_name, data) VALUES ($1, $2, $3, $4::jsonb)',
        [reference, userEmail, parsed.nom_startup, JSON.stringify(initialData)]
      );

      // n8n orchestre tout — fire-and-forget
      n8nBridge.submitScore({ ...parsed, reference }, request.id)
        .catch(async (err) => {
          request.log.error(err, `Échec de l'envoi à n8n pour la référence ${reference}`);
          await pool.query(
            `UPDATE scores SET data = jsonb_set(data, '{status}', '"error"') WHERE reference_id = $1`,
            [reference]
          ).catch(dbErr => request.log.error(dbErr, 'Échec de la sauvegarde du statut d\'erreur'));
        });

      return reply.code(200).send({ success: true, reference });
    } catch (err) {
      if (err instanceof z.ZodError) {
        request.log.warn({ zodErrors: err.flatten().fieldErrors }, 'Validation Zod échouée sur /api/score');
        return reply.code(422).send({ error: 'VALIDATION_FAILED', details: err.flatten().fieldErrors });
      }
      request.log.error({ err, body: request.body }, 'Erreur lors du scoring');
      return reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'Erreur interne lors du scoring.' });
    }
  });
}
