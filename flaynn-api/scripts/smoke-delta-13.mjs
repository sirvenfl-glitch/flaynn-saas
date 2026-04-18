#!/usr/bin/env node
/**
 * Smoke test E2E Delta 13 — R2 storage.
 *
 * Objectif : valider que les 4 routes refactorées (POST /api/score,
 * POST /api/webhooks/n8n/pdf, GET /api/decks/*, GET /api/dashboard/*)
 * fonctionnent contre un vrai bucket R2.
 *
 * Usage :
 *   R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
 *   R2_BUCKET=flaynn-pdfs node scripts/smoke-delta-13.mjs
 *
 * Isolation :
 *  - DB mockée en mémoire (patch pool.query avant import routes).
 *  - n8nBridge.submitScore stubbée (pas d'appel HTTP externe).
 *  - Clés R2 utilisent les patterns prod (decks/FLY-X.pdf, reports/...,
 *    extras/.../N.pdf) avec des reference_id FLY-<8 hex> uniques trackés.
 *    Cleanup DELETE sur chaque clé à la fin — pas de pollution durable
 *    du bucket même si le test crash au milieu (best-effort).
 *
 * Exit 0 si 13/13 passés, 1 sinon.
 */

import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';

// --- PHASE 0: env check ------------------------------------------------------
const REQUIRED = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`\n✗ Missing R2 env vars: ${missing.join(', ')}`);
  console.error('  Set R2_* env vars before running. Copy from Notion / Render dashboard.');
  console.error('  Example: R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \\');
  console.error('           R2_BUCKET=flaynn-pdfs node scripts/smoke-delta-13.mjs\n');
  process.exit(1);
}

// Defaults pour les vars consommées par le code de prod quand on importe les routes.
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.N8N_SECRET_TOKEN = process.env.N8N_SECRET_TOKEN || 'smoke-test-n8n-token-12345678';
process.env.OCR_BYPASS_TOKEN = process.env.OCR_BYPASS_TOKEN || 'smoke-test-ocr-token';

// --- PHASE 1: In-memory DB mock ---------------------------------------------
// Structure : reference_id → row. Le matcher SQL ci-dessous reconnaît les requêtes
// exactes émises par les 3 routes testées + celles annexes (scoring/decks, dashboard/:id).
const store = new Map(); // reference_id -> { reference_id, user_email, startup_name, data, created_at }

