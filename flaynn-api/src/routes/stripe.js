import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import Stripe from 'stripe';
import { n8nBridge } from '../services/n8n-bridge.js';
import { pool } from '../config/db.js';

// Initialisation de Stripe avec la clé secrète de l'environnement
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16', // Garde une version API stable
});

// On réutilise le même schéma de validation que pour le scoring initial
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

export default async function stripeRoutes(fastify) {

  // 1. ENDPOINT DE CHECKOUT : Reçoit le formulaire, enregistre en base, redirige vers Stripe
  fastify.post('/api/checkout', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    try {
      const parsed = ScoreSubmissionSchema.parse(request.body);
      let userEmail = null;

      // Récupération de l'email via le token JWT si l'utilisateur est connecté
      const accessToken = request.cookies?.flaynn_at;
      if (accessToken) {
        try {
          const decoded = fastify.jwt.verify(accessToken);
          userEmail = decoded.email;
        } catch {
          request.log.warn('Token invalide lors du checkout.');
        }
      }

      // Fallback : on cherche dans la base de données
      if (!userEmail) {
        try {
          const userCheck = await pool.query('SELECT email FROM users WHERE email = $1', [parsed.email]);
          if (userCheck.rowCount > 0) userEmail = userCheck.rows[0].email;
        } catch {
          request.log.warn('Erreur vérification utilisateur.');
        }
      }

      // Génération de la référence unique
      const reference = `FLY-${randomBytes(4).toString('hex').toUpperCase()}`;

      // Enregistrement initial en base (STATUT : pending_payment)
      const initialData = {
        status: 'pending_payment', // En attente de paiement
        pitch_deck_base64: parsed.pitch_deck_base64 || null,
        payload: parsed
      };

      await pool.query(
        'INSERT INTO scores (reference_id, user_email, startup_name, data) VALUES ($1, $2, $3, $4::jsonb)',
        [reference, userEmail, parsed.nom_startup, JSON.stringify(initialData)]
      );

      const baseUrl = process.env.APP_URL || 'https://flaynn.tech';

      // Création de la session Stripe
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'eur',
              product_data: {
                name: 'Audit Scoring Flaynn',
                description: 'Analyse IA + validation humaine sur 5 piliers',
              },
              unit_amount: 2900, // 29.00€ (en centimes)
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        success_url: `${baseUrl}/scoring/succes?ref=${reference}`, // Redirection après succès
        cancel_url: `${baseUrl}/#scoring-form`, // Redirection si annulation
        customer_email: parsed.email,
        metadata: {
          reference: reference // Indispensable pour lier le paiement au dossier
        }
      });

      // On renvoie l'URL de paiement au frontend
      return reply.code(200).send({ checkout_url: session.url, reference });

    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.code(422).send({ error: 'VALIDATION_FAILED', details: err.flatten().fieldErrors });
      }
      request.log.error({ err }, 'Erreur lors du checkout Stripe');
      return reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'Erreur lors de la création du paiement.' });
    }
  });


  // 2. ENDPOINT WEBHOOK : Écoute Stripe en arrière-plan pour valider le paiement
  fastify.post('/api/webhooks/stripe', {
    config: { rateLimit: { max: 100, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const sig = request.headers['stripe-signature'];

    let event;

    try {
      // Vérification cryptographique que la requête vient bien de Stripe
      // request.rawBody a été configuré dans server.js à l'étape 3
      event = stripe.webhooks.constructEvent(
        request.rawBody, 
        sig, 
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      request.log.warn({ err: err.message }, 'Webhook Stripe : Signature invalide');
      return reply.code(400).send(`Webhook Error: ${err.message}`);
    }

    // Gestion du succès du paiement
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const reference = session.metadata.reference;

      request.log.info(`Paiement validé pour la référence : ${reference}`);

      try {
        // 1. On récupère le dossier en base
        const scoreRecord = await pool.query('SELECT data FROM scores WHERE reference_id = $1', [reference]);
        
        if (scoreRecord.rowCount === 0) {
          request.log.error(`Webhook : Dossier introuvable pour la ref ${reference}`);
          return reply.code(200).send(); // On renvoie 200 à Stripe pour qu'il arrête de retry
        }

        const data = scoreRecord.rows[0].data;
        const parsedPayload = data.payload;

        // 2. On met à jour le statut en base (pending_payment -> pending_analysis)
        await pool.query(
          `UPDATE scores SET data = jsonb_set(data, '{status}', '"pending_analysis"') WHERE reference_id = $1`,
          [reference]
        );

        // 3. On construit l'URL du deck PDF (comme dans scoring.js)
        const host = request.headers['x-forwarded-host'] || request.headers.host || 'flaynn.tech';
        const protocol = request.headers['x-forwarded-proto'] || 'https';
        const deckUrl = data.pitch_deck_base64
          ? `${protocol}://${host}/api/decks/${reference}`
          : '';

        // 4. On déclenche n8n SANS le base64 (pour ne pas surcharger)
        const { pitch_deck_base64, ...payloadWithoutBase64 } = parsedPayload;
        
        n8nBridge.submitScore({
          ...payloadWithoutBase64,
          reference,
          pitch_deck_url: deckUrl
        }, request.id).catch(async (err) => {
            request.log.error(err, `Échec envoi n8n post-paiement pour ${reference}`);
            await pool.query(
              `UPDATE scores SET data = jsonb_set(data, '{status}', '"error"') WHERE reference_id = $1`,
              [reference]
            );
        });

      } catch (dbErr) {
        request.log.error({ err: dbErr }, `Erreur base de données traitement webhook pour ${reference}`);
      }
    }

    // On répond 200 à Stripe pour confirmer la réception
    reply.code(200).send({ received: true });
  });
}