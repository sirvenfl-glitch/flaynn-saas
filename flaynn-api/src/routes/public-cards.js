import { z } from 'zod';
import { pool } from '../config/db.js';
import { generateUniqueSlug } from '../lib/slug.js';

// ARCHITECT-PRIME — Delta 9 step 1 : route SSR publique /score/:slug (stub).
// Le rendu HTML est minimal et vérifiable via curl. Le CSS complet (J5) et le JS
// de partage (J6) s'ajouteront par-dessus sans casser l'API de rendu.
//
// Sécurité — toute valeur dynamique injectée dans le HTML passe par escapeHtml().
// La route ne produit AUCUN script inline (CSP script-src 'self' respectée).
// JSON-LD volontairement omis en J1 : le traitement CSP (hash SHA-256 par card
// ou nonce) est tranché en J4.

const ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);
}

// Slug format garant : [a-z0-9-]{1,80}. Valide à la fois côté entrée URL et côté
// lecture DB (cohérent avec la contrainte implicite de slugify()).
const SLUG_RE = /^[a-z0-9-]{1,80}$/;

function isValidSlug(slug) {
  return typeof slug === 'string' && SLUG_RE.test(slug);
}

// Delta 9 §11 + décision C : verdicts publiables. 'Not yet' (et absent) exclus.
const PUBLISHABLE_VERDICTS = new Set(['Ready', 'Almost', 'Yes', 'Strong Yes']);

// Schémas de validation des params de route.
const referenceIdSchema = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/);
const cardIdSchema = z.coerce.number().int().positive().max(2_147_483_647);

// Extrait le snapshot figé à partir du payload n8n stocké dans scores.data.
// Invariant : clés EN conservées côté DB (décision E). Les labels FR restent
// côté rendu (J5). Si un champ manque, fallback documenté sur alias legacy.
function buildSnapshotFromScoreData(data) {
  const payload = data?.payload || {};
  const breakdown = data?.score_breakdown || {};

  const score = Number(data?.score ?? data?.overall_score ?? 0);
  const forces = Array.isArray(data?.top_3_strengths)
    ? data.top_3_strengths.filter((s) => typeof s === 'string' && s.trim().length > 0)
    : [];
  const challenges = Array.isArray(data?.top_3_risks)
    ? data.top_3_risks.filter((c) => typeof c === 'string' && c.trim().length > 0)
    : [];

  const pillars = {
    market:           Number(breakdown.market           ?? data?.market_score           ?? 0),
    solution_product: Number(breakdown.solution_product ?? data?.venture_score          ?? 0),
    traction:         Number(breakdown.traction         ?? data?.traction_signal_score  ?? 0),
    team:             Number(breakdown.team             ?? data?.team_score             ?? 0),
    execution_ask:    Number(breakdown.execution_ask    ?? data?.execution_score        ?? 0)
  };

  return {
    score,
    verdict: data?.verdict || '',
    track: data?.track || '',
    track_reason: data?.track_reason || '',
    sector: data?.sector || payload.secteur || 'Startup',
    stage: data?.stage_estimate || payload.stade || '',
    forces: forces.slice(0, 3),
    challenges: challenges.slice(0, 3),
    pillars,
    confidence_level: data?.confidence_level || '',
    methodology_version: data?.methodology_version || '',
    scored_at: data?.generated_at || null
  };
}

// Décision D : noindex si verdict = 'Almost' ET score < 70.
function computeIndexSeo(snapshot) {
  if (snapshot.verdict === 'Almost' && snapshot.score < 70) return false;
  return true;
}

function buildPublishResponse(card, snapshot) {
  const baseUrl = getPublicBaseUrl();
  return {
    card_id: card.id,
    slug: card.slug,
    url: `${baseUrl}/score/${card.slug}`,
    og_url: `${baseUrl}/og/${card.slug}.png`,
    og_pending: !card.og_image_path,
    index_seo: card.index_seo,
    created_at: card.created_at,
    snapshot: {
      score: snapshot.score,
      verdict: snapshot.verdict
    }
  };
}

function getPublicBaseUrl() {
  return process.env.APP_URL || 'https://flaynn.tech';
}

function getBaJoinUrl() {
  const base = process.env.BA_PUBLIC_BASE_URL || 'https://flaynn.com';
  return `${base}/rejoindre`;
}

function formatFrDate(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function renderNotFoundPage() {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>Flaynn · Carte introuvable</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/defaut.css">
</head>
<body class="dashboard-body">
<main style="max-width:720px;margin:96px auto;padding:48px 24px;text-align:center">
  <h1 style="font-size:48px;margin:0 0 16px">Carte introuvable</h1>
  <p style="color:var(--text-secondary);margin:0 0 32px">
    Cette Flaynn Card n'existe pas ou n'a jamais été publiée.
  </p>
  <a href="/" style="color:var(--accent-violet);text-decoration:none;font-weight:600">← Retour à l'accueil Flaynn</a>
</main>
</body>
</html>`;
}

function renderUnpublishedPage() {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>Flaynn · Carte dépubliée</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/defaut.css">
</head>
<body class="dashboard-body">
<main style="max-width:720px;margin:96px auto;padding:48px 24px;text-align:center">
  <h1 style="font-size:48px;margin:0 0 16px">Carte dépubliée</h1>
  <p style="color:var(--text-secondary);margin:0 0 32px">
    Cette Flaynn Card a été dépubliée par son fondateur.
  </p>
  <a href="/" style="color:var(--accent-violet);text-decoration:none;font-weight:600">← Retour à l'accueil Flaynn</a>
</main>
</body>
</html>`;
}

function renderCardPage(card) {
  const baseUrl = getPublicBaseUrl();
  const baJoinUrl = getBaJoinUrl();
  const snapshot = card.snapshot_data || {};

  const startupName = card.startup_name || 'Startup';
  const score = Number(snapshot.score) || 0;
  const verdict = snapshot.verdict || '';
  const sector = snapshot.sector || 'Startup';
  const track = snapshot.track || '';
  const methodology = snapshot.methodology_version || '';
  const scoredAtIso = snapshot.scored_at || card.created_at;
  const scoredAtFr = formatFrDate(scoredAtIso);

  const forces = Array.isArray(snapshot.forces) ? snapshot.forces.slice(0, 3) : [];
  const challenges = Array.isArray(snapshot.challenges) ? snapshot.challenges.slice(0, 3) : [];

  const pageUrl = `${baseUrl}/score/${card.slug}`;
  const ogImage = card.og_image_path
    ? `${baseUrl}${card.og_image_path}`
    : `${baseUrl}/og-image.png`; // placeholder existant public/og-image.png jusqu'à J3

  const title = `${startupName} · Flaynn Score ${score}/100`;
  const firstChallenge = challenges[0] || '';
  const description = `${startupName} a été scorée ${score}/100 par Flaynn Intelligence. ` +
    `Verdict : ${verdict || '—'}. Secteur : ${sector}. ` +
    (firstChallenge ? `Zone à renforcer : ${firstChallenge}` : 'Analyse en 5 piliers.');

  const robotsTag = card.index_seo
    ? ''
    : '<meta name="robots" content="noindex, nofollow">';

  const forcesHtml = forces.length
    ? `<ol>${forces.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ol>`
    : '<p style="color:var(--text-secondary)">Aucune force listée.</p>';

  const challengesHtml = challenges.length
    ? `<ol>${challenges.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ol>`
    : '<p style="color:var(--text-secondary)">Aucune zone listée.</p>';

  const metaLine = [sector, track, scoredAtFr ? `Scoré le ${scoredAtFr}` : '']
    .filter(Boolean)
    .map(escapeHtml)
    .join(' · ');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
${robotsTag}

<meta property="og:type" content="article">
<meta property="og:url" content="${escapeHtml(pageUrl)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="${escapeHtml(ogImage)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:site_name" content="Flaynn">
<meta property="og:locale" content="fr_FR">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${escapeHtml(ogImage)}">

<link rel="canonical" href="${escapeHtml(pageUrl)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/defaut.css">
</head>
<body class="dashboard-body">
<main style="max-width:920px;margin:0 auto;padding:48px 24px 96px">
  <header style="display:flex;justify-content:space-between;align-items:center;padding-bottom:32px;border-bottom:1px solid var(--border-default);margin-bottom:48px">
    <a href="/" style="font-weight:700;font-size:24px;letter-spacing:-0.02em;background:var(--gradient-violet-rose);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;text-decoration:none">FLAYNN</a>
    <span style="padding:8px 20px;border-radius:999px;font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--accent-emerald);border:1px solid var(--accent-emerald)">${escapeHtml(verdict)}</span>
  </header>

  <section style="margin-bottom:64px">
    <div style="font-size:13px;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-secondary);margin-bottom:16px">${metaLine}</div>
    <h1 style="font-size:clamp(40px,6vw,72px);font-weight:700;line-height:1.05;letter-spacing:-0.03em;margin:0 0 40px">${escapeHtml(startupName)}</h1>
    <div style="display:flex;align-items:baseline;gap:12px">
      <span style="font-size:14px;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-secondary);margin-right:8px">Flaynn Score</span>
      <span style="font-size:clamp(80px,12vw,160px);font-weight:700;line-height:1;letter-spacing:-0.05em">${score}</span>
      <span style="font-size:clamp(40px,6vw,80px);color:var(--text-secondary);font-weight:400">/100</span>
    </div>
  </section>

  <section style="margin-bottom:48px">
    <h2 style="font-size:18px;font-weight:700;margin:0 0 24px">✓ Trois forces identifiées</h2>
    ${forcesHtml}
  </section>

  <section style="margin-bottom:48px">
    <h2 style="font-size:18px;font-weight:700;margin:0 0 24px">⏳ Trois zones à renforcer</h2>
    ${challengesHtml}
  </section>

  ${methodology ? `<section style="margin-bottom:48px;color:var(--text-secondary);font-size:13px;letter-spacing:0.05em">Validé par l'analyste Flaynn · Méthodologie ${escapeHtml(methodology)}</section>` : ''}

  <section style="display:flex;flex-direction:column;gap:16px;margin-bottom:64px">
    <a href="/#scoring" style="padding:20px 32px;border-radius:12px;font-weight:700;text-align:center;font-size:17px;background:var(--gradient-violet-rose);color:#fff;text-decoration:none">Obtenir votre scoring · 29€</a>
    <a href="${escapeHtml(baJoinUrl)}" style="padding:14px 24px;border-radius:12px;font-weight:500;text-align:center;font-size:14px;border:1px solid var(--border-default);color:var(--text-primary);text-decoration:none;letter-spacing:0.02em">Vous êtes investisseur ? Rejoindre Flaynn →</a>
  </section>

  <footer style="padding-top:48px;border-top:1px solid var(--border-default);font-size:12px;color:var(--text-secondary);letter-spacing:0.08em;text-transform:uppercase">
    Flaynn · Infrastructure du capital sélectif francophone
  </footer>
</main>
</body>
</html>`;
}

export default async function publicCardsRoutes(fastify) {
  // ──────────────────────────────────────────────────────────────────────
  // POST /api/dashboard/:id/publish — publish a scoring as a public card.
  // :id = scores.reference_id (VARCHAR, pattern FLY-...).
  // Auth via fastify.authenticate (cookie flaynn_at / flaynn_rt).
  // ──────────────────────────────────────────────────────────────────────
  fastify.post('/api/dashboard/:id/publish', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const parsedId = referenceIdSchema.safeParse(request.params.id);
    if (!parsedId.success) {
      return reply.code(400).send({ error: 'INVALID_ID', message: 'Identifiant de dossier invalide.' });
    }
    const referenceId = parsedId.data;
    const userEmail = request.user.email;

    try {
      // 1) Charger le scoring de l'utilisateur — filter par user_email = ownership
      //    (même pattern que /api/dashboard/:id — pas de 403 distinct pour éviter
      //     la divulgation d'existence de référence).
      const scoreResult = await pool.query(
        `SELECT reference_id, startup_name, data, created_at
         FROM scores WHERE reference_id = $1 AND user_email = $2 LIMIT 1`,
        [referenceId, userEmail]
      );
      if (scoreResult.rows.length === 0) {
        return reply.code(404).send({ error: 'REPORT_NOT_FOUND', message: 'Dossier introuvable.' });
      }
      const scoreRow = scoreResult.rows[0];
      const data = scoreRow.data || {};

      // 2) Idempotence : si une card active existe déjà pour ce report,
      //    on la retourne telle quelle au lieu de créer un doublon. On lit le
      //    snapshot figé de la card existante — PAS le live data — pour respecter
      //    l'invariant "snapshot figé au moment du publish initial".
      const existingActive = await pool.query(
        `SELECT id, slug, og_image_path, index_seo, created_at, snapshot_data
         FROM public_cards
         WHERE reference_id = $1 AND user_email = $2 AND is_active = TRUE
         LIMIT 1`,
        [referenceId, userEmail]
      );
      if (existingActive.rows.length > 0) {
        const existing = existingActive.rows[0];
        return reply.code(200).send({
          ...buildPublishResponse(existing, existing.snapshot_data || {}),
          already_published: true
        });
      }

      // 3) Gating verdict (décision C : 'Not yet' et absent exclus).
      const verdict = data.verdict;
      if (!PUBLISHABLE_VERDICTS.has(verdict)) {
        return reply.code(403).send({
          error: 'NOT_PUBLIC_ELIGIBLE',
          message: "Votre verdict ne permet pas de publier une carte publique."
        });
      }

      // 4) Gating contenu (décision F : 3 forces + 3 challenges requis).
      const snapshot = buildSnapshotFromScoreData(data);
      if (snapshot.forces.length < 3 || snapshot.challenges.length < 3) {
        return reply.code(403).send({
          error: 'INSUFFICIENT_CONTENT',
          message: 'Complétez votre report : 3 forces et 3 zones à renforcer sont nécessaires pour publier.'
        });
      }

      // 5) Nom de startup — obligatoire pour bâtir le slug et l'affichage public.
      const startupName = scoreRow.startup_name || '';
      if (!startupName.trim()) {
        return reply.code(403).send({
          error: 'MISSING_STARTUP_NAME',
          message: 'Votre dossier n\'a pas de nom de startup — impossible de publier.'
        });
      }

      // 6) Slug unique + index_seo selon règle D.
      let slug;
      try {
        slug = await generateUniqueSlug(startupName, pool);
      } catch (err) {
        request.log.error({ err, referenceId }, 'slug_generation_failed');
        return reply.code(500).send({
          error: 'SLUG_GENERATION_FAILED',
          message: 'Erreur temporaire lors de la création de votre lien public. Réessayez.'
        });
      }
      const indexSeo = computeIndexSeo(snapshot);

      // 7) INSERT. og_image_path reste NULL en J2 — rempli en J3 par le render Satori.
      const insertResult = await pool.query(
        `INSERT INTO public_cards
           (slug, reference_id, user_email, startup_name, snapshot_data, og_image_path,
            is_active, index_seo)
         VALUES ($1, $2, $3, $4, $5::jsonb, NULL, TRUE, $6)
         RETURNING id, slug, og_image_path, index_seo, created_at`,
        [slug, referenceId, userEmail, startupName, JSON.stringify(snapshot), indexSeo]
      );
      const card = insertResult.rows[0];

      request.log.info(
        { cardId: card.id, slug: card.slug, referenceId, indexSeo },
        'public_card_published'
      );

      return reply.code(201).send({
        ...buildPublishResponse(card, snapshot),
        already_published: false
      });
    } catch (err) {
      request.log.error({ err, referenceId }, 'public_card_publish_failed');
      return reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'Erreur serveur.' });
    }
  });

  // ──────────────────────────────────────────────────────────────────────
  // DELETE /api/dashboard/:id/publish/:cardId — soft-delete (unpublish).
  // Idempotent : si la card est déjà inactive, renvoie 200 avec l'état courant.
  // ──────────────────────────────────────────────────────────────────────
  fastify.delete('/api/dashboard/:id/publish/:cardId', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const parsedId = referenceIdSchema.safeParse(request.params.id);
    if (!parsedId.success) {
      return reply.code(400).send({ error: 'INVALID_ID', message: 'Identifiant de dossier invalide.' });
    }
    const parsedCardId = cardIdSchema.safeParse(request.params.cardId);
    if (!parsedCardId.success) {
      return reply.code(400).send({ error: 'INVALID_CARD_ID', message: 'Identifiant de carte invalide.' });
    }
    const referenceId = parsedId.data;
    const cardId = parsedCardId.data;
    const userEmail = request.user.email;

    try {
      // Ownership : filtre par user_email ET reference_id (le couple doit matcher).
      const { rows } = await pool.query(
        `SELECT id, is_active, unpublished_at
         FROM public_cards
         WHERE id = $1 AND reference_id = $2 AND user_email = $3
         LIMIT 1`,
        [cardId, referenceId, userEmail]
      );
      if (rows.length === 0) {
        return reply.code(404).send({ error: 'CARD_NOT_FOUND', message: 'Carte introuvable.' });
      }
      const current = rows[0];

      // Idempotent : déjà dépubliée → pas de mutation, on renvoie l'état courant.
      if (!current.is_active) {
        return reply.code(200).send({
          card_id: current.id,
          unpublished_at: current.unpublished_at,
          already_unpublished: true
        });
      }

      const updateResult = await pool.query(
        `UPDATE public_cards
         SET is_active = FALSE, unpublished_at = NOW()
         WHERE id = $1
         RETURNING id, unpublished_at`,
        [cardId]
      );
      const updated = updateResult.rows[0];

      request.log.info({ cardId: updated.id, referenceId }, 'public_card_unpublished');

      return reply.code(200).send({
        card_id: updated.id,
        unpublished_at: updated.unpublished_at,
        already_unpublished: false
      });
    } catch (err) {
      request.log.error({ err, referenceId, cardId }, 'public_card_unpublish_failed');
      return reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'Erreur serveur.' });
    }
  });

  fastify.get('/score/:slug', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const { slug } = request.params;

    if (!isValidSlug(slug)) {
      return reply
        .code(404)
        .type('text/html; charset=utf-8')
        .send(renderNotFoundPage());
    }

    let card;
    try {
      const { rows } = await pool.query(
        `SELECT id, slug, reference_id, user_email, startup_name, snapshot_data,
                og_image_path, is_active, index_seo, view_count, created_at, unpublished_at
         FROM public_cards WHERE slug = $1 LIMIT 1`,
        [slug]
      );
      card = rows[0];
    } catch (err) {
      request.log.error({ err, slug }, 'public_card_lookup_failed');
      return reply
        .code(503)
        .type('text/html; charset=utf-8')
        .send(renderNotFoundPage());
    }

    if (!card) {
      return reply
        .code(404)
        .type('text/html; charset=utf-8')
        .send(renderNotFoundPage());
    }

    if (!card.is_active) {
      return reply
        .code(410)
        .type('text/html; charset=utf-8')
        .send(renderUnpublishedPage());
    }

    // Incrément view_count fire-and-forget — ne bloque pas la réponse.
    pool.query(
      'UPDATE public_cards SET view_count = view_count + 1 WHERE id = $1',
      [card.id]
    ).catch((err) => {
      request.log.warn({ err, cardId: card.id }, 'public_card_view_count_failed');
    });

    return reply
      .code(200)
      .type('text/html; charset=utf-8')
      .header('Cache-Control', 'public, max-age=300, stale-while-revalidate=600')
      .send(renderCardPage(card));
  });
}
