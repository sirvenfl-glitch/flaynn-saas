import { z } from 'zod';
import argon2 from 'argon2';
import { pool } from '../config/db.js';
import { isDbUnavailableError } from '../utils/errors.js';

const SERVICE_UNAVAILABLE_BODY = {
  error: 'SERVICE_UNAVAILABLE',
  message: 'Service temporairement indisponible. Réessayez dans quelques instants.'
};

// Schémas Zod stricts
const LoginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(100)
}).strict();

const RegisterSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().email().max(254),
  password: z.string().min(8).max(100)
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
      const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [parsed.email]);
      if (rows.length === 0) {
        return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Email ou mot de passe incorrect.' });
      }
      const user = rows[0];

      // 2. On vérifie la signature cryptographique du mot de passe
      const isPasswordValid = await argon2.verify(user.password_hash, parsed.password);
      if (!isPasswordValid) {
        return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Email ou mot de passe incorrect.' });
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
      
      // 1. On vérifie l'existence de l'email dans la base de données
      const { rowCount } = await pool.query('SELECT id FROM users WHERE email = $1', [parsed.email]);
      if (rowCount > 0) {
        return reply.code(409).send({ error: 'CONFLICT', message: 'Cet email est déjà utilisé.' });
      }

      // 2. On hache le mot de passe avec Argon2 (salage inclus automatiquement)
      const passwordHash = await argon2.hash(parsed.password);
      
      // 3. Sauvegarde dans PostgreSQL
      const insert = await pool.query(
        'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email',
        [parsed.name, parsed.email, passwordHash]
      );
      const user = insert.rows[0];
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
        return reply.code(409).send({ error: 'CONFLICT', message: 'Cet email est déjà utilisé.' });
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