function mockQuery(sql, params = []) {
  const s = sql.trim().replace(/\s+/g, ' ');

  // scoring.js — vérif user existant
  if (/^SELECT email FROM users WHERE email = \$1$/i.test(s)) {
    return Promise.resolve({ rowCount: 0, rows: [] });
  }

  // scoring.js — insert nouveau score (data passé en string JSON)
  if (/^INSERT INTO scores \(reference_id, user_email, startup_name, data\) VALUES \(\$1, \$2, \$3, \$4::jsonb\)$/i.test(s)) {
    const [reference_id, user_email, startup_name, dataStr] = params;
    store.set(reference_id, {
      reference_id,
      user_email,
      startup_name,
      data: JSON.parse(dataStr),
      created_at: new Date().toISOString(),
    });
    return Promise.resolve({ rowCount: 1, rows: [] });
  }

  // scoring.js — fallback status='error' si n8nBridge KO (stubbé, ne devrait pas fire)
  if (/^UPDATE scores SET data = jsonb_set\(data, '\{status\}', '"error"'\) WHERE reference_id = \$1$/i.test(s)) {
    const row = store.get(params[0]);
    if (row) row.data = { ...row.data, status: 'error' };
    return Promise.resolve({ rowCount: row ? 1 : 0, rows: [] });
  }

  // scoring.js — SELECT data->'pitch_deck_storage' as storage (decks/:ref + /view)
  if (/^SELECT data->'pitch_deck_storage' as storage FROM scores WHERE reference_id = \$1$/i.test(s)) {
    const row = store.get(params[0]);
    if (!row) return Promise.resolve({ rowCount: 0, rows: [] });
    return Promise.resolve({ rowCount: 1, rows: [{ storage: row.data?.pitch_deck_storage ?? null }] });
  }

  // scoring.js — SELECT data->'extra_docs' as extra_docs (decks/:ref/extra/:index)
  if (/^SELECT data->'extra_docs' as extra_docs FROM scores WHERE reference_id = \$1$/i.test(s)) {
    const row = store.get(params[0]);
    if (!row) return Promise.resolve({ rowCount: 0, rows: [] });
    return Promise.resolve({ rowCount: 1, rows: [{ extra_docs: row.data?.extra_docs ?? null }] });
  }

  // webhooks.js — vérif existence ref
  if (/^SELECT 1 FROM scores WHERE reference_id = \$1$/i.test(s)) {
    const row = store.get(params[0]);
    return Promise.resolve({ rowCount: row ? 1 : 0, rows: row ? [{ '?column?': 1 }] : [] });
  }

  // webhooks.js — update pdf_report_storage (dataStr en param 2)
  if (/^UPDATE scores SET data = jsonb_set\(data, '\{pdf_report_storage\}', \$2::jsonb\) WHERE reference_id = \$1$/i.test(s)) {
    const [ref, dataStr] = params;
    const row = store.get(ref);
    if (!row) return Promise.resolve({ rowCount: 0, rows: [] });
    row.data = { ...row.data, pdf_report_storage: JSON.parse(dataStr) };
    return Promise.resolve({ rowCount: 1, rows: [] });
  }

  // dashboard-api.js — GET /:id/pdf (ownership check)
  if (/^SELECT data->'pdf_report_storage' as storage FROM scores WHERE reference_id = \$1 AND user_email = \$2$/i.test(s)) {
    const [ref, email] = params;
    const row = store.get(ref);
    if (!row || row.user_email !== email) return Promise.resolve({ rowCount: 0, rows: [] });
    return Promise.resolve({ rowCount: 1, rows: [{ storage: row.data?.pdf_report_storage ?? null }] });
  }

  // dashboard-api.js — GET /:id (full data)
  if (/^SELECT data, startup_name, created_at FROM scores WHERE reference_id = \$1 AND user_email = \$2$/i.test(s)) {
    const [ref, email] = params;
    const row = store.get(ref);
    if (!row || row.user_email !== email) return Promise.resolve({ rowCount: 0, rows: [] });
    return Promise.resolve({
      rowCount: 1,
      rows: [{ data: row.data, startup_name: row.startup_name, created_at: row.created_at }],
    });
  }

  // dashboard-api.js — previousData lookup (pas de match attendu dans le smoke test)
  if (/WHERE user_email = \$1 AND startup_name = \$2 AND reference_id != \$3/i.test(s)) {
    return Promise.resolve({ rowCount: 0, rows: [] });
  }

  // Matcher Delta 9 (public_cards) — retourne vide, smoke test ne vérifie
  // pas la logique card publique (Delta 9 a ses propres tests).
  if (/^SELECT id, slug, view_count, created_at, og_image_path FROM public_cards WHERE reference_id = \$1 AND user_email = \$2 AND is_active = TRUE/i.test(s)) {
    return Promise.resolve({ rowCount: 0, rows: [] });
  }

  // dashboard-api.js — GET /list
  if (/^SELECT reference_id, startup_name, created_at FROM scores WHERE user_email = \$1/i.test(s)) {
    const rows = [...store.values()]
      .filter((r) => r.user_email === params[0])
      .map((r) => ({ reference_id: r.reference_id, startup_name: r.startup_name, created_at: r.created_at }));
    return Promise.resolve({ rowCount: rows.length, rows });
  }

  // Unknown query : log + throw pour attirer l'attention si une nouvelle route apparaît.
  const err = new Error(`mockQuery: unhandled SQL: ${s.slice(0, 120)}`);
  return Promise.reject(err);
}

