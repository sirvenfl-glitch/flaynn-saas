// Delta 9 — smoke test end-to-end sans DB.
// Mocke pool.query (matcher sur patterns SQL), monte Fastify + helmet + routes,
// exécute 13 scénarios via fastify.inject(). Le render Satori tourne en vrai.
//
// Usage : node scripts/smoke-delta-9.mjs
// Sortie : exit 0 si tout passe, exit 1 sinon avec détails.

import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';

// Env minimal requis par envSchema de server.js + plugins.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://fake:fake@localhost:5432/fake';
process.env.JWT_SECRET = 'x'.repeat(32);
process.env.APP_URL = 'http://localhost';
process.env.BA_PUBLIC_BASE_URL = 'http://localhost';
process.env.PORT = '0';

const results = [];
const startOverall = Date.now();

function ok(name, detail = '') {
  results.push({ name, pass: true, detail });
  console.log(`  \x1b[32m✓\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`);
}
function fail(name, err) {
  results.push({ name, pass: false, error: err });
  console.log(`  \x1b[31m✗\x1b[0m ${name}\n    ${err?.message || err}`);
}

// ─── Mock DB state ────────────────────────────────────────────────────────
const state = {
  scores: [],        // {reference_id, user_email, startup_name, data, created_at}
  publicCards: [],   // {id, slug, reference_id, user_email, startup_name, snapshot_data,
                     //  og_image_path, is_active, index_seo, view_count, created_at, unpublished_at}
  nextCardId: 1
};

function matchScoreBySlug(slug) {
  return state.publicCards.find((c) => c.slug === slug);
}

async function mockQuery(sql, params = []) {
  const s = sql.replace(/\s+/g, ' ').trim().toLowerCase();

  // ── public_cards ───────────────────────────────────────────────────────
  // GET /score/:slug — full card lookup
  if (s.includes('from public_cards where slug =') && s.includes('view_count')) {
    const card = matchScoreBySlug(params[0]);
    return { rows: card ? [card] : [] };
  }

  // GET /og/:slug.png — lazy card lookup
  if (s.includes('from public_cards where slug =') && s.includes('snapshot_data') && !s.includes('view_count')) {
    const card = matchScoreBySlug(params[0]);
    if (!card) return { rows: [] };
    return { rows: [{
      id: card.id, slug: card.slug, startup_name: card.startup_name,
      snapshot_data: card.snapshot_data, is_active: card.is_active
    }] };
  }

  // view_count increment (fire-and-forget)
  if (s.startsWith('update public_cards set view_count = view_count + 1')) {
    const c = state.publicCards.find((x) => x.id === params[0]);
    if (c) c.view_count += 1;
    return { rows: [], rowCount: c ? 1 : 0 };
  }

  // lazy render UPDATE og_image_path (sans RETURNING, conditionnel IS NULL)
  if (s.startsWith('update public_cards set og_image_path =') && s.includes('og_image_path is null')) {
    const c = state.publicCards.find((x) => x.id === params[1] && !x.og_image_path);
    if (c) c.og_image_path = params[0];
    return { rows: [], rowCount: c ? 1 : 0 };
  }

  // UPDATE og_image_path RETURNING (après render OG dans publish)
  if (s.startsWith('update public_cards set og_image_path =') && s.includes('returning')) {
    const c = state.publicCards.find((x) => x.id === params[1]);
    if (c) c.og_image_path = params[0];
    return { rows: c ? [{
      id: c.id, slug: c.slug, og_image_path: c.og_image_path,
      index_seo: c.index_seo, created_at: c.created_at
    }] : [] };
  }

  // sitemap query
  if (s.includes('from public_cards where is_active = true and index_seo = true')) {
    const rows = state.publicCards
      .filter((c) => c.is_active && c.index_seo)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .map((c) => ({ slug: c.slug, created_at: c.created_at }));
    return { rows };
  }

  // Publish — idempotence check (lit le snapshot_data existant)
  if (s.includes('from public_cards where reference_id =') && s.includes('and is_active = true') && s.includes('snapshot_data')) {
    const c = state.publicCards.find(
      (x) => x.reference_id === params[0] && x.user_email === params[1] && x.is_active
    );
    if (!c) return { rows: [] };
    return { rows: [{
      id: c.id, slug: c.slug, og_image_path: c.og_image_path,
      index_seo: c.index_seo, created_at: c.created_at, snapshot_data: c.snapshot_data
    }] };
  }

  // Dashboard enrichissement publicCard (is_active = TRUE, pas de snapshot_data)
  if (s.includes('from public_cards where reference_id =') && s.includes('and is_active = true') && !s.includes('snapshot_data')) {
    const c = state.publicCards.find(
      (x) => x.reference_id === params[0] && x.user_email === params[1] && x.is_active
    );
    if (!c) return { rows: [] };
    return { rows: [{
      id: c.id, slug: c.slug, view_count: c.view_count,
      created_at: c.created_at, og_image_path: c.og_image_path
    }] };
  }

  // Slug uniqueness probe
  if (s.startsWith('select 1 from public_cards where slug =')) {
    const exists = !!matchScoreBySlug(params[0]);
    return { rows: exists ? [{ '?column?': 1 }] : [] };
  }

  // INSERT public_cards
  if (s.startsWith('insert into public_cards')) {
    const [p1, p2, p3, p4, p5_json, p6_indexSeo] = params;
    const snapshot_data = typeof p5_json === 'string' ? JSON.parse(p5_json) : p5_json;
    const card = {
      id: state.nextCardId++,
      slug: p1, reference_id: p2, user_email: p3, startup_name: p4,
      snapshot_data, og_image_path: null,
      is_active: true, index_seo: p6_indexSeo,
      view_count: 0, created_at: new Date(), unpublished_at: null
    };
    state.publicCards.push(card);
    return { rows: [{
      id: card.id, slug: card.slug, og_image_path: card.og_image_path,
      index_seo: card.index_seo, created_at: card.created_at
    }] };
  }

  // Unpublish — ownership check
  if (s.startsWith('select id, is_active, unpublished_at from public_cards where id =')) {
    const c = state.publicCards.find(
      (x) => x.id === params[0] && x.reference_id === params[1] && x.user_email === params[2]
    );
    return { rows: c ? [{ id: c.id, is_active: c.is_active, unpublished_at: c.unpublished_at }] : [] };
  }

  // Unpublish — mutation
  if (s.startsWith('update public_cards set is_active = false')) {
    const c = state.publicCards.find((x) => x.id === params[0]);
    if (c) { c.is_active = false; c.unpublished_at = new Date(); }
    return { rows: c ? [{ id: c.id, unpublished_at: c.unpublished_at }] : [] };
  }

  // ── scores ─────────────────────────────────────────────────────────────
  // Publish/dashboard — load score by reference_id + user_email
  // Deux variantes de SELECT (dashboard = `data, startup_name, created_at` ;
  // publish = `reference_id, startup_name, data, created_at`). WHERE identique.
  if (s.includes('from scores where reference_id = $1 and user_email = $2')) {
    const sc = state.scores.find((x) => x.reference_id === params[0] && x.user_email === params[1]);
    return { rows: sc ? [{
      reference_id: sc.reference_id, startup_name: sc.startup_name,
      data: sc.data, created_at: sc.created_at
    }] : [] };
  }

  // Dashboard prev-scoring query (pattern : WHERE user_email = $1 AND startup_name = $2 AND reference_id !=)
  if (s.includes('from scores where user_email = $1 and startup_name = $2 and reference_id !=')) {
    // Pas de scoring précédent dans nos fixtures → rows vides.
    return { rows: [] };
  }

  throw new Error(`mockQuery: SQL non géré → ${s.slice(0, 140)}`);
}

// ─── Setup Fastify ────────────────────────────────────────────────────────
const { pool } = await import('../src/config/db.js');
pool.query = mockQuery;  // monkey-patch avant import des routes

const Fastify = (await import('fastify')).default;
const helmet = (await import('@fastify/helmet')).default;
const { helmetConfig } = await import('../src/config/security.js');
const publicCardsRoutes = (await import('../src/routes/public-cards.js')).default;
const dashboardApiRoutes = (await import('../src/routes/dashboard-api.js')).default;
const { warmUpOgRender } = await import('../src/lib/og-render.js');

const fastify = Fastify({ logger: { level: 'error', transport: { target: 'pino-pretty' } } });
fastify.decorateRequest('user', null);
fastify.decorate('authenticate', async (request) => {
  request.user = { email: 'test@flaynn.tech', sub: '1' };
});
await fastify.register(helmet, helmetConfig);
await fastify.register(publicCardsRoutes);
await fastify.register(dashboardApiRoutes);
await fastify.ready();

// Warm-up pour éviter un cold path de ~1.5s sur la première génération OG.
console.log('\n[warm-up Satori]');
const warmMs = await warmUpOgRender();
console.log(`  warm-up ${warmMs} ms`);

// ─── Fixtures ─────────────────────────────────────────────────────────────
const USER_EMAIL = 'test@flaynn.tech';
const REF_READY = 'FLY-AAAA1111';
const REF_NOT_YET = 'FLY-BBBB2222';
const REF_SKINNY = 'FLY-CCCC3333';

state.scores.push({
  reference_id: REF_READY,
  user_email: USER_EMAIL,
  startup_name: 'Doctolib du Sport',
  created_at: new Date('2026-04-14T18:32:00Z'),
  data: {
    status: 'completed',
    verdict: 'Ready',
    score: 72,
    sector: 'SportTech',
    track: 'Seed Sprint',
    methodology_version: 'V5.0',
    generated_at: '2026-04-14T18:32:00Z',
    confidence_level: 'high',
    top_3_strengths: ['Marché B2C de 8 Md€', 'Équipe mixte dev/médical', 'LOI signée 3 fédérations'],
    top_3_risks: ['CA M12 optimiste', 'Pas de co-fondateur commercial', 'Dépendance brique IA'],
    score_breakdown: { market: 16, solution_product: 15, traction: 12, team: 14, execution_ask: 15 }
  }
});
state.scores.push({
  reference_id: REF_NOT_YET,
  user_email: USER_EMAIL,
  startup_name: 'StartupPas',
  created_at: new Date(),
  data: { status: 'completed', verdict: 'Not yet', score: 42, top_3_strengths: ['a','b','c'], top_3_risks: ['x','y','z'] }
});
state.scores.push({
  reference_id: REF_SKINNY,
  user_email: USER_EMAIL,
  startup_name: 'TooFew',
  created_at: new Date(),
  data: { status: 'completed', verdict: 'Ready', score: 80, top_3_strengths: ['only one'], top_3_risks: ['only one'] }
});

// ─── Tests ────────────────────────────────────────────────────────────────
console.log('\n[tests publish/unpublish]');

// Test 7: Not yet → 403
try {
  const r = await fastify.inject({ method: 'POST', url: `/api/dashboard/${REF_NOT_YET}/publish` });
  assert.equal(r.statusCode, 403);
  assert.equal(r.json().error, 'NOT_PUBLIC_ELIGIBLE');
  ok('POST publish Not yet → 403 NOT_PUBLIC_ELIGIBLE');
} catch (e) { fail('POST publish Not yet', e); }

// Test 8: <3 forces → 403
try {
  const r = await fastify.inject({ method: 'POST', url: `/api/dashboard/${REF_SKINNY}/publish` });
  assert.equal(r.statusCode, 403);
  assert.equal(r.json().error, 'INSUFFICIENT_CONTENT');
  ok('POST publish <3 forces → 403 INSUFFICIENT_CONTENT');
} catch (e) { fail('POST publish insufficient content', e); }

// Test 9: Ready → 201 avec og_pending: false
let publishedSlug;
let publishedCardId;
try {
  const r = await fastify.inject({ method: 'POST', url: `/api/dashboard/${REF_READY}/publish` });
  assert.equal(r.statusCode, 201);
  const body = r.json();
  assert.ok(body.slug && /^[a-z0-9-]+$/.test(body.slug));
  assert.ok(body.url.startsWith('http://localhost/score/'));
  assert.ok(body.og_url.startsWith('http://localhost/og/'));
  assert.equal(body.og_pending, false);
  assert.equal(body.index_seo, true);
  assert.equal(body.already_published, false);
  publishedSlug = body.slug;
  publishedCardId = body.card_id;
  ok(`POST publish Ready → 201 slug=${body.slug} og_pending=false`);
} catch (e) { fail('POST publish Ready', e); }

// Test 10: Republish same → 200 already_published
try {
  const r = await fastify.inject({ method: 'POST', url: `/api/dashboard/${REF_READY}/publish` });
  assert.equal(r.statusCode, 200);
  const body = r.json();
  assert.equal(body.already_published, true);
  assert.equal(body.slug, publishedSlug);
  ok('POST publish (2nd time) → 200 already_published: true, même slug');
} catch (e) { fail('POST publish idempotent', e); }

console.log('\n[tests GET /score/:slug]');

// Test 1: unknown slug → 404
try {
  const r = await fastify.inject({ method: 'GET', url: '/score/does-not-exist-1234' });
  assert.equal(r.statusCode, 404);
  assert.ok(r.headers['content-type'].startsWith('text/html'));
  assert.ok(r.body.includes('Carte introuvable'));
  ok('GET /score/<inconnu> → 404 HTML branded');
} catch (e) { fail('GET /score/ unknown', e); }

// Test 2: active → 200 + meta OG + JSON-LD + CSP hash
try {
  const r = await fastify.inject({ method: 'GET', url: `/score/${publishedSlug}` });
  assert.equal(r.statusCode, 200);
  assert.ok(r.body.includes('<meta property="og:image"'));
  assert.ok(r.body.includes('<meta property="article:published_time"'));
  assert.ok(r.body.includes('<script type="application/ld+json">'));
  assert.ok(r.body.includes('"@type":"Article"'));
  assert.ok(r.body.includes('<canvas id="canvas-bg"'));
  assert.ok(r.body.includes('/css/score-card.css'));
  const csp = r.headers['content-security-policy'];
  assert.ok(csp && csp.includes("'sha256-"), 'CSP doit contenir un hash sha256');
  // cache-control check
  assert.ok(r.headers['cache-control'].includes('max-age=300'));
  ok(`GET /score/${publishedSlug} → 200 HTML + CSP hash + JSON-LD`);
} catch (e) { fail('GET /score/ active', e); }

// Test 4: trailing slash → 301
try {
  const r = await fastify.inject({ method: 'GET', url: `/score/${publishedSlug}/` });
  assert.equal(r.statusCode, 301);
  assert.equal(r.headers.location, `/score/${publishedSlug}`);
  ok('GET /score/<slug>/ → 301 vers /score/<slug>');
} catch (e) { fail('GET /score/ trailing slash', e); }

console.log('\n[tests GET /og/:slug.png]');

// Test 5: card active → 200 image/png
try {
  const r = await fastify.inject({ method: 'GET', url: `/og/${publishedSlug}.png` });
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers['content-type'], 'image/png');
  assert.ok(r.headers['cache-control'].includes('immutable'));
  // PNG magic bytes
  const buf = r.rawPayload;
  assert.equal(buf[0], 0x89); assert.equal(buf[1], 0x50); // \x89PNG
  ok(`GET /og/${publishedSlug}.png → 200 image/png ${buf.length} bytes`);
} catch (e) { fail('GET /og/ active', e); }

console.log('\n[tests GET /sitemap.xml]');

// Test 6: sitemap inclut la card publiée
try {
  const r = await fastify.inject({ method: 'GET', url: '/sitemap.xml' });
  assert.equal(r.statusCode, 200);
  assert.ok(r.headers['content-type'].includes('application/xml'));
  assert.ok(r.body.includes('<loc>http://localhost/</loc>'));
  assert.ok(r.body.includes(`<loc>http://localhost/score/${publishedSlug}</loc>`));
  ok('GET /sitemap.xml → 200 contient homepage + card publiée');
} catch (e) { fail('GET /sitemap.xml', e); }

console.log('\n[tests GET /api/dashboard/:id (enrichissement publicCard)]');

// Test: Enrichissement API avec publicCard
try {
  const r = await fastify.inject({ method: 'GET', url: `/api/dashboard/${REF_READY}` });
  // l'endpoint existant attend un SQL précis — notre mock le gère
  assert.equal(r.statusCode, 200);
  const body = r.json();
  assert.ok(body.publicCard, 'publicCard doit être présent');
  assert.equal(body.publicCard.slug, publishedSlug);
  assert.equal(body.publicCard.url, `http://localhost/score/${publishedSlug}`);
  ok('GET /api/dashboard/:id enrichi avec publicCard');
} catch (e) { fail('GET /api/dashboard/:id enrichissement', e); }

console.log('\n[tests DELETE unpublish]');

// Test 11: DELETE → 200
try {
  const r = await fastify.inject({ method: 'DELETE', url: `/api/dashboard/${REF_READY}/publish/${publishedCardId}` });
  assert.equal(r.statusCode, 200);
  const body = r.json();
  assert.equal(body.already_unpublished, false);
  assert.ok(body.unpublished_at);
  ok('DELETE unpublish → 200 avec unpublished_at');
} catch (e) { fail('DELETE unpublish', e); }

// Test 3: GET /score/<slug> après unpublish → 410
try {
  const r = await fastify.inject({ method: 'GET', url: `/score/${publishedSlug}` });
  assert.equal(r.statusCode, 410);
  assert.ok(r.body.includes('dépubliée'));
  ok('GET /score/<slug> après unpublish → 410 HTML branded');
} catch (e) { fail('GET /score/ after unpublish', e); }

// Test 12: DELETE à nouveau → 200 already_unpublished
try {
  const r = await fastify.inject({ method: 'DELETE', url: `/api/dashboard/${REF_READY}/publish/${publishedCardId}` });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().already_unpublished, true);
  ok('DELETE unpublish (2nd time) → 200 already_unpublished: true');
} catch (e) { fail('DELETE unpublish idempotent', e); }

// Test 13: sitemap après unpublish — ne contient plus la card dépubliée
try {
  const r = await fastify.inject({ method: 'GET', url: '/sitemap.xml' });
  assert.equal(r.statusCode, 200);
  assert.ok(!r.body.includes(`/score/${publishedSlug}</loc>`));
  ok('GET /sitemap.xml après unpublish → card exclue');
} catch (e) { fail('GET /sitemap.xml after unpublish', e); }

// Cleanup : supprime le PNG OG généré sur disque
try {
  await rm(`./public/og/${publishedSlug}.png`, { force: true });
} catch {}

await fastify.close();

const failed = results.filter((r) => !r.pass);
const elapsed = Date.now() - startOverall;
console.log('\n' + '─'.repeat(60));
console.log(`Total : ${results.length - failed.length}/${results.length} passés en ${elapsed}ms`);
if (failed.length > 0) {
  console.log(`\n\x1b[31mÉchecs :\x1b[0m`);
  for (const f of failed) console.log(`  ✗ ${f.name}`);
  process.exit(1);
}
console.log('\n\x1b[32mTout passe ✓\x1b[0m');
process.exit(0);
