#!/usr/bin/env node
/**
 * Smoke test E2E Delta 14.1 — split certify / issue-activation.
 *
 * Cas couverts :
 *  1. POST /issue-activation sans token existant → 200 + activation_url + rotated:false
 *  2. POST /issue-activation rappelé pour la même ref → 200 + activation_url
 *     DIFFÉRENT + rotated:true (rotation : on ne peut pas re-dériver le token clair
 *     depuis le hash, donc l'ancien est révoqué et un nouveau est émis).
 *  3. POST /issue-activation avec référence inexistante → 404.
 *  4. POST /certify flip status → 200 sans activation_url (logique token retirée).
 *
 * Isolation : DB mockée en mémoire (patch pool.query avant import des routes).
 * Aucune dépendance externe (R2, n8n, Postgres) requise.
 *
 * Usage : node flaynn-api/scripts/smoke-delta-14.mjs
 * Exit 0 si 4/4 passés, 1 sinon.
 */

import { randomBytes } from 'node:crypto';

// Defaults nécessaires aux modules importés (pool, JWT-free routes).
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.N8N_SECRET_TOKEN = process.env.N8N_SECRET_TOKEN || 'smoke-test-n8n-token-12345678';
process.env.APP_URL = process.env.APP_URL || 'https://flaynn.test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://stub:stub@localhost:5432/stub';

// --- PHASE 1: in-memory stores ---------------------------------------------
const scoresStore = new Map();      // reference_id → { user_email, founder_email, status }
const usersStore = new Set();       // emails enregistrés
const activationsStore = new Map(); // token_hash → { email, reference_id, expires_at, used_at }

function mockQuery(sql, params = []) {
  const s = sql.trim().replace(/\s+/g, ' ');

  // /certify — flip status + RETURNING reference_id
  if (/^UPDATE scores SET data = jsonb_set\(data, '\{status\}', '"completed"'\) WHERE reference_id = \$1 RETURNING reference_id$/i.test(s)) {
    const row = scoresStore.get(params[0]);
    if (!row) return Promise.resolve({ rowCount: 0, rows: [] });
    row.status = 'completed';
    return Promise.resolve({ rowCount: 1, rows: [{ reference_id: params[0] }] });
  }

  // /issue-activation — SELECT user_email + founder_email
  if (/^SELECT user_email, data->'payload'->>'email' AS founder_email FROM scores WHERE reference_id = \$1$/i.test(s)) {
    const row = scoresStore.get(params[0]);
    if (!row) return Promise.resolve({ rowCount: 0, rows: [] });
    return Promise.resolve({
      rowCount: 1,
      rows: [{ user_email: row.user_email, founder_email: row.founder_email }]
    });
  }

  // /issue-activation — check user existant
  if (/^SELECT 1 FROM users WHERE email = \$1$/i.test(s)) {
    const exists = usersStore.has(params[0]);
    return Promise.resolve({ rowCount: exists ? 1 : 0, rows: exists ? [{ '?column?': 1 }] : [] });
  }

  // activation-tokens.js / revokeUnusedActivationsFor
  if (/^UPDATE account_activations SET used_at = NOW\(\) WHERE reference_id = \$1 AND used_at IS NULL$/i.test(s)) {
    let count = 0;
    for (const row of activationsStore.values()) {
      if (row.reference_id === params[0] && !row.used_at) {
        row.used_at = new Date();
        count++;
      }
    }
    return Promise.resolve({ rowCount: count, rows: [] });
  }

  // activation-tokens.js / issueActivationToken — INSERT
  if (/^INSERT INTO account_activations \(token_hash, email, reference_id, expires_at\) VALUES \(\$1, \$2, \$3, \$4\)$/i.test(s)) {
    const [tokenHash, email, referenceId, expiresAt] = params;
    activationsStore.set(tokenHash, {
      email,
      reference_id: referenceId,
      expires_at: expiresAt,
      used_at: null
    });
    return Promise.resolve({ rowCount: 1, rows: [] });
  }

  return Promise.reject(new Error(`mockQuery: unhandled SQL: ${s.slice(0, 160)}`));
}

// --- PHASE 2: monkey-patch pool AVANT import des routes --------------------
const dbModule = await import('../src/config/db.js');
dbModule.pool.query = mockQuery;

const [{ default: webhookRoutes }, { default: Fastify }] = await Promise.all([
  import('../src/routes/webhooks.js'),
  import('fastify')
]);

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(webhookRoutes);
  return app;
}

// --- PHASE 3: helpers runner ----------------------------------------------
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const RST = '\x1b[0m';

const results = [];
function record(name, passed, detail = '') {
  results.push({ name, passed, detail });
  const tag = passed ? `${GREEN}✓${RST}` : `${RED}✗${RST}`;
  console.log(`  ${tag} ${name}${detail ? ` ${DIM}${detail}${RST}` : ''}`);
}

const SIG = process.env.N8N_SECRET_TOKEN;

function newRef() {
  return `FLY-${randomBytes(4).toString('hex').toUpperCase()}`;
}