// --- PHASE 2: Monkey-patch pool.query + n8nBridge AVANT d'importer les routes ----
const dbModule = await import('../src/config/db.js');
dbModule.pool.query = mockQuery;
dbModule.pool.connect = async () => ({
  query: mockQuery,
  release: () => {},
});

const n8nModule = await import('../src/services/n8n-bridge.js');
n8nModule.n8nBridge.submitScore = async () => true;

// --- PHASE 3: Maintenant import des routes + r2 wrapper --------------------
const [{ default: scoringRoutes }, { default: webhookRoutes }, { default: dashboardApiRoutes }, r2] = await Promise.all([
  import('../src/routes/scoring.js'),
  import('../src/routes/webhooks.js'),
  import('../src/routes/dashboard-api.js'),
  import('../src/lib/r2-storage.js'),
]);

const { default: Fastify } = await import('fastify');

// --- PHASE 4: Minimal PDF buffer (>100 bytes, valide assez pour R2) --------
const MINIMAL_PDF = Buffer.from(
  '%PDF-1.4\n' +
  '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
  '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 3 3]>>endobj\n' +
  'xref\n0 4\n' +
  '0000000000 65535 f \n' +
  '0000000009 00000 n \n' +
  '0000000052 00000 n \n' +
  '0000000101 00000 n \n' +
  'trailer<</Size 4/Root 1 0 R>>\nstartxref\n149\n%%EOF\n',
  'utf8'
);

// --- PHASE 5: Build Fastify avec routes + stub authenticate ----------------
async function buildApp() {
  const app = Fastify({ logger: false });

  // Stub JWT decorator — scoring.js appelle fastify.jwt.verify sur les cookies.
  // Ici on n'envoie jamais de cookie → la branche n'est pas exercée.
  app.decorate('jwt', { verify: () => { throw new Error('jwt not available in smoke test'); } });

  // Stub authenticate : fixe un user pour les routes dashboard.
  app.decorate('authenticate', async (request) => {
    request.user = { email: OWNER_EMAIL, name: 'Smoke Test' };
  });

  // Override authenticate pour le test "user différent" (scénario 8)
  app.decorate('authenticateAsOther', async (request) => {
    request.user = { email: OTHER_EMAIL, name: 'Other User' };
  });

  await app.register(scoringRoutes);
  await app.register(webhookRoutes);
  await app.register(dashboardApiRoutes);
  return app;
}

// --- PHASE 6: Helpers test runner ------------------------------------------
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YEL = '\x1b[33m';
const DIM = '\x1b[2m';
const RST = '\x1b[0m';

const results = [];
function record(name, passed, detail = '') {
  results.push({ name, passed, detail });
  const tag = passed ? `${GREEN}✓${RST}` : `${RED}✗${RST}`;
  console.log(`  ${tag} ${name}${detail ? ` ${DIM}${detail}${RST}` : ''}`);
}

function buildValidScorePayload(overrides = {}) {
  return {
    nom_fondateur: 'Jane Doe',
    email: 'jane@smoke.test',
    pays: 'France',
    ville: 'Paris',
    nom_startup: 'SmokeCo',
    pitch_une_phrase: 'Une plateforme de test fumée pour valider Delta 13.',
    probleme: 'Les smoke tests n\'existent pas pour ce module donc on en écrit un maintenant.',
    solution: 'On écrit un script smoke-delta-13.mjs qui exerce tout le flow R2 bout en bout.',
    secteur: 'saas',
    type_client: 'b2b',
    tam_usd: '100M',
    estimation_tam: 'Marché estimé via comparables sectoriels et projections top-down.',
    acquisition_clients: 'Canal principal : outbound sales + content marketing SEO niche.',
    concurrents: 'CompetitorA, CompetitorB, CompetitorC sur le segment adjacent.',
    moat: 'Effet réseau croissant + base de données propriétaire qualifiée année par année.',
    stade: 'mvp',
    revenus: 'oui',
    mrr: 5000,
    clients_payants: 3,
    pourquoi_vous: 'Équipe ayant shipé deux startups dans le secteur avec exit modeste.',
    equipe_temps_plein: 'oui',
    priorite_6_mois: 'Atteindre 50k MRR avec un CAC sub-3-mois payback stable.',
    montant_leve: '500K',
    jalons_18_mois: 'Passer de 5k à 100k MRR, recruter 4 personnes, ouvrir 2 marchés.',
    utilisation_fonds: 'Hires (60%), marketing (25%), tech/infra (15%) pour 18 mois runway.',
    vision_5_ans: 'Devenir la référence européenne sur notre segment avec 50M ARR.',
    pitch_deck_base64: MINIMAL_PDF.toString('base64'),
    pitch_deck_filename: 'deck.pdf',
    ...overrides,
  };
}

// --- PHASE 7: Scénarios -----------------------------------------------------
const OWNER_EMAIL = 'jane@smoke.test';
const OTHER_EMAIL = 'other@smoke.test';
const createdRefs = new Set();
let app;
let createdRef; // ref créée au scénario 1, réutilisée par 3, 6-12

async function scenario1_scoreUpload() {
  const payload = buildValidScorePayload({
    extra_docs: [
      { filename: 'annex1.pdf', base64: MINIMAL_PDF.toString('base64') },
      { filename: 'annex2.pdf', base64: MINIMAL_PDF.toString('base64') },
    ],
  });

  const res = await app.inject({
    method: 'POST',
    url: '/api/score',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify(payload),
  });

  if (res.statusCode !== 200) {
    record('1. POST /api/score (deck + 2 extras) → 200', false, `got ${res.statusCode}: ${res.body.slice(0, 150)}`);
    return;
  }
  const body = JSON.parse(res.body);
  if (!body.success || !body.reference) {
    record('1. POST /api/score (deck + 2 extras) → 200', false, `bad body: ${res.body}`);
    return;
  }

  createdRef = body.reference;
  createdRefs.add(createdRef);

  // Injecter user_email pour simuler la DB prod (scoring.js passe null si pas de cookie).
  const row = store.get(createdRef);
  if (row) row.user_email = OWNER_EMAIL;

  // HeadObject sur les 3 clés
  const deckHead = await r2.headObject(`decks/${createdRef}.pdf`);
  const x0Head = await r2.headObject(`extras/${createdRef}/0.pdf`);
  const x1Head = await r2.headObject(`extras/${createdRef}/1.pdf`);

  if (!deckHead || !x0Head || !x1Head) {
    record('1. POST /api/score (deck + 2 extras) → 200', false, 'R2 HeadObject missed one key');
    return;
  }
  record('1. POST /api/score (deck + 2 extras) → 200 + 3 R2 keys', true, `ref=${createdRef}`);
}

async function scenario2_bodyLimit() {
  // 26 MB de padding base64-like dans pitch_deck_base64 → fastify bodyLimit 25MB → 413.
  const huge = 'A'.repeat(26 * 1024 * 1024);
  const payload = buildValidScorePayload({ pitch_deck_base64: huge });

  const res = await app.inject({
    method: 'POST',
    url: '/api/score',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify(payload),
  });

  // Fastify renvoie 413 Payload Too Large sur bodyLimit hit.
  if (res.statusCode !== 413) {
    record('2. POST /api/score body > 25 MB → 413', false, `got ${res.statusCode}`);
    return;
  }
  record('2. POST /api/score body > 25 MB → 413', true);
}

async function scenario3_webhookPdfOk() {
  if (!createdRef) { record('3. POST /api/webhooks/n8n/pdf → 200', false, 'ref preseq missing'); return; }

  const res = await app.inject({
    method: 'POST',
    url: '/api/webhooks/n8n/pdf',
    headers: {
      'content-type': 'application/json',
      'x-flaynn-signature': process.env.N8N_SECRET_TOKEN,
    },
    payload: JSON.stringify({ reference: createdRef, pdf_base64: MINIMAL_PDF.toString('base64') }),
  });

  if (res.statusCode !== 200) {
    record('3. POST /api/webhooks/n8n/pdf → 200', false, `got ${res.statusCode}: ${res.body.slice(0, 150)}`);
    return;
  }
  const head = await r2.headObject(`reports/${createdRef}.pdf`);
  if (!head) {
    record('3. POST /api/webhooks/n8n/pdf → 200', false, 'R2 reports/ key not found');
    return;
  }
  record('3. POST /api/webhooks/n8n/pdf → 200 + R2 key', true);
}

async function scenario4_webhookNoSig() {
  const res = await app.inject({
    method: 'POST',
    url: '/api/webhooks/n8n/pdf',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ reference: 'FLY-AAAABBBB', pdf_base64: MINIMAL_PDF.toString('base64') }),
  });
  if (res.statusCode !== 401) {
    record('4. POST /api/webhooks/n8n/pdf sans signature → 401', false, `got ${res.statusCode}`);
    return;
  }
  record('4. POST /api/webhooks/n8n/pdf sans signature → 401', true);
}

async function scenario5_webhookBadPdf() {
  if (!createdRef) { record('5. webhook pdf bad base64 → 400', false, 'ref preseq missing'); return; }

  const res = await app.inject({
    method: 'POST',
    url: '/api/webhooks/n8n/pdf',
    headers: {
      'content-type': 'application/json',
      'x-flaynn-signature': process.env.N8N_SECRET_TOKEN,
    },
    payload: JSON.stringify({ reference: createdRef, pdf_base64: 'aaa' }),
  });
  if (res.statusCode !== 400) {
    record('5. webhook pdf base64 trop court → 400 INVALID_PDF', false, `got ${res.statusCode}`);
    return;
  }
  const body = JSON.parse(res.body);
  if (body.error !== 'INVALID_PDF') {
    record('5. webhook pdf base64 trop court → 400 INVALID_PDF', false, `bad error: ${body.error}`);
    return;
  }
  record('5. webhook pdf base64 trop court → 400 INVALID_PDF', true);
}

async function scenario6_dashboardPdfOk() {
  if (!createdRef) { record('6. GET /api/dashboard/:id/pdf → 302 + fetch', false, 'ref preseq missing'); return; }

  const res = await app.inject({ method: 'GET', url: `/api/dashboard/${createdRef}/pdf` });
  if (res.statusCode !== 302) {
    record('6. GET /api/dashboard/:id/pdf → 302 + fetch', false, `got ${res.statusCode}: ${res.body.slice(0, 150)}`);
    return;
  }
  const loc = res.headers.location;
  if (!loc || !loc.startsWith('https://')) {
    record('6. GET /api/dashboard/:id/pdf → 302 + fetch', false, `bad location: ${loc}`);
    return;
  }
  // Fetch la signed URL → doit retourner 200 + bytes
  const fetched = await fetch(loc);
  if (fetched.status !== 200) {
    record('6. GET /api/dashboard/:id/pdf → 302 + fetch', false, `signed URL fetch status ${fetched.status}`);
    return;
  }
  const buf = Buffer.from(await fetched.arrayBuffer());
  if (buf.length !== MINIMAL_PDF.length) {
    record('6. GET /api/dashboard/:id/pdf → 302 + fetch', false, `size mismatch ${buf.length} vs ${MINIMAL_PDF.length}`);
    return;
  }
  record('6. GET /api/dashboard/:id/pdf → 302 + fetched bytes match', true);
}

