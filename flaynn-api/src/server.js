import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import fastifyRedis from '@fastify/redis';
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
// 👇 AJOUT STRIPE ÉTAPE 3 👇
import stripeRoutes from './routes/stripe.js';
// 👆 FIN AJOUT 👆
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
  REDIS_URL: z.string().url().optional(),
  LOAD_TEST: z.enum(['true', 'false']).default('false'),
  GOOGLE_SHEETS_WEBHOOK_URL: z.string().url().startsWith('https://script.google.com/').optional(),
  CORS_ORIGIN: z.string().optional(),
  // 👇 AJOUT STRIPE ÉTAPE 4 👇
  STRIPE_SECRET_KEY: z.string().startsWith('sk_').min(20),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_').optional(), // optionnel en dev
  APP_URL: z.string().url().default('https://flaynn.tech')
  // 👆 FIN AJOUT 👆
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

// Traçage complet : injection du Request-ID (Corrélation)
fastify.addHook('onRequest', async (request, reply) => {
  // Vérification ultra-rapide dans Redis si disponible
  if (fastify.redis) {
    try {
      const isBanned = await fastify.redis.get(`ban:${request.ip}`);
      if (isBanned) {
        request.log.warn(`[SECOPS] Blocage actif (Redis) pour IP bannie: ${request.ip}`);
        return reply.code(403).send({ error: 'FORBIDDEN', message: 'Accès bloqué temporairement pour abus.' });
      }
    } catch (err) {
      request.log.error(err, 'Erreur lors de la vérification Redis du bannissement IP');
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
    
    // ARCHITECT-PRIME: DATABASE_URL est requis par le schéma Zod — ce bloc ne peut échouer
    // que si la connexion PG elle-même échoue (géré par initDB qui throw)
    await initDB(fastify.log);
    
    // Redis : optionnel — fallback in-memory si non configuré
    if (env.REDIS_URL) {
      fastify.log.info(`[ARCHITECT-PRIME] Connexion à Redis...`);
      await fastify.register(fastifyRedis, { url: env.REDIS_URL });
      fastify.log.info(`[ARCHITECT-PRIME] Redis connecté.`);
    } else {
      fastify.log.warn(`[ARCHITECT-PRIME] REDIS_URL absent — rate limit en mémoire (non distribué).`);
    }

    await fastify.register(helmet, helmetConfig);
    await fastify.register(cors, corsConfig);

    const rateLimitOpts = {
      max: 100,
      timeWindow: '1 minute',
      allowList: env.LOAD_TEST === 'true' ? [] : ['127.0.0.1'],
    };

    // Délégation Redis si disponible
    if (fastify.redis) {
      rateLimitOpts.redis = fastify.redis;
      rateLimitOpts.onExceeded = async function (request, key) {
        request.log.warn(`[SECOPS] Rate Limit dépassé. Ban IP Redis 15 minutes: ${request.ip}`);
        await fastify.redis.set(`ban:${request.ip}`, 'true', 'EX', 15 * 60);
      };
    }

    await fastify.register(rateLimit, rateLimitOpts);
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

    // 👇 AJOUT STRIPE ÉTAPE 3 👇
    // IMPORTANT : Le parser RAW doit être défini avant les routes
    await fastify.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer' },
      function (req, body, done) {
        // Stocke le raw body pour la vérification de signature Stripe
        req.rawBody = body;
        try {
          done(null, JSON.parse(body));
        } catch (err) {
          done(err);
        }
      }
    );
    // 👆 FIN AJOUT 👆

    fastify.log.info(`[ARCHITECT-PRIME] Enregistrement des routes...`);
    await fastify.register(scoringRoutes);
    await fastify.register(dashboardApiRoutes);
    await fastify.register(authRoutes);
    await fastify.register(webhookRoutes);
    // 👇 AJOUT STRIPE ÉTAPE 3 👇
    await fastify.register(stripeRoutes);
    // 👆 FIN AJOUT 👆

    fastify.log.info(`[ARCHITECT-PRIME] Montage du dossier statique : ${siteRoot}`);
    await fastify.register(fastifyStatic, {
      root: siteRoot,
      prefix: '/',
      index: ['index.html']
    });

    // Gestion du Dashboard SPA + pages statiques
    fastify.get('/dashboard', async (_request, reply) => reply.code(302).redirect('/dashboard/'));
    fastify.get('/auth', async (_request, reply) => reply.code(302).redirect('/auth/'));
    fastify.get('/scoring/succes', async (request, reply) => {
      // ARCHITECT-PRIME: préserve les query params (?session_id=...) lors de la redirection
      const qs = request.url.includes('?') ? request.url.slice(request.url.indexOf('?')) : '';
      return reply.code(302).redirect(`/scoring/succes/${qs}`);
    });

    // ARCHITECT-PRIME: cache les HTML SPA en mémoire au boot (pas de readFile à chaque requête)
    const dashboardHtml = await readFile(join(siteRoot, 'dashboard/index.html'), 'utf-8');
    const authHtml = await readFile(join(siteRoot, 'auth/index.html'), 'utf-8');
    const scoringSuccesHtml = await readFile(join(siteRoot, 'scoring/succes/index.html'), 'utf-8');

    fastify.setNotFoundHandler(async (request, reply) => {
      if (request.method !== 'GET') return reply.code(404).send({ error: 'Not Found' });

      const url = request.url.split('?')[0];
      if (url === '/dashboard' || url.startsWith('/dashboard/')) {
        const rest = url === '/dashboard' ? '' : url.slice('/dashboard/'.length);
        if (rest && rest.includes('.')) return reply.code(404).send('Not Found');
        return reply.type('text/html').send(dashboardHtml);
      }
      if (url === '/auth' || url.startsWith('/auth/')) {
        const rest = url === '/auth' ? '' : url.slice('/auth/'.length);
        if (rest && rest.includes('.')) return reply.code(404).send('Not Found');
        return reply.type('text/html').send(authHtml);
      }
      if (url === '/scoring/succes' || url.startsWith('/scoring/succes/')) {
        const rest = url === '/scoring/succes' ? '' : url.slice('/scoring/succes/'.length);
        if (rest && rest.includes('.')) return reply.code(404).send('Not Found');
        return reply.type('text/html').send(scoringSuccesHtml);
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