import { z } from 'zod';
import argon2 from 'argon2';

// Base de données en mémoire temporaire (À remplacer par PostgreSQL/MongoDB)
const mockDB = new Map();

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
      
      // 1. On cherche l'utilisateur
      const user = mockDB.get(parsed.email);
      if (!user) {
        return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Email ou mot de passe incorrect.' });
      }

      // 2. On vérifie la signature cryptographique du mot de passe
      const isPasswordValid = await argon2.verify(user.passwordHash, parsed.password);
      if (!isPasswordValid) {
        return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Email ou mot de passe incorrect.' });
      }

      return reply.code(200).send({
        success: true,
        token: 'flaynn-mock-jwt-token', // TO-DO: Générer un vrai JWT crypté
        user: { name: user.name, email: user.email }
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.code(422).send({ error: 'VALIDATION_FAILED', message: 'Email ou mot de passe invalide.' });
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
      
      // 1. On vérifie l'existence de l'email
      if (mockDB.has(parsed.email)) {
        return reply.code(409).send({ error: 'CONFLICT', message: 'Cet email est déjà utilisé.' });
      }

      // 2. On hache le mot de passe avec Argon2 (salage inclus automatiquement)
      const passwordHash = await argon2.hash(parsed.password);
      mockDB.set(parsed.email, { name: parsed.name, email: parsed.email, passwordHash });

      return reply.code(200).send({
        success: true,
        token: 'flaynn-mock-jwt-token', // TO-DO: Générer un vrai JWT crypté
        user: { name: parsed.name, email: parsed.email }
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return reply.code(422).send({ error: 'VALIDATION_FAILED', message: 'Veuillez vérifier les champs.' });
      }
      request.log.error(err);
      return reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'Erreur interne du serveur.' });
    }
  });
}