import { z } from 'zod';
import argon2 from 'argon2';
import crypto from 'node:crypto';
import { pool } from '../config/db.js';
import { isDbUnavailableError } from '../utils/errors.js';
import {
  lookupActivationToken,
  validateActivationToken,
  markTokenUsed
} from '../services/activation-tokens.js';

const SERVICE_UNAVAILABLE_BODY = {
  error: 'SERVICE_UNAVAILABLE',
  message: 'Service temporairement indisponible. Réessayez dans quelques instants.'
};

const ACCOUNT_GATE_BODY = {
  error: 'ACCOUNT_CREATION_REQUIRES_SCORING',
  message: 'L\'accès Flaynn est par invitation après scoring. Soumettez votre dossier pour recevoir vos identifiants.'
};

// Schémas Zod stricts
const LoginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(12).max(100)
}).strict();

// ARCHITECT-PRIME: l'email n'est PAS dans le body — il provient du token d'activation.
// Empêche un attaquant de créer un compte sur un autre email avec un token volé.
const RegisterSchema = z.object({
  name: z.string().trim().min(2).max(100),
  password: z.string().min(12).max(100),
  activation_token: z.string().min(20).max(100)
}).strict();

const ActivationLookupParamsSchema = z.object({
  token: z.string().min(20).max(100)
});

