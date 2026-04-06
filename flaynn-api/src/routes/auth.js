import { z } from 'zod';
import argon2 from 'argon2';
import crypto from 'node:crypto';
import { pool } from '../config/db.js';
import { isDbUnavailableError } from '../utils/errors.js';

const SERVICE_UNAVAILABLE_BODY = {
  error: 'SERVICE_UNAVAILABLE',
  message: 'Service temporairement indisponible. Réessayez dans quelques instants.'
};

// Schémas Zod stricts
const LoginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(12).max(100) // Renforcement de la politique de mot de passe
}).strict();

const RegisterSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().email().max(254),
  password: z.string().min(12).max(100) // Renforcement de la politique de mot de passe
}).strict();

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

  // Route d'inscription
  fastify.post('/api/auth/register', {
    config: {
      rateLimit: { max: 5, timeWindow: '15 minutes' }
    }
  }, async (request, reply) => {
    try {
      const parsed = RegisterSchema.parse(request.body);
      
      // 1. Vérification du mot de passe compromis via HaveIBeenPwned (k-Anonymity)
      const sha1Password = crypto.createHash('sha1').update(parsed.password).digest('hex').toUpperCase();
      const prefix = sha1Password.slice(0, 5);
      const suffix = sha1Password.slice(5);
      
      try {
        const pwnedRes = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
          headers: { 'User-Agent': 'Flaynn-SaaS-API' },
          signal: AbortSignal.timeout(3000) // Timeout strict de 3 secondes
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

      // 2. On vérifie l'existence de l'email dans la base de données
      const { rowCount } = await pool.query('SELECT id FROM users WHERE email = $1', [parsed.email]);
      if (rowCount > 0) {
        // Mitigation User Enumeration : Délai artificiel (Timing Attack) + Réponse 200 silencieuse
        await new Promise(resolve => setTimeout(resolve, Math.random() * 200 + 100));
        request.log.warn(`[SECOPS] Tentative d'inscription sur email existant interceptée: ${parsed.email}`);
        return reply.code(200).send({ 
          success: true, 
          message: 'Si cet email n\'était pas déjà enregistré, votre compte a été créé.',
          user: { name: parsed.name, email: parsed.email } // Injecte de fausses données pour tromper le bot/frontend
        });
      }

      // 3. On hache le mot de passe avec Argon2 (salage inclus automatiquement)
      const passwordHash = await argon2.hash(parsed.password);
      
      // 4. Sauvegarde dans PostgreSQL
      const insert = await pool.query(
        'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email',
        [parsed.name, parsed.email, passwordHash]
      );
      const user = insert.rows[0];

      // 👇 AJOUT DE LA RÉCONCILIATION DE COMPTE ICI 👇
      // Rattache les scorings soumis avant la création du compte (user_email = NULL, email dans le payload)
      await pool.query(
        `UPDATE scores SET user_email = $1
         WHERE user_email IS NULL
         AND data->'payload'->>'email' = $1`,
        [user.email]
      ).catch(err => request.log.warn(err, 'Rattachement scores orphelins échoué (non bloquant)'));
      // 👆 FIN DE L'AJOUT 👆

      const tokens = await fastify.createSessionTokens(user);
      reply.setAuthCookies(tokens);

      return reply.code(200).send({
        success: true,
        user: { name: user.name, email: user.email }
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.code(422).send({ error: 'VALIDATION_FAILED', message: 'Veuillez vérifier les champs.' });
      }
      if (isDbUnavailableError(err)) {
        request.log.error({ err }, 'auth_register_db_unavailable');
        return reply.code(503).send(SERVICE_UNAVAILABLE_BODY);
      }
      if (err && err.code === '23505') {
        // ARCHITECT-PRIME: Race condition — le SELECT n'a rien trouvé mais l'INSERT échoue sur la contrainte UNIQUE.
        // On renvoie la même réponse 200 que la mitigation d'énumération pour ne pas fuiter l'existence du compte.
        await new Promise(resolve => setTimeout(resolve, Math.random() * 200 + 100));
        request.log.warn(`[SECOPS] Race condition 23505 interceptée sur register (email masqué).`);
        return reply.code(200).send({
          success: true,
          message: 'Si cet email n\'était pas déjà enregistré, votre compte a été créé.',
          user: { name: parsed.name, email: parsed.email }
        });
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