import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import fastifyJwt from '@fastify/jwt';
import dotenv from 'dotenv';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { helmetConfig, corsConfig } from './config/security.js';
import { errorHandler } from './middleware/error-handler.js';
import scoringRoutes from './routes/scoring.js';
import dashboardApiRoutes from './routes/dashboard-api.js';
import authRoutes from './routes/auth.js';
import webhookRoutes from './routes/webhooks.js';
import { initDB, pool } from './config/db.js';
import authPlugin from './plugins/auth.js';
import deviceDetect from './plugins/device-detect.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Définition du chemin vers le dossier frontend public
const siteRoot = join(__dirname, '..', '..', 'public');

dotenv.config();

// --- PHASE 1: Validation stricte de l'environnement (Zod) ---
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('3000'),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, "Le JWT_SECRET doit faire au moins 32 caractères."),
  N8N_WEBHOOK_URL: z.string().url().optional(),
  N8N_SECRET_TOKEN: z.string().min(16).optional(),
  ANTHROPIC_API_KEY: z.string().startsWith('sk-ant-').optional(),
  CORS_ORIGIN: z.string().optional()
});

let env;
try {
  env = envSchema.parse(process.env);
} catch (err) {
  console.error('\n🛡️ [SECOPS FATAL] Variables d\'environnement invalides ou manquantes :');
  console.error(err.flatten().fieldErrors);
  process.exit(1);
}

// --- PHASE 1: Observabilité & Logger Pino Avancé ---
const fastify = Fastify({
  logger: {
    level: env.NODE_ENV === 'production' ? 'info' : 'debug',
    transport: env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'body.password', 'body.token', 'body.email', 'email', 'password', 'token'],
      censor: '[CAVIARDÉ]'
    }
  },
  genReqId: (req) => req.headers['x-request-id'] || randomUUID(),
  disableRequestLogging: true,
  bodyLimit: 1048576
});

// Système de défense active : Bannissement temporaire IP en mémoire
const bannedIPs = new Map();

// Traçage complet : injection du Request-ID (Corrélation)
fastify.addHook('onRequest', async (request, reply) => {
  const banExpiration = bannedIPs.get(request.ip);
  if (banExpiration) {
    if (Date.now() < banExpiration) {
      request.log.warn(`[SECOPS] Blocage actif pour IP bannie: ${request.ip}`);
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Accès bloqué temporairement pour abus.' });
    } else {
      bannedIPs.delete(request.ip); // Levée du ban
    }
  }
  
  request.log.info({ req: request }, 'Requête entrante');
});
fastify.addHook('onResponse', async (request, reply) => {
  request.log.info({ res: reply, responseTime: reply.getResponseTime() }, 'Requête traitée');
});
fastify.addHook('onSend', async (request, reply, payload) => {
  reply.header('X-Request-Id', request.id);

  // Escalade Rate Limit : Warn header si on approche de la limite (Phase 4)
  const remaining = reply.getHeader('x-ratelimit-remaining');
  if (remaining !== undefined && remaining < 50) {
    reply.header('X-RateLimit-Warning', 'Approaching rate limit. Escalation imminent.');
  }
});

