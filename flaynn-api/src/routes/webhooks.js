import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import { pool } from '../config/db.js';
import { putObject } from '../lib/r2-storage.js';
import { issueActivationToken, hasUnusedActivationFor } from '../services/activation-tokens.js';


const WebhookPayloadSchema = z.object({
  reference: z.string(),
  data: z.record(z.string(), z.any())
});

const PdfPayloadSchema = z.object({
  reference: z.string(),
  pdf_base64: z.string()
}).strict();

const CertifyPayloadSchema = z.object({
  reference: z.string().min(1).max(64)
}).strict();

function verifySignature(signature, expected) {
  if (!signature || !expected || signature.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// ARCHITECT-PRIME: Delta 13 — helper local, ciblé PDF uniquement.
// Volontairement distinct de extractBase64Payload() de scoring.js : ici on impose
// un seuil de sanité > 100 bytes pour rejeter les payloads garbage de n8n.
function decodeBase64Pdf(input) {
  if (typeof input !== 'string' || input.length === 0) {
    throw new Error('Invalid base64');
  }
  let b64 = input;
  if (input.startsWith('data:')) {
    const match = /^data:[^;,]+;base64,(.+)$/.exec(input);
    if (!match) throw new Error('Invalid base64');
    b64 = match[1];
  }
  const buffer = Buffer.from(b64, 'base64');
  if (buffer.length < 100) {
    throw new Error('Invalid base64');
  }
  return buffer;
}

export default async function webhookRoutes(fastify) {

  // Endpoint 1 : Recevoir le scoring de n8n
  fastify.post('/api/webhooks/n8n/score', {
    config: { rateLimit: { max: 100, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const signature = request.headers['x-flaynn-signature'];
    if (!verifySignature(signature, process.env.N8N_SECRET_TOKEN)) {
      request.log.warn('[SECOPS] Tentative d\'acces non autorisee au webhook n8n/score');
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Signature invalide.' });
    }

    let parsed;
    try {
      parsed = WebhookPayloadSchema.parse(request.body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.code(422).send({
          error: 'VALIDATION_FAILED',
          details: err.flatten().fieldErrors,
        });
      }
      throw err;
    }

    // Vérifier que la référence existe en DB avant de merger
    const exists = await pool.query('SELECT 1 FROM scores WHERE reference_id = $1', [parsed.reference]);
    if (exists.rowCount === 0) {
      request.log.warn(`[SECOPS] Webhook n8n/score reçu pour référence inexistante: ${parsed.reference}`);
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Référence inconnue.' });
    }

    // ARCHITECT-PRIME: force un statut "completed" si n8n n'en fournit pas
    const scoringData = { ...parsed.data, status: parsed.data.status || 'completed' };

    // ARCHITECT-PRIME: || fusionne le JSONB au lieu d'écraser — préserve payload (réconciliation auth)
    // et pitch_deck_base64 (endpoint /api/decks/:ref) tout en ajoutant les résultats du scoring
    await pool.query(
      `INSERT INTO scores (reference_id, data) VALUES ($1, $2::jsonb)
       ON CONFLICT (reference_id) DO UPDATE SET data = scores.data || $2::jsonb`,
      [parsed.reference, JSON.stringify(scoringData)]
    );

    return reply.code(200).send({ success: true, message: 'Score mis a jour avec succes.' });
  });

  // Endpoint 2 : Recevoir le PDF du rapport depuis n8n → upload R2 + metadata DB
  fastify.post('/api/webhooks/n8n/pdf', {
    config: { rateLimit: { max: 50, timeWindow: '1 minute' } },
    bodyLimit: 10 * 1024 * 1024
  }, async (request, reply) => {
    const signature = request.headers['x-flaynn-signature'];
    if (!verifySignature(signature, process.env.N8N_SECRET_TOKEN)) {
      request.log.warn('[SECOPS] Tentative d\'acces non autorisee au webhook n8n/pdf');
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Signature invalide.' });
    }

    let parsed;
    try {
      parsed = PdfPayloadSchema.parse(request.body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.code(422).send({
          error: 'VALIDATION_FAILED',
          details: err.flatten().fieldErrors,
        });
      }
      throw err;
    }

    // Référence doit exister : évite de créer un row orphelin via UPDATE sur ref inconnue
    // (parallèle défensif avec /api/webhooks/n8n/score).
    const exists = await pool.query('SELECT 1 FROM scores WHERE reference_id = $1', [parsed.reference]);
    if (exists.rowCount === 0) {
      request.log.warn(`[SECOPS] Webhook n8n/pdf reçu pour référence inexistante: ${parsed.reference}`);
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Référence inconnue.' });
    }

    // Décodage base64 + sanity check (≥ 100 bytes). Pas d'upload R2 sur garbage.
    let buffer;
    try {
      buffer = decodeBase64Pdf(parsed.pdf_base64);
    } catch {
      request.log.warn({ reference: parsed.reference }, 'webhook_pdf_invalid_base64');
      return reply.code(400).send({ error: 'INVALID_PDF', message: 'PDF invalide ou trop petit.' });
    }

    // Upload R2. Si échec : 502, aucune mutation DB (préférable à enregistrer un storage fantôme).
    let meta;
    try {
      const key = `reports/${parsed.reference}.pdf`;
      meta = await putObject(key, buffer, 'application/pdf', { logger: request.log });
    } catch (err) {
      request.log.error({ err, reference: parsed.reference }, 'webhook_pdf_r2_upload_failed');
      return reply.code(502).send({
        error: 'STORAGE_UNAVAILABLE',
        message: 'Le stockage est temporairement indisponible. Réessayez dans quelques instants.',
      });
    }

    const storageMeta = {
      kind: 'r2',
      key: meta.key,
      size: meta.size,
      content_type: 'application/pdf',
      uploaded_at: new Date().toISOString(),
    };

    try {
      await pool.query(
        `UPDATE scores SET data = jsonb_set(data, '{pdf_report_storage}', $2::jsonb) WHERE reference_id = $1`,
        [parsed.reference, JSON.stringify(storageMeta)]
      );
    } catch (err) {
      // R2 upload OK mais DB KO → orphelin R2 (cf. TODO tracker, cleanup V2).
      // Log dédié pour retrouver la key et nettoyer manuellement.
      request.log.error(
        { err, reference: parsed.reference, r2_key: meta.key },
        'webhook_pdf_db_update_failed_r2_orphan'
      );
      return reply.code(500).send({
        error: 'INTERNAL_ERROR',
        message: 'Erreur serveur lors de l\'enregistrement du PDF.',
      });
    }

    return reply.code(200).send({
      success: true,
      message: 'PDF stocké sur R2.',
      key: meta.key,
      size: meta.size,
    });
  });

  // Endpoint 3 : Certification analyste (flip status 'under_review' → 'completed').
  // Appelé par le workflow n8n V5 Link après validation humaine (GO Telegram).
  // Idempotent : un double-call reste sans effet (status déjà 'completed').
  fastify.post('/api/webhooks/n8n/certify', {
    config: { rateLimit: { max: 50, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const signature = request.headers['x-flaynn-signature'];
    if (!verifySignature(signature, process.env.N8N_SECRET_TOKEN)) {
      request.log.warn('[SECOPS] Tentative d\'acces non autorisee au webhook n8n/certify');
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Signature invalide.' });
    }

    let parsed;
    try {
      parsed = CertifyPayloadSchema.parse(request.body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.code(422).send({
          error: 'VALIDATION_FAILED',
          details: err.flatten().fieldErrors,
        });
      }
      throw err;
    }

    // Flip status + récupère l'email fondateur dans le payload pour émettre l'invitation.
    const result = await pool.query(
      `UPDATE scores SET data = jsonb_set(data, '{status}', '"completed"')
       WHERE reference_id = $1
       RETURNING reference_id, user_email, data->'payload'->>'email' AS founder_email`,
      [parsed.reference]
    );

    if (result.rowCount === 0) {
      request.log.warn(`[SECOPS] Webhook n8n/certify reçu pour référence inexistante: ${parsed.reference}`);
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Référence inconnue.' });
    }

    const row = result.rows[0];
    const founderEmail = row.founder_email;

    // ARCHITECT-PRIME: Delta 14 — émission du token d'activation pour n8n.
    // Pas d'email côté backend : c'est n8n qui envoie l'email contenant activation_url.
    if (!founderEmail) {
      request.log.warn({ ref: parsed.reference }, 'certify_no_founder_email_in_payload');
      return reply.code(200).send({
        success: true,
        message: 'Scoring certifié. Aucun email fondateur en payload, pas de token émis.'
      });
    }

    // Si l'utilisateur a déjà un compte, pas besoin d'invitation.
    const existingUser = await pool.query('SELECT 1 FROM users WHERE email = $1', [founderEmail]);
    if (existingUser.rowCount > 0) {
      return reply.code(200).send({
        success: true,
        message: 'Scoring certifié. Compte déjà existant pour cet email.',
        already_registered: true
      });
    }

    // Idempotence : un certify rejoué ne doit PAS émettre un second token.
    // Le token clair n'étant pas re-derivable du hash, n8n doit avoir persisté
    // activation_url dès la première réponse.
    if (await hasUnusedActivationFor(parsed.reference)) {
      return reply.code(200).send({
        success: true,
        message: 'Scoring certifié. Token d\'activation déjà émis (réutilise activation_url précédent).',
        activation_already_issued: true
      });
    }

    let activationUrl;
    try {
      const { tokenClear } = await issueActivationToken({
        email: founderEmail,
        referenceId: parsed.reference
      });
      const appUrl = process.env.APP_URL || 'https://flaynn.io';
      activationUrl = `${appUrl}/auth/activate?token=${tokenClear}`;
    } catch (err) {
      request.log.error({ err, ref: parsed.reference }, 'certify_activation_issue_failed');
      // Status est déjà flippé : on ne re-rollback pas. n8n peut renvoyer le webhook
      // pour réessayer l'émission (la branche hasUnusedActivationFor() restera false).
      return reply.code(500).send({
        error: 'INTERNAL_ERROR',
        message: 'Statut certifié mais émission du token d\'activation échouée. Réessayez le webhook.'
      });
    }

    return reply.code(200).send({
      success: true,
      message: 'Scoring certifié.',
      activation_url: activationUrl
    });
  });
}