async function scenario7_dashboardPdfNotReady() {
  // Créer un row sans pdf_report_storage
  const ref = `FLY-${randomBytes(4).toString('hex').toUpperCase()}`;
  createdRefs.add(ref);
  store.set(ref, {
    reference_id: ref,
    user_email: OWNER_EMAIL,
    startup_name: 'NoPdfCo',
    data: { status: 'pending_analysis', payload: {} },
    created_at: new Date().toISOString(),
  });

  const res = await app.inject({ method: 'GET', url: `/api/dashboard/${ref}/pdf` });
  if (res.statusCode !== 404) {
    record('7. dashboard/:id/pdf sans storage → 404 PDF_NOT_READY', false, `got ${res.statusCode}`);
    return;
  }
  const body = JSON.parse(res.body);
  if (body.error !== 'PDF_NOT_READY') {
    record('7. dashboard/:id/pdf sans storage → 404 PDF_NOT_READY', false, `bad error: ${body.error}`);
    return;
  }
  record('7. dashboard/:id/pdf sans storage → 404 PDF_NOT_READY', true);
}

async function scenario8_dashboardPdfOtherUser() {
  if (!createdRef) { record('8. dashboard/:id/pdf autre user → 404 NOT_FOUND', false, 'ref preseq missing'); return; }

  // Rebuild app avec authenticate pointant sur OTHER_EMAIL
  const other = Fastify({ logger: false });
  other.decorate('jwt', { verify: () => { throw new Error('x'); } });
  other.decorate('authenticate', async (request) => {
    request.user = { email: OTHER_EMAIL, name: 'Other' };
  });
  await other.register(dashboardApiRoutes);

  const res = await other.inject({ method: 'GET', url: `/api/dashboard/${createdRef}/pdf` });
  await other.close();

  if (res.statusCode !== 404) {
    record('8. dashboard/:id/pdf autre user → 404 NOT_FOUND', false, `got ${res.statusCode}`);
    return;
  }
  const body = JSON.parse(res.body);
  if (body.error !== 'NOT_FOUND') {
    record('8. dashboard/:id/pdf autre user → 404 NOT_FOUND', false, `bad error: ${body.error}`);
    return;
  }
  record('8. dashboard/:id/pdf autre user → 404 NOT_FOUND', true);
}

async function scenario9_dashboardGetFlags() {
  if (!createdRef) { record('9. GET /api/dashboard/:id → has_pdf + has_pitch_deck', false, 'ref preseq missing'); return; }

  const res = await app.inject({ method: 'GET', url: `/api/dashboard/${createdRef}` });
  if (res.statusCode !== 200) {
    record('9. GET /api/dashboard/:id → has_pdf + has_pitch_deck', false, `got ${res.statusCode}: ${res.body.slice(0, 150)}`);
    return;
  }
  const body = JSON.parse(res.body);
  if (body.has_pdf !== true || body.has_pitch_deck !== true) {
    record('9. GET /api/dashboard/:id → has_pdf + has_pitch_deck', false,
      `has_pdf=${body.has_pdf}, has_pitch_deck=${body.has_pitch_deck}`);
    return;
  }
  record('9. GET /api/dashboard/:id → has_pdf: true + has_pitch_deck: true', true);
}

async function scenario10_decksView() {
  if (!createdRef) { record('10. GET /api/decks/:ref/view → 302 + fetch', false, 'ref preseq missing'); return; }

  const res = await app.inject({ method: 'GET', url: `/api/decks/${createdRef}/view` });
  if (res.statusCode !== 302) {
    record('10. GET /api/decks/:ref/view → 302 + fetch', false, `got ${res.statusCode}`);
    return;
  }
  const loc = res.headers.location;
  const fetched = await fetch(loc);
  if (fetched.status !== 200) {
    record('10. GET /api/decks/:ref/view → 302 + fetch', false, `signed URL status ${fetched.status}`);
    return;
  }
  record('10. GET /api/decks/:ref/view → 302 + fetched bytes', true);
}