// --- PHASE 4: scénarios ----------------------------------------------------
async function test1_issueFresh(app) {
  const ref = newRef();
  scoresStore.set(ref, { user_email: null, founder_email: 'founder@smoke.test', status: 'under_review' });

  const res = await app.inject({
    method: 'POST',
    url: '/api/webhooks/n8n/issue-activation',
    headers: { 'content-type': 'application/json', 'x-flaynn-signature': SIG },
    payload: JSON.stringify({ reference: ref })
  });

  if (res.statusCode !== 200) {
    record('1. issue-activation fresh → 200', false, `got ${res.statusCode}: ${res.body.slice(0, 120)}`);
    return null;
  }
  const body = JSON.parse(res.body);
  if (!body.success || !body.activation_url || !body.activation_url.includes('?token=')) {
    record('1. issue-activation fresh → 200', false, `bad body: ${JSON.stringify(body)}`);
    return null;
  }
  if (body.rotated !== false) {
    record('1. issue-activation fresh → 200', false, `rotated should be false, got ${body.rotated}`);
    return null;
  }
  if (!body.expires_at) {
    record('1. issue-activation fresh → 200', false, 'expires_at missing');
    return null;
  }
  record('1. issue-activation fresh → 200 + activation_url + rotated:false', true, `ref=${ref}`);
  return { ref, url: body.activation_url };
}

async function test2_issueRotates(app, prev) {
  if (!prev) {
    record('2. issue-activation re-call rotates token', false, 'precondition failed');
    return;
  }

  const res = await app.inject({
    method: 'POST',
    url: '/api/webhooks/n8n/issue-activation',
    headers: { 'content-type': 'application/json', 'x-flaynn-signature': SIG },
    payload: JSON.stringify({ reference: prev.ref })
  });

  if (res.statusCode !== 200) {
    record('2. issue-activation re-call rotates token', false, `got ${res.statusCode}: ${res.body.slice(0, 120)}`);
    return;
  }
  const body = JSON.parse(res.body);
  if (body.activation_url === prev.url) {
    record('2. issue-activation re-call rotates token', false, 'URL unchanged — should rotate');
    return;
  }
  if (body.rotated !== true) {
    record('2. issue-activation re-call rotates token', false, `rotated flag = ${body.rotated}`);
    return;
  }
  // Vérifie qu'il existe exactement 1 token unused pour cette ref
  let unused = 0;
  for (const row of activationsStore.values()) {
    if (row.reference_id === prev.ref && !row.used_at) unused++;
  }
  if (unused !== 1) {
    record('2. issue-activation re-call rotates token', false, `expected 1 unused token, got ${unused}`);
    return;
  }
  record('2. issue-activation re-call rotates token', true, 'fresh URL + rotated:true + 1 unused');
}

async function test3_issueRefNotFound(app) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/webhooks/n8n/issue-activation',
    headers: { 'content-type': 'application/json', 'x-flaynn-signature': SIG },
    payload: JSON.stringify({ reference: 'FLY-DEADBEEF' })
  });
  if (res.statusCode !== 404) {
    record('3. issue-activation unknown ref → 404', false, `got ${res.statusCode}: ${res.body.slice(0, 120)}`);
    return;
  }
  record('3. issue-activation unknown ref → 404', true);
}

async function test4_certifyFlipNoToken(app) {
  const ref = newRef();
  scoresStore.set(ref, { user_email: null, founder_email: 'flip@smoke.test', status: 'under_review' });

  const tokensBefore = activationsStore.size;

  const res = await app.inject({
    method: 'POST',
    url: '/api/webhooks/n8n/certify',
    headers: { 'content-type': 'application/json', 'x-flaynn-signature': SIG },
    payload: JSON.stringify({ reference: ref })
  });

  if (res.statusCode !== 200) {
    record('4. certify flips status (no token logic)', false, `got ${res.statusCode}: ${res.body}`);
    return;
  }
  const body = JSON.parse(res.body);
  if ('activation_url' in body) {
    record('4. certify flips status (no token logic)', false, 'activation_url should not be in response');
    return;
  }
  if (scoresStore.get(ref).status !== 'completed') {
    record('4. certify flips status (no token logic)', false, `status not flipped: ${scoresStore.get(ref).status}`);
    return;
  }
  if (activationsStore.size !== tokensBefore) {
    record('4. certify flips status (no token logic)', false, `${activationsStore.size - tokensBefore} token(s) emitted by certify`);
    return;
  }
  record('4. certify flips status (no token logic)', true, 'status=completed, 0 tokens, no activation_url');
}

// --- PHASE 5: main ---------------------------------------------------------
async function main() {
  const app = await buildApp();
  console.log('\n[Smoke Delta 14.1] split certify / issue-activation\n');
  const prev = await test1_issueFresh(app);
  await test2_issueRotates(app, prev);
  await test3_issueRefNotFound(app);
  await test4_certifyFlipNoToken(app);
  await app.close();

  const pass = results.filter((r) => r.passed).length;
  const total = results.length;
  const color = pass === total ? GREEN : RED;
  console.log(`\n${color}${pass}/${total} tests passed${RST}\n`);
  process.exit(pass === total ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