export default async function authRoutes(fastify) {
  // Route de connexion
  fastify.post('/api/auth/login', {
    config: {
      rateLimit: { max: 5, timeWindow: '15 minutes' }
    }
  }, async (request, reply) => {
    try {
      const parsed = LoginSchema.parse(request.body);
      
      // 1. On cherche l'utilisateur dans la base de données
      // ARCHITECT-PRIME: projection explicite — jamais SELECT * sur une table avec password_hash
      const { rows } = await pool.query(
        'SELECT id, name, email, password_hash, failed_login_attempts, locked_until FROM users WHERE email = $1',
        [parsed.email]
      );
      if (rows.length === 0) {
        // ARCHITECT-PRIME: dummy Argon2 verify pour neutraliser le timing oracle (email inexistant vs existant)
        await argon2.verify('$argon2id$v=19$m=65536,t=3,p=4$dW5rbm93bg$dW5rbm93bg', parsed.password).catch(() => {});
        return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Email ou mot de passe incorrect.' });
      }
      const user = rows[0];

      // Défense active : Vérification de l'Account Lockout
      if (user.locked_until && new Date(user.locked_until) > new Date()) {
        return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Compte temporairement bloqué suite à de multiples échecs.' });
      }

      // 2. On vérifie la signature cryptographique du mot de passe
      const isPasswordValid = await argon2.verify(user.password_hash, parsed.password);
      if (!isPasswordValid) {
        // Incrémentation des échecs
        const attempts = (user.failed_login_attempts || 0) + 1;
        let lockQuery = 'UPDATE users SET failed_login_attempts = $1 WHERE id = $2';
        
        if (attempts >= 5) {
          lockQuery = 'UPDATE users SET failed_login_attempts = $1, locked_until = NOW() + INTERVAL \'15 minutes\' WHERE id = $2';
          request.log.warn(`[SECOPS] Account Lockout déclenché pour l'utilisateur: ${user.email}`);
        }
        await pool.query(lockQuery, [attempts, user.id]);

        return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Email ou mot de passe incorrect.' });
      }

      // Réinitialisation des compteurs en cas de succès
      if (user.failed_login_attempts > 0 || user.locked_until) {
        await pool.query('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1', [user.id]);
      }

      // Réconciliation des scores orphelins (comptes créés avant le patch, ou paiement avant inscription)
      await pool.query(
        `UPDATE scores SET user_email = $1
         WHERE user_email IS NULL
         AND data->'payload'->>'email' = $1`,
        [user.email]
      ).catch(err => request.log.warn(err, 'Rattachement scores orphelins au login échoué (non bloquant)'));

      // 3. Génération du JWT sécurisé
      const tokens = await fastify.createSessionTokens(user);
      reply.setAuthCookies(tokens);

      return reply.code(200).send({
        success: true,
        user: { name: user.name, email: user.email }
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.code(422).send({ error: 'VALIDATION_FAILED', message: 'Email ou mot de passe invalide.' });
      }
      if (isDbUnavailableError(err)) {
        request.log.error({ err }, 'auth_login_db_unavailable');
        return reply.code(503).send(SERVICE_UNAVAILABLE_BODY);
      }
      request.log.error(err);
      return reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'Erreur interne du serveur.' });
    }
  });

  // ARCHITECT-PRIME: Delta 14 — la création de compte est désormais 100% gated par
  // un token d'activation émis quand un scoring passe en status 'completed' (cf.
  // /api/webhooks/n8n/certify). Plus aucune inscription publique libre.
  // L'email vient du token, pas du body : l'utilisateur ne peut s'inscrire que
  // sur l'email qui a soumis le scoring.
  fastify.post('/api/auth/register', {
    config: {
      rateLimit: { max: 5, timeWindow: '15 minutes' }
    }
  }, async (request, reply) => {
    let parsed;
    try {
      parsed = RegisterSchema.parse(request.body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        // Pas de token → on renvoie le 403 de gating (signal clair pour l'UX),
        // pas un 422 qui laisserait croire qu'il manque juste un champ.
        const flat = err.flatten().fieldErrors;
        if (flat.activation_token) {
          return reply.code(403).send(ACCOUNT_GATE_BODY);
        }
        return reply.code(422).send({ error: 'VALIDATION_FAILED', message: 'Veuillez vérifier les champs.' });
      }
      throw err;
    }

    try {
      // 1. Validation du token d'activation (existe, non utilisé, non expiré)
      const tokenCheck = await validateActivationToken(parsed.activation_token);
      if (!tokenCheck.ok) {
        request.log.warn({ reason: tokenCheck.reason }, '[SECOPS] register_activation_token_rejected');
        if (tokenCheck.reason === 'TOKEN_EXPIRED') {
          return reply.code(403).send({
            error: 'TOKEN_EXPIRED',
            message: 'Ce lien d\'activation a expiré. Contactez le support pour en recevoir un nouveau.'
          });
        }
        if (tokenCheck.reason === 'TOKEN_ALREADY_USED') {
          return reply.code(403).send({
            error: 'TOKEN_ALREADY_USED',
            message: 'Ce lien d\'activation a déjà été utilisé. Connectez-vous avec votre mot de passe.'
          });
        }
        return reply.code(403).send(ACCOUNT_GATE_BODY);
      }

      const email = tokenCheck.email;

      // 2. Vérification du mot de passe compromis via HaveIBeenPwned (k-Anonymity)
      const sha1Password = crypto.createHash('sha1').update(parsed.password).digest('hex').toUpperCase();
      const prefix = sha1Password.slice(0, 5);
      const suffix = sha1Password.slice(5);

      try {
        const pwnedRes = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
          headers: { 'User-Agent': 'Flaynn-SaaS-API' },
          signal: AbortSignal.timeout(3000)
        });

        if (pwnedRes.ok) {
          const pwnedList = await pwnedRes.text();
          if (pwnedList.includes(`${suffix}:`)) {
            request.log.warn(`[SECOPS] Tentative d'inscription avec un mot de passe compromis interceptée.`);
            return reply.code(422).send({ error: 'VALIDATION_FAILED', message: 'Ce mot de passe est apparu dans une fuite de données publique (HaveIBeenPwned). Par sécurité, veuillez en choisir un autre.' });
          }
        }
      } catch (err) {
        request.log.warn(err, '[SECOPS] Impossible de joindre HaveIBeenPwned, inscription autorisée par défaut (Fail-Open).');
      }

      // 3. Compte déjà existant pour cet email → pas d'anti-énumération ici
      // (le détenteur du token connaît forcément son propre email).
      const { rowCount } = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
      if (rowCount > 0) {
        // Marque le token utilisé pour éviter une seconde tentative.
        await markTokenUsed(tokenCheck.tokenHash).catch(() => {});
        return reply.code(409).send({
          error: 'ALREADY_REGISTERED',
          message: 'Un compte existe déjà pour cet email. Connectez-vous avec votre mot de passe.'
        });
      }

      // 4. Argon2 hash + INSERT user
      const passwordHash = await argon2.hash(parsed.password);
      const insert = await pool.query(
        'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email',
        [parsed.name, email, passwordHash]
      );
      const user = insert.rows[0];

      // 5. Marque le token consommé (après INSERT user OK)
      await markTokenUsed(tokenCheck.tokenHash);

      // 6. Rattache les scorings de cet email (au moins celui qui a généré le token)
      await pool.query(
        `UPDATE scores SET user_email = $1
         WHERE user_email IS NULL
         AND data->'payload'->>'email' = $1`,
        [user.email]
      ).catch(err => request.log.warn(err, 'Rattachement scores orphelins échoué (non bloquant)'));

      const tokens = await fastify.createSessionTokens(user);
      reply.setAuthCookies(tokens);

      return reply.code(200).send({
        success: true,
        user: { name: user.name, email: user.email }
      });
    } catch (err) {
      if (isDbUnavailableError(err)) {
        request.log.error({ err }, 'auth_register_db_unavailable');
        return reply.code(503).send(SERVICE_UNAVAILABLE_BODY);
      }
      if (err && err.code === '23505') {
        // Race condition rare : SELECT n'a rien trouvé mais INSERT échoue sur UNIQUE.
        // Le détenteur du token a déjà un compte → 409 explicite.
        request.log.warn(`[SECOPS] Race 23505 sur register gated (token déjà validé).`);
        return reply.code(409).send({
          error: 'ALREADY_REGISTERED',
          message: 'Un compte existe déjà pour cet email. Connectez-vous avec votre mot de passe.'
        });
      }
      request.log.error(err);
      return reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'Erreur interne du serveur.' });
    }
  });

  // ARCHITECT-PRIME: alias backward-compat — bloque tout client qui frapperait /signup.
  fastify.post('/api/auth/signup', {
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } }
  }, async (_request, reply) => {
    return reply.code(403).send(ACCOUNT_GATE_BODY);
  });

  // Lecture du token (pré-remplissage formulaire /auth/activate). Publique, rate-limited.
  // Ne consomme PAS le token : permet à l'utilisateur de revenir sur la page sans
  // brûler son invitation (consommation = INSERT user OK uniquement).
  fastify.get('/api/auth/activation/:token', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    let params;
    try {
      params = ActivationLookupParamsSchema.parse(request.params);
    } catch {
      return reply.code(404).send({ error: 'TOKEN_INVALID', message: 'Lien d\'activation invalide.' });
    }
    try {
      const result = await lookupActivationToken(params.token);
      if (!result.ok) {
        const httpCode = result.reason === 'TOKEN_INVALID' ? 404 : 410;
        return reply.code(httpCode).send({
          error: result.reason,
          message: result.reason === 'TOKEN_EXPIRED'
            ? 'Ce lien d\'activation a expiré.'
            : result.reason === 'TOKEN_ALREADY_USED'
            ? 'Ce lien d\'activation a déjà été utilisé.'
            : 'Lien d\'activation invalide.'
        });
      }
      return reply.code(200).send({
        email: result.email,
        startup_name: result.startupName || null
      });
    } catch (err) {
      if (isDbUnavailableError(err)) {
        request.log.error({ err }, 'auth_activation_lookup_db_unavailable');
        return reply.code(503).send(SERVICE_UNAVAILABLE_BODY);
      }
      request.log.error(err);
      return reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'Erreur interne du serveur.' });
    }
  });

  fastify.post('/api/auth/refresh', async (request, reply) => {
    try {
      await fastify.authenticate(request, reply);
      if (reply.sent) return reply;
      return reply.code(200).send({
        success: true,
        user: { name: request.user.name, email: request.user.email }
      });
    } catch (err) {
      if (isDbUnavailableError(err)) {
        request.log.error({ err }, 'auth_refresh_db_unavailable');
        return reply.code(503).send(SERVICE_UNAVAILABLE_BODY);
      }
      throw err;
    }
  });

  fastify.get('/api/auth/session', async (request, reply) => {
    await fastify.authenticate(request, reply);
    if (reply.sent) return reply;
    return reply.code(200).send({
      authenticated: true,
      user: { name: request.user.name, email: request.user.email }
    });
  });

  // ARCHITECT-PRIME: suppression complète du compte utilisateur + données associées
  fastify.delete('/api/auth/account', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const client = await pool.connect();
    try {
      const email = request.user.email;

      await client.query('BEGIN');

      // 1. Supprime les scores liés
      await client.query('DELETE FROM scores WHERE user_email = $1', [email]);

      // 2. Révoque tous les refresh tokens
      await client.query(
        'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_email = $1 AND revoked_at IS NULL',
        [email]
      );

      // 3. Supprime l'utilisateur (CASCADE supprimera aussi les refresh_tokens via FK)
      await client.query('DELETE FROM users WHERE email = $1', [email]);

      await client.query('COMMIT');

      // 4. Clear les cookies de session
      reply.clearAuthCookies();

      return reply.code(200).send({ success: true, message: 'Compte supprimé.' });
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* rollback best-effort */ }
      if (isDbUnavailableError(err)) {
        request.log.error({ err }, 'auth_delete_account_db_unavailable');
        return reply.code(503).send(SERVICE_UNAVAILABLE_BODY);
      }
      request.log.error(err);
      return reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'Erreur interne du serveur.' });
    } finally {
      client.release();
    }
  });

  fastify.post('/api/auth/logout', async (request, reply) => {
    try {
      await fastify.revokeRefreshToken(request.cookies?.flaynn_rt);
      reply.clearAuthCookies();
      return reply.code(200).send({ success: true });
    } catch (err) {
      request.log.error(err);
      reply.clearAuthCookies();
      return reply.code(200).send({ success: true });
    }
  });
}