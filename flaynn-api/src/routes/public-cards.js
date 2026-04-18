import { z } from 'zod';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pool } from '../config/db.js';
import { generateUniqueSlug } from '../lib/slug.js';
import { renderOgImage, getOgOutputDir } from '../lib/og-render.js';
import { buildCspHeader } from '../config/security.js';

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

// Labels FR affichés pour les piliers — les clés EN restent côté DB (décision E).
// Ordre explicite = ordre d'affichage côté UI.
const PILLAR_ORDER = ['market', 'solution_product', 'traction', 'team', 'execution_ask'];
const PILLAR_LABELS_FR = {
  market: 'Marché',
  solution_product: 'Produit',
  traction: 'Traction',
  team: 'Équipe',
  execution_ask: 'Exécution'
};
const PILLAR_MAX = 20;

function verdictClass(verdict) {
  if (!verdict) return '';
  return verdict
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function buildPillarsHtml(pillars) {
  if (!pillars || typeof pillars !== 'object') return '';
  const items = PILLAR_ORDER.map((key) => {
    const raw = Number(pillars[key] ?? 0);
    const score = Number.isFinite(raw) ? raw : 0;
    // Barres normalisées sur PILLAR_MAX (20) par convention Flaynn. Clamp [0,100]%.
    const pct = Math.max(0, Math.min(100, (score / PILLAR_MAX) * 100));
    const label = PILLAR_LABELS_FR[key];
    return `
      <li class="score-card__pillar">
        <div class="score-card__pillar-head">
          <span class="score-card__pillar-name">${escapeHtml(label)}</span>
          <span class="score-card__pillar-score">${score}<span class="score-card__pillar-max">/${PILLAR_MAX}</span></span>
        </div>
        <div class="score-card__pillar-bar" role="progressbar" aria-valuenow="${score}" aria-valuemin="0" aria-valuemax="${PILLAR_MAX}" aria-label="${escapeHtml(label)}">
          <div class="score-card__pillar-fill" data-target="${pct.toFixed(0)}" style="width:${pct.toFixed(1)}%"></div>
        </div>
      </li>`;
  }).join('');
  return `
    <section class="score-card__pillars">
      <h2 class="score-card__section-title"><span class="score-card__section-icon">●</span> Scoring par pilier</h2>
      <ul class="score-card__pillars-list">${items}</ul>
    </section>`;
}

function buildShareUrls(pageUrl, title) {
  const u = encodeURIComponent(pageUrl);
  const t = encodeURIComponent(title);
  return {
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${u}`,
    x: `https://twitter.com/intent/tweet?url=${u}&text=${t}`,
    whatsapp: `https://wa.me/?text=${t}%20${u}`
  };
}

function renderMinimalPage(title, heading, message) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/defaut.css">
<link rel="stylesheet" href="/css/score-card.css">
</head>
<body class="score-card">
<main class="score-card__minimal">
  <h1>${escapeHtml(heading)}</h1>
  <p>${escapeHtml(message)}</p>
  <a href="/">← Retour à l'accueil Flaynn</a>
</main>
</body>
</html>`;
}

function renderNotFoundPage() {
  return renderMinimalPage(
    'Flaynn · Carte introuvable',
    'Carte introuvable',
    "Cette Flaynn Card n'existe pas ou n'a jamais été publiée."
  );
}

function renderUnpublishedPage() {
  return renderMinimalPage(
    'Flaynn · Carte dépubliée',
    'Carte dépubliée',
    'Cette Flaynn Card a été dépubliée par son fondateur.'
  );
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
    ? `<ol class="score-card__list">${forces.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ol>`
    : '<p class="score-card__empty">Aucune force listée.</p>';

  const challengesHtml = challenges.length
    ? `<ol class="score-card__list">${challenges.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ol>`
    : '<p class="score-card__empty">Aucune zone listée.</p>';

  const metaLine = [sector, track, scoredAtFr ? `Scoré le ${scoredAtFr}` : '']
    .filter(Boolean)
    .map(escapeHtml)
    .join(' · ');

  const pillarsHtml = buildPillarsHtml(snapshot.pillars);
  const shareUrls = buildShareUrls(pageUrl, title);
  const verdictCssClass = verdictClass(verdict);
  const methodologyUrl = '/manifesto';
  const founderSignupUrl = '/#scoring';

  // ARCHITECT-PRIME — Delta 9 J4 : JSON-LD structured data pour SEO (Article +
  // Review embeddé). Stable pour une card donnée : tous les champs proviennent
  // du snapshot figé + métadonnées immuables (slug, created_at).
  //
  // Le hash SHA-256 calculé ci-dessous est injecté dans le header CSP scoped
  // (script-src 'sha256-...'). Invariant CRITIQUE : le contenu hashé doit être
  // EXACTEMENT le texte entre <script type="application/ld+json"> et </script>
  // — aucun espace / newline ajouté côté template.
  const publishedIso = card.created_at instanceof Date
    ? card.created_at.toISOString()
    : new Date(card.created_at).toISOString();

  const jsonLdObject = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    description,
    datePublished: publishedIso,
    url: pageUrl,
    image: ogImage,
    author: {
      '@type': 'Organization',
      name: 'Flaynn Intelligence',
      url: baseUrl
    },
    publisher: {
      '@type': 'Organization',
      name: 'Flaynn',
      url: baseUrl
    },
    about: {
      '@type': 'Organization',
      name: startupName
    },
    review: {
      '@type': 'Review',
      reviewRating: {
        '@type': 'Rating',
        ratingValue: score,
        bestRating: 100,
        worstRating: 0
      },
      author: {
        '@type': 'Organization',
        name: 'Flaynn Intelligence'
      }
    }
  };
  const jsonLdContent = JSON.stringify(jsonLdObject);
  const jsonLdHash = 'sha256-' + createHash('sha256').update(jsonLdContent).digest('base64');

  const html = `<!DOCTYPE html>
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
<meta property="og:image:alt" content="${escapeHtml(`Flaynn Score ${score}/100 — ${startupName}`)}">
<meta property="og:site_name" content="Flaynn">
<meta property="og:locale" content="fr_FR">
<meta property="article:published_time" content="${escapeHtml(publishedIso)}">
<meta property="article:author" content="Flaynn Intelligence">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${escapeHtml(ogImage)}">
<meta name="twitter:image:alt" content="${escapeHtml(`Flaynn Score ${score}/100 — ${startupName}`)}">

<link rel="canonical" href="${escapeHtml(pageUrl)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/defaut.css">
<link rel="stylesheet" href="/css/score-card.css">
<script type="application/ld+json">${jsonLdContent}</script>
</head>
<body class="score-card">
<a class="score-card__skip" href="#main">Aller au contenu</a>
<canvas id="canvas-bg" class="score-card__starfield" aria-hidden="true"></canvas>
<main id="main" class="score-card__container">
  <header class="score-card__header">
    <a class="score-card__logo" href="/" aria-label="Flaynn — accueil">FLAYNN</a>
    ${verdict ? `<span class="score-card__verdict score-card__verdict--${escapeHtml(verdictCssClass)}">${escapeHtml(verdict)}</span>` : ''}
  </header>

  <section class="score-card__hero">
    ${metaLine ? `<p class="score-card__meta">${metaLine}</p>` : ''}
    <h1 class="score-card__title">${escapeHtml(startupName)}</h1>
    <div class="score-card__score">
      <span class="score-card__score-label">Flaynn Score</span>
      <span class="score-card__score-value">${score}</span>
      <span class="score-card__score-max">/100</span>
    </div>
  </section>

  ${pillarsHtml}

  <section class="score-card__block score-card__block--forces" aria-labelledby="forces-title">
    <h2 class="score-card__section-title" id="forces-title"><span class="score-card__section-icon">✓</span> Trois forces identifiées</h2>
    ${forcesHtml}
  </section>

  <section class="score-card__block score-card__block--challenges" aria-labelledby="challenges-title">
    <h2 class="score-card__section-title" id="challenges-title"><span class="score-card__section-icon">⏳</span> Trois zones à renforcer</h2>
    ${challengesHtml}
  </section>

  <section class="score-card__methodology">
    <span class="score-card__badge"><span class="score-card__badge-dot" aria-hidden="true"></span>${methodology ? `Validé par l'analyste Flaynn · Méthodologie ${escapeHtml(methodology)}` : "Validé par l'analyste Flaynn"}</span>
    <a class="score-card__methodology-link" href="${escapeHtml(methodologyUrl)}">Comprendre la méthodologie →</a>
  </section>

  <section class="score-card__ctas">
    <a class="score-card__cta score-card__cta--primary" href="${escapeHtml(founderSignupUrl)}">Obtenir votre scoring · 29€</a>
    <a class="score-card__cta score-card__cta--secondary" href="${escapeHtml(baJoinUrl)}">Vous êtes investisseur ? Rejoindre Flaynn →</a>
  </section>

  <footer class="score-card__footer">
    <div class="score-card__share">
      <button class="score-card__share-btn" type="button" data-action="copy-link" aria-label="Copier le lien de cette page">Copier le lien</button>
      <a class="score-card__share-btn" href="${escapeHtml(shareUrls.linkedin)}" target="_blank" rel="noopener">Partager sur LinkedIn</a>
      <a class="score-card__share-btn" href="${escapeHtml(shareUrls.x)}" target="_blank" rel="noopener">Partager sur X</a>
    </div>
    <p class="score-card__signature">Flaynn · Infrastructure du capital sélectif francophone</p>
  </footer>
</main>
<script src="/js/starfield.js" defer></script>
<script src="/js/score-card.js" defer></script>
</body>
</html>`;

  return { html, jsonLdHash };
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

      // 7) INSERT avec og_image_path = NULL. Render OG en étape 8.
      const insertResult = await pool.query(
        `INSERT INTO public_cards
           (slug, reference_id, user_email, startup_name, snapshot_data, og_image_path,
            is_active, index_seo)
         VALUES ($1, $2, $3, $4, $5::jsonb, NULL, TRUE, $6)
         RETURNING id, slug, og_image_path, index_seo, created_at`,
        [slug, referenceId, userEmail, startupName, JSON.stringify(snapshot), indexSeo]
      );
      let card = insertResult.rows[0];

      // 8) Render OG image. Échec non fatal : la row reste, og_image_path reste NULL,
      //    la route GET /og/:slug.png déclenchera un lazy re-render au premier hit.
      try {
        const ogPath = await renderOgImage(slug, snapshot, startupName);
        const updated = await pool.query(
          `UPDATE public_cards SET og_image_path = $1 WHERE id = $2
           RETURNING id, slug, og_image_path, index_seo, created_at`,
          [ogPath, card.id]
        );
        card = updated.rows[0];
      } catch (err) {
        request.log.error({ err, cardId: card.id, slug }, 'og_render_failed_on_publish');
        // card.og_image_path reste NULL → buildPublishResponse renvoie og_pending: true
      }

      request.log.info(
        { cardId: card.id, slug: card.slug, referenceId, indexSeo, ogPending: !card.og_image_path },
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

  // ──────────────────────────────────────────────────────────────────────
  // GET /og/:slug.png — PNG public 1200×630 pour les previews sociaux.
  // Enregistrée avant fastifyStatic (ordre dans server.js) → priorité sur la
  // serve statique du dossier public/og/.
  // Lazy re-render si le fichier est absent mais la card est active
  // (filesystem Render éphémère — cf. doc §5.4 dette acceptée v1).
  // ──────────────────────────────────────────────────────────────────────
  fastify.get('/og/:slug.png', {
    config: { rateLimit: { max: 300, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const { slug } = request.params;
    if (!isValidSlug(slug)) {
      return reply.code(404).type('text/plain; charset=utf-8').send('Not Found');
    }

    const ogDir = getOgOutputDir();
    const filePath = join(ogDir, `${slug}.png`);

    // 1) Tentative de lecture directe sur le disque.
    try {
      await stat(filePath);
      const buf = await readFile(filePath);
      return reply
        .code(200)
        .type('image/png')
        .header('Cache-Control', 'public, max-age=31536000, immutable')
        .send(buf);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        request.log.error({ err, slug }, 'og_disk_read_failed');
      }
    }

    // 2) Lazy re-render : charger la card, vérifier qu'elle est active,
    //    rendre le PNG, UPDATE og_image_path, servir le buffer.
    let card;
    try {
      const { rows } = await pool.query(
        `SELECT id, slug, startup_name, snapshot_data, is_active
         FROM public_cards WHERE slug = $1 LIMIT 1`,
        [slug]
      );
      card = rows[0];
    } catch (err) {
      request.log.error({ err, slug }, 'og_lookup_failed');
      return reply.code(503).type('text/plain; charset=utf-8').send('Service Unavailable');
    }

    if (!card) {
      return reply.code(404).type('text/plain; charset=utf-8').send('Not Found');
    }
    if (!card.is_active) {
      return reply.code(410).type('text/plain; charset=utf-8').send('Gone');
    }

    let buf;
    try {
      await renderOgImage(card.slug, card.snapshot_data || {}, card.startup_name);
      buf = await readFile(filePath);
    } catch (err) {
      request.log.error({ err, slug, cardId: card.id }, 'og_lazy_render_failed');
      return reply.code(500).type('text/plain; charset=utf-8').send('Render Failed');
    }

    // Best-effort UPDATE du chemin en DB (non-bloquant sur la réponse).
    pool.query(
      `UPDATE public_cards SET og_image_path = $1 WHERE id = $2 AND og_image_path IS NULL`,
      [`/og/${card.slug}.png`, card.id]
    ).catch((err) => {
      request.log.warn({ err, cardId: card.id }, 'og_path_update_failed');
    });

    return reply
      .code(200)
      .type('image/png')
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .send(buf);
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

    const { html, jsonLdHash } = renderCardPage(card);

    // CSP override scoped à cette réponse : on autorise le <script type=
    // "application/ld+json"> inline via son hash SHA-256 sans assouplir la
    // policy globale. reply.header() écrase la valeur posée par helmet plus tôt
    // dans la chaîne de hooks (Fastify : last-write-wins sur les headers).
    return reply
      .code(200)
      .type('text/html; charset=utf-8')
      .header('Cache-Control', 'public, max-age=300, stale-while-revalidate=600')
      .header('Content-Security-Policy', buildCspHeader([jsonLdHash]))
      .send(html);
  });

  // ──────────────────────────────────────────────────────────────────────
  // GET /score/:slug/ — redirection 301 vers la version canonique sans slash.
  // SEO hygiène : évite le dédoublement d'URLs indexées (doc §10.11).
  // ──────────────────────────────────────────────────────────────────────
  fastify.get('/score/:slug/', {
    config: { rateLimit: { max: 120, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const { slug } = request.params;
    if (!isValidSlug(slug)) {
      return reply
        .code(404)
        .type('text/html; charset=utf-8')
        .send(renderNotFoundPage());
    }
    return reply.code(301).redirect(`/score/${slug}`);
  });

  // ──────────────────────────────────────────────────────────────────────
  // GET /sitemap.xml — sitemap dynamique. Inclut la homepage + le dashboard
  // (legacy), PLUS toutes les cards is_active AND index_seo. Remplace le
  // fichier public/sitemap.xml statique (supprimé en J4).
  // Enregistré ici avant fastifyStatic dans server.js → priorité.
  // ──────────────────────────────────────────────────────────────────────
  fastify.get('/sitemap.xml', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const baseUrl = process.env.APP_URL || 'https://flaynn.tech';

    let cardRows = [];
    try {
      const result = await pool.query(
        `SELECT slug, created_at FROM public_cards
         WHERE is_active = TRUE AND index_seo = TRUE
         ORDER BY created_at DESC LIMIT 50000`
      );
      cardRows = result.rows;
    } catch (err) {
      request.log.error({ err }, 'sitemap_cards_query_failed');
      // En cas d'erreur DB on sert quand même la partie statique — les bots
      // retenteront et indexeront les cards plus tard.
    }

    const staticUrls = [
      { loc: `${baseUrl}/`,           changefreq: 'weekly',  priority: '1.0', lastmod: null },
      { loc: `${baseUrl}/dashboard/`, changefreq: 'weekly',  priority: '0.8', lastmod: null }
    ];

    const urlEntries = [];
    for (const u of staticUrls) {
      urlEntries.push(
        `  <url>\n    <loc>${u.loc}</loc>\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
      );
    }
    for (const c of cardRows) {
      const iso = c.created_at instanceof Date
        ? c.created_at.toISOString()
        : new Date(c.created_at).toISOString();
      urlEntries.push(
        `  <url>\n    <loc>${baseUrl}/score/${c.slug}</loc>\n    <lastmod>${iso}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>`
      );
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries.join('\n')}
</urlset>
`;

    return reply
      .code(200)
      .type('application/xml; charset=utf-8')
      .header('Cache-Control', 'public, max-age=3600')
      .send(xml);
  });
}
