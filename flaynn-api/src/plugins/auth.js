import { createHash, randomBytes } from 'node:crypto';
import { pool } from '../config/db.js';

const ACCESS_COOKIE = 'flaynn_at';
const REFRESH_COOKIE = 'flaynn_rt';
const ACCESS_TTL_SECONDS = 60 * 15;
const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 7;

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function parseCookies(header) {
  if (!header) return {};
  return header
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const idx = part.indexOf('=');
      if (idx === -1) return acc;
      const key = part.slice(0, idx);
      const value = part.slice(idx + 1);
      acc[key] = decodeURIComponent(value);
      return acc;
    }, {});
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path || '/'}`);
  if (typeof options.maxAge === 'number') parts.push(`Max-Age=${options.maxAge}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

export default async function authPlugin(fastify) {
  fastify.decorateRequest('cookies', null);

  fastify.addHook('onRequest', async (request) => {
    request.cookies = parseCookies(request.headers.cookie);
  });

  fastify.decorateReply('setAuthCookies', function setAuthCookies(tokens) {
    const secure = isProduction();
    const cookies = [
      serializeCookie(ACCESS_COOKIE, tokens.accessToken, {
        maxAge: ACCESS_TTL_SECONDS,
        httpOnly: true,
        sameSite: 'Lax',
        secure
      }),
      serializeCookie(REFRESH_COOKIE, tokens.refreshToken, {
        maxAge: REFRESH_TTL_SECONDS,
        httpOnly: true,
        sameSite: 'Strict',
        secure
      })
    ];
    this.header('Set-Cookie', cookies);
  });

  fastify.decorateReply('clearAuthCookies', function clearAuthCookies() {
    const secure = isProduction();
    this.header('Set-Cookie', [
      serializeCookie(ACCESS_COOKIE, '', {
        maxAge: 0,
        httpOnly: true,
        sameSite: 'Lax',
        secure
      }),
      serializeCookie(REFRESH_COOKIE, '', {
        maxAge: 0,
        httpOnly: true,
        sameSite: 'Strict',
        secure
      })
    ]);
  });

  fastify.decorate('createSessionTokens', async (user, tx = pool) => {
    const accessToken = fastify.jwt.sign(
      { sub: String(user.id), email: user.email, name: user.name },
      { expiresIn: `${ACCESS_TTL_SECONDS}s` }
    );
    const refreshToken = randomBytes(48).toString('base64url');
    const refreshHash = hashToken(refreshToken);
    await tx.query(
      `INSERT INTO refresh_tokens (token_hash, user_email, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
      [refreshHash, user.email]
    );
    return { accessToken, refreshToken };
  });

  fastify.decorate('revokeRefreshToken', async (token, tx = pool) => {
    if (!token) return;
    await tx.query(
      'UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL',
      [hashToken(token)]
    );
  });

  fastify.decorate('authenticate', async (request, reply) => {
    const accessToken = request.cookies?.[ACCESS_COOKIE];
    if (accessToken) {
      try {
        request.user = await fastify.jwt.verify(accessToken);
        return;
      } catch {
        /* Tentative refresh ci-dessous */
      }
    }

    const refreshToken = request.cookies?.[REFRESH_COOKIE];
    if (!refreshToken) {
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Veuillez vous reconnecter.' });
    }

    let client;
    try {
      client = await pool.connect();
    } catch (err) {
      request.log.error({ err }, 'auth_db_connect_failed');
      return reply.code(503).send({
        error: 'SERVICE_UNAVAILABLE',
        message: 'Service temporairement indisponible. Réessayez dans quelques instants.'
      });
    }

    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT rt.user_email, u.id, u.name
         FROM refresh_tokens rt
         JOIN users u ON u.email = rt.user_email
         WHERE rt.token_hash = $1
           AND rt.revoked_at IS NULL
           AND rt.expires_at > NOW()
         FOR UPDATE`,
        [hashToken(refreshToken)]
      );

      if (rows.length === 0) {
        await client.query('ROLLBACK');
        reply.clearAuthCookies();
        return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Session expirée. Veuillez vous reconnecter.' });
      }

      const user = {
        id: rows[0].id,
        email: rows[0].user_email,
        name: rows[0].name
      };

      await fastify.revokeRefreshToken(refreshToken, client);
      const nextTokens = await fastify.createSessionTokens(user, client);
      await client.query('COMMIT');

      reply.setAuthCookies(nextTokens);
      request.user = { sub: String(user.id), email: user.email, name: user.name };
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        request.log.warn({ err: rollbackErr }, 'auth_rollback_failed');
      }
      request.log.error(err);
      reply.clearAuthCookies();
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Session invalide.' });
    } finally {
      client.release();
    }
  });
}