async function scenario11_decksOcrOk() {
  if (!createdRef) { record('11. GET /api/decks/:ref?ocr_token → 302', false, 'ref preseq missing'); return; }

  const res = await app.inject({
    method: 'GET',
    url: `/api/decks/${createdRef}?ocr_token=${encodeURIComponent(process.env.OCR_BYPASS_TOKEN)}`,
  });
  if (res.statusCode !== 302) {
    record('11. GET /api/decks/:ref?ocr_token → 302', false, `got ${res.statusCode}: ${res.body.slice(0, 150)}`);
    return;
  }
  record('11. GET /api/decks/:ref?ocr_token → 302', true);
}

async function scenario12_decksNoToken() {
  if (!createdRef) { record('12. GET /api/decks/:ref sans token → 403', false, 'ref preseq missing'); return; }

  const res = await app.inject({ method: 'GET', url: `/api/decks/${createdRef}` });
  if (res.statusCode !== 403) {
    record('12. GET /api/decks/:ref sans token → 403', false, `got ${res.statusCode}`);
    return;
  }
  record('12. GET /api/decks/:ref sans token → 403', true);
}

async function scenario13_cleanup() {
  const keys = [];
  for (const ref of createdRefs) {
    keys.push(`decks/${ref}.pdf`, `reports/${ref}.pdf`);
    for (let i = 0; i < 5; i++) keys.push(`extras/${ref}/${i}.pdf`);
  }

  let deleted = 0;
  let errors = 0;
  await Promise.all(keys.map(async (k) => {
    try {
      await r2.deleteObject(k);
      deleted++;
    } catch {
      errors++; // 404 sur clé inexistante : normal (on tente toutes combinaisons)
    }
  }));

  // Vérifier qu'aucune clé créée pendant le test ne subsiste.
  const expectedKeys = [
    ...[...createdRefs].map((r) => `decks/${r}.pdf`),
    ...[...createdRefs].map((r) => `reports/${r}.pdf`),
  ];
  let survivors = 0;
  for (const k of expectedKeys) {
    const head = await r2.headObject(k);
    if (head) survivors++;
  }

  if (survivors > 0) {
    record('13. Cleanup R2 (aucun survivant)', false, `${survivors} key(s) survived`);
    return;
  }
  record('13. Cleanup R2', true, `deleted=${deleted} del_errs=${errors}`);
}

// --- PHASE 8: Main ----------------------------------------------------------
async function main() {
  const t0 = performance.now();
  console.log(`\n${DIM}Smoke Delta 13 — bucket=${process.env.R2_BUCKET}${RST}\n`);

  app = await buildApp();

  const steps = [
    scenario1_scoreUpload,
    scenario2_bodyLimit,
    scenario3_webhookPdfOk,
    scenario4_webhookNoSig,
    scenario5_webhookBadPdf,
    scenario6_dashboardPdfOk,
    scenario7_dashboardPdfNotReady,
    scenario8_dashboardPdfOtherUser,
    scenario9_dashboardGetFlags,
    scenario10_decksView,
    scenario11_decksOcrOk,
    scenario12_decksNoToken,
    scenario13_cleanup,
  ];

  for (const step of steps) {
    try {
      await step();
    } catch (err) {
      record(step.name, false, `threw: ${err.message}`);
    }
  }

  await app.close();

  const elapsed = (performance.now() - t0).toFixed(0);
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  const color = passed === total ? GREEN : RED;
  console.log(`\n${color}${passed}/${total} passed${RST} in ${elapsed}ms\n`);

  if (passed < total) {
    const failed = results.filter((r) => !r.passed);
    console.log(`${YEL}Failed scenarios:${RST}`);
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
    console.log();
  }

  process.exit(passed === total ? 0 : 1);
}

// Top-level await handler + force-exit si Fastify laisse un handle pendant.
main().catch((err) => {
  console.error('\n[FATAL] Smoke test threw:', err);
  process.exit(1);
});