// ARCHITECT FIX: Encapsulation TOTALE pour empêcher les crashs silencieux
export const start = async () => {
  try {
    fastify.log.info(`[ARCHITECT-PRIME] Initialisation de la sécurité...`);
    
    if (env.DATABASE_URL) {
      await initDB(fastify.log);
    } else {
      fastify.log.warn(`[ARCHITECT-PRIME] AVERTISSEMENT: DATABASE_URL manquant. Connectez PostgreSQL.`);
    }
    
    await fastify.register(helmet, helmetConfig);
    await fastify.register(cors, corsConfig);
    await fastify.register(rateLimit, {
      max: 100,
      timeWindow: '1 minute',
      allowList: ['127.0.0.1'], // Eviter de bannir localhost pendant les tests
      onExceeded: function (request, key) {
        request.log.warn(`[SECOPS] Rate Limit dépassé. Ban IP 15 minutes: ${request.ip}`);
        bannedIPs.set(request.ip, Date.now() + 15 * 60 * 1000);
      }
    });
    await fastify.register(fastifyJwt, {
      secret: env.JWT_SECRET
    });
    await authPlugin(fastify);
    await fastify.register(deviceDetect);

    fastify.setErrorHandler(errorHandler);

    // --- PHASE 1: Healthcheck PostgreSQL ---
    fastify.get('/api/health', {
      schema: {
        response: {
          200: { type: 'object', properties: { status: { type: 'string' }, db: { type: 'string' }, version: { type: 'string' } } }
        }
      }
    }, async (request, reply) => {
      let dbStatus = 'down';
      try {
        await pool.query('SELECT 1');
        dbStatus = 'up';
      } catch (err) {
        request.log.error(err, 'Healthcheck PostgreSQL échoué');
      }
      return { status: 'ok', db: dbStatus, version: '1.0.0' };
    });

    fastify.log.info(`[ARCHITECT-PRIME] Enregistrement des routes...`);
    await fastify.register(scoringRoutes);
    await fastify.register(dashboardApiRoutes);
    await fastify.register(authRoutes);
    await fastify.register(webhookRoutes);

    fastify.log.info(`[ARCHITECT-PRIME] Montage du dossier statique : ${siteRoot}`);
    await fastify.register(fastifyStatic, {
      root: siteRoot,
      prefix: '/',
      index: ['index.html']
    });

    // Gestion du Dashboard SPA
    fastify.get('/dashboard', async (_request, reply) => reply.code(302).redirect('/dashboard/'));
    fastify.get('/auth', async (_request, reply) => reply.code(302).redirect('/auth/'));

    fastify.setNotFoundHandler(async (request, reply) => {
      if (request.method !== 'GET') return reply.code(404).send({ error: 'Not Found' });
      
      const url = request.url.split('?')[0];
      if (url === '/dashboard' || url.startsWith('/dashboard/')) {
        const rest = url === '/dashboard' ? '' : url.slice('/dashboard/'.length);
        if (rest && rest.includes('.')) return reply.code(404).send('Not Found');
        
        const html = await readFile(join(siteRoot, 'dashboard/index.html'), 'utf-8');
        return reply.type('text/html').send(html);
      }
      if (url === '/auth' || url.startsWith('/auth/')) {
        const rest = url === '/auth' ? '' : url.slice('/auth/'.length);
        if (rest && rest.includes('.')) return reply.code(404).send('Not Found');

        const html = await readFile(join(siteRoot, 'auth/index.html'), 'utf-8');
        return reply.type('text/html').send(html);
      }
      return reply.code(404).send({ error: 'Not Found' });
    });

    const port = env.PORT;
    await fastify.listen({ port, host: '0.0.0.0' });
    fastify.log.info(`[ARCHITECT-PRIME] Serveur SaaS Flaynn actif sur le port ${port}`);

    // --- PHASE 3: Garbage Collector Sessions (Résilience) ---
    const gcInterval = setInterval(() => {
      pool.query('DELETE FROM refresh_tokens WHERE expires_at < NOW() OR revoked_at < NOW() - INTERVAL \'7 days\'')
        .catch(err => fastify.log.error(err, 'Erreur lors du Garbage Collection des sessions'));
    }, 1000 * 60 * 60); // Exécution toutes les heures
    gcInterval.unref(); // Ne bloque pas l'arrêt du processus Node

  } catch (err) {
    // Si une erreur survient (ex: dossier public introuvable sur Render), elle s'affichera ENFIN ici.
    console.error('\n[FATAL ERROR] Échec au démarrage du serveur :');
    console.error(err);
    fastify.log.error(err);
    process.exit(1);
  }
};

export const app = fastify;
if (env.NODE_ENV !== 'test') {
  start();
}
