import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import dotenv from 'dotenv';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { helmetConfig, corsConfig } from './config/security.js';
import { errorHandler } from './middleware/error-handler.js';
import scoringRoutes from './routes/scoring.js';
import dashboardApiRoutes from './routes/dashboard-api.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const siteRoot = join(__dirname, '..', '..', 'public');

dotenv.config();

const fastify = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined
  },
  disableRequestLogging: true,
  bodyLimit: 1048576
});

await fastify.register(helmet, helmetConfig);
await fastify.register(cors, corsConfig);
await fastify.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
  allowList: ['127.0.0.1']
});

fastify.setErrorHandler(errorHandler);

fastify.get('/api/health', {
  schema: {
    response: {
      200: {
        type: 'object',
        properties: { status: { type: 'string' }, version: { type: 'string' } }
      }
    }
  }
}, async () => {
  return { status: 'ok', version: '1.0.0' };
});

await fastify.register(scoringRoutes);
await fastify.register(dashboardApiRoutes);

await fastify.register(fastifyStatic, {
  root: siteRoot,
  prefix: '/',
  index: ['index.html']
});

fastify.get('/dashboard', async (_request, reply) => {
  return reply.redirect(302, '/dashboard/');
});

fastify.setNotFoundHandler(async (request, reply) => {
  if (request.method !== 'GET') {
    return reply.code(404).send({ error: 'Not Found' });
  }
  const url = request.url.split('?')[0];
  if (url === '/dashboard' || url.startsWith('/dashboard/')) {
    const rest = url === '/dashboard' ? '' : url.slice('/dashboard/'.length);
    if (rest && rest.includes('.')) {
      return reply.code(404).send('Not Found');
    }
    const html = await readFile(join(siteRoot, 'dashboard/index.html'), 'utf-8');
    return reply.type('text/html').send(html);
  }
  return reply.code(404).send({ error: 'Not Found' });
});

const start = async () => {
  try {
    const port = process.env.PORT || 3000;
    await fastify.listen({ port, host: '0.0.0.0' });
    fastify.log.info(`[ARCHITECT-PRIME] Serveur SaaS Flaynn actif sur le port ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
