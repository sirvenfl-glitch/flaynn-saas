import { z } from 'zod';
import { pool } from '../config/db.js';
import { getSignedGetUrl } from '../lib/r2-storage.js';

const idSchema = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/);

// ARCHITECT-PRIME: Delta 13 — guard unique pour pdf_report_storage + pitch_deck_storage.
// Les anciens dossiers (base64 JSONB) n'ont pas ce champ → has_* = false, cohérent avec
// la décision "zéro migration des vieux PDFs" du brief.
function isR2Storage(v) {
  return !!v && typeof v === 'object' && v.kind === 'r2' && typeof v.key === 'string' && v.key.length > 0;
}

/**
 * Transforme le cardPayload n8n V2 en format dashboard frontend.
 *
 * Exploite : pillar_analysis (insights), score_breakdown (raw),
 *            payload (concurrents, TAM, form data), previousScore (trend chips)
 */
function adaptN8nToDashboard(raw, startupName, referenceId, createdAt, previousData) {
  if (Array.isArray(raw.pillars)) return raw;

  if (raw.status === 'pending_analysis' || raw.status === 'pending_webhook' || raw.status === 'error') {
    return raw;
  }

  // Safety: si le scoring est "completed" mais sans données exploitables, traiter comme pending
  if (raw.status === 'completed' && !raw.score && !raw.overall_score && !raw.score_breakdown) {
    return { ...raw, status: 'error', error_message: 'Scoring reçu sans données exploitables.' };
  }

  const score = Number(raw.score) || Number(raw.overall_score) || 0;
  const prev = previousData || {};
  const prevScore = Number(prev.score) || Number(prev.overall_score) || score;
  const pa = raw.pillar_analysis || {};

  // Insight par pilier depuis pillar_analysis.strengths[0] + improvements[0]
  function pillarInsight(key) {
    const p = pa[key];
    if (!p) return '';
    const s = (p.strengths && p.strengths[0]) || '';
    const i = (p.improvements && p.improvements[0]) || '';
    if (s && i) return `${s}. ${i}`;
    return s || i || '';
  }

  const pillars = [
    { name: 'Market',    score: Number(raw.score_breakdown?.market)           || Number(raw.market_score) || 0,           prev: Number(prev.score_breakdown?.market)           || Number(prev.market_score)           || 0, color: 'var(--accent-violet)',  insight: pillarInsight('market') },
    { name: 'Product',   score: Number(raw.score_breakdown?.solution_product) || Number(raw.venture_score) || 0,          prev: Number(prev.score_breakdown?.solution_product) || Number(prev.venture_score)          || 0, color: 'var(--accent-blue)',    insight: pillarInsight('solution_product') },
    { name: 'Traction',  score: Number(raw.score_breakdown?.traction)         || Number(raw.traction_signal_score) || 0,  prev: Number(prev.score_breakdown?.traction)         || Number(prev.traction_signal_score)  || 0, color: 'var(--accent-emerald)', insight: pillarInsight('traction') },
    { name: 'Team',      score: Number(raw.score_breakdown?.team)             || Number(raw.team_score) || 0,             prev: Number(prev.score_breakdown?.team)             || Number(prev.team_score)             || 0, color: 'var(--accent-violet)',  insight: pillarInsight('team') },
    { name: 'Execution', score: Number(raw.score_breakdown?.execution_ask)    || Number(raw.execution_score) || 0,        prev: Number(prev.score_breakdown?.execution_ask)    || Number(prev.execution_score)        || 0, color: 'var(--accent-amber)',   insight: pillarInsight('execution_ask') },
  ];

  // Verdict → level
  const verdictLabels = {
    'Ready':   'Investissable',
    'Almost':  'Potentiel Élevé',
    'Not yet': 'Prématuré',
  };
  const actionLabels = {
    high_priority: 'Priorité Haute',
    meeting:       'Meeting Programmé',
    monitor:       'À Suivre',
    soft_pass:     'Pass Conditionnel',
    pass:          'Pass',
  };
  const level = verdictLabels[raw.verdict] || actionLabels[raw.recommended_action] || 'Non évalué';

  // Recommendations
  const priorities = raw.next_submission_priorities || [];
  const recommendations = priorities.map((p, i) => ({
    priority: i < 2 ? 'high' : 'medium',
    pillar: 'Priorité',
    title: p.title || `Priorité ${i + 1}`,
    desc: p.text || '',
  }));

  // Investor readiness
  const strengths = raw.top_3_strengths || [];
  const risks = raw.top_3_risks || [];
  const investorReadiness = [
    ...strengths.map(s => ({ status: 'ok', label: s })),
    ...risks.map(r => ({ status: 'warn', label: r })),
  ];

  // Graphe concurrentiel depuis payload.concurrents
  const payload = raw.payload || {};
  const graphNodes = [{ id: 'you', label: startupName || 'Vous', type: 'user' }];
  const graphLinks = [];
  const concurrentsRaw = payload.concurrents || '';
  if (concurrentsRaw) {
    const parts = concurrentsRaw.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean).slice(0, 5);
    parts.forEach((name, i) => {
      const id = `c${i}`;
      graphNodes.push({ id, label: name, type: 'competitor' });
      graphLinks.push({ source: 'you', target: id, strength: 1.2 - i * 0.15 });
    });
  }

  // Historique (audit actuel + précédent si existe)
  const history = [];
  if (previousData) {
    history.push({
      label: 'Audit précédent',
      date: new Date(prev.generated_at || createdAt).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }),
      score: prevScore,
    });
  }
  history.push({
    label: previousData ? 'Audit actuel' : 'Audit #1',
    date: new Date(raw.generated_at || createdAt || Date.now()).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }),
    score,
  });

  // TAM
  const tamRaw = payload.tam_usd || payload.tam || '';
  const tam = tamRaw ? (typeof tamRaw === 'number' ? `$${(tamRaw / 1e6).toFixed(0)}M` : String(tamRaw)) : '—';

  return {
    status: raw.status || 'completed',
    score,
    scorePrev: prevScore,
    level,
    verdict: raw.verdict || '',
    track: raw.track || '',
    track_reason: raw.track_reason || '',
    stage: raw.stage_estimate || payload.stade || 'Pre-seed',
    sector: raw.sector || payload.secteur || 'Startup',
    updatedAt: raw.generated_at || createdAt || new Date().toISOString(),
    pillars,
    resume_executif: raw.resume_executif || raw.one_liner || '',
    score_context: raw.score_context || '',
    confidence_level: raw.confidence_level || '',
    resubmission_intro: raw.resubmission_intro || '',
    resubmission_condition: raw.resubmission_condition || '',
    recommended_resubmission_date: raw.recommended_resubmission_date || '',
    recommended_resubmission_window: raw.recommended_resubmission_window || '',
    progression_goal: raw.progression_goal || '',
    next_action_founder_title: raw.next_action_founder_title || '',
    next_action_founder_why: raw.next_action_founder_why || '',
    questions_for_founder_call: raw.questions_for_founder_call || [],
    history,
    recommendations,
    investorReadiness,
    market: { tam, sam: '—', som: '—' },
    graph: { nodes: graphNodes, links: graphLinks },
  };
}

export default async function dashboardApiRoutes(fastify) {
  // Route 1 : Récupérer la liste des analyses d'un utilisateur
  fastify.get('/api/dashboard/list', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    try {
      const userEmail = request.user.email;
      const { rows } = await pool.query(
        'SELECT reference_id, startup_name, created_at FROM scores WHERE user_email = $1 ORDER BY created_at DESC',
        [userEmail]
      );
      return reply.code(200).send(rows);
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'Erreur lors de la récupération des analyses.' });
    }
  });

  // Route 2 : Récupérer une analyse spécifique par son ID
  fastify.get('/api/dashboard/:id', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const raw = request.params.id;
    const parsed = idSchema.safeParse(raw);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'INVALID_ID', message: 'Identifiant de dossier invalide.' });
    }

    try {
      const userEmail = request.user.email;
      const { rows } = await pool.query(
        'SELECT data, startup_name, created_at FROM scores WHERE reference_id = $1 AND user_email = $2',
        [parsed.data, userEmail]
      );

      if (rows.length === 0) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Analyse introuvable ou en cours de génération.' });
      }

      const data = rows[0].data || {};
      const {
        pdf_base64,           // legacy, ignored (ancien format pré-Delta 13)
        pitch_deck_base64,    // legacy, ignored (ancien format pré-Delta 13)
        pdf_report_storage,
        pitch_deck_storage,
        extra_docs,
        ...dataWithoutBlobs
      } = data;

      // Scoring précédent (trend chips) + card publique active (Delta 9 J6) en
      // parallèle. publicCard = null si aucune card active pour ce report.
      const startupName = rows[0].startup_name;
      const prevPromise = startupName
        ? pool.query(
            `SELECT data FROM scores
             WHERE user_email = $1 AND startup_name = $2 AND reference_id != $3
               AND data->>'status' = 'completed'
             ORDER BY created_at DESC LIMIT 1`,
            [userEmail, startupName, parsed.data]
          )
        : Promise.resolve({ rows: [] });
      const publicCardPromise = pool.query(
        `SELECT id, slug, view_count, created_at, og_image_path
         FROM public_cards
         WHERE reference_id = $1 AND user_email = $2 AND is_active = TRUE
         ORDER BY created_at DESC LIMIT 1`,
        [parsed.data, userEmail]
      );
      const [prevResult, publicCardResult] = await Promise.all([prevPromise, publicCardPromise]);

      const previousData = prevResult.rows.length > 0 ? prevResult.rows[0].data : null;

      let publicCard = null;
      if (publicCardResult.rows.length > 0) {
        const c = publicCardResult.rows[0];
        const baseUrl = process.env.APP_URL || 'https://flaynn.io';
        publicCard = {
          card_id: c.id,
          slug: c.slug,
          url: `${baseUrl}/score/${c.slug}`,
          view_count: c.view_count,
          created_at: c.created_at,
          og_pending: !c.og_image_path
        };
      }

      const adapted = adaptN8nToDashboard(dataWithoutBlobs, startupName, parsed.data, rows[0].created_at, previousData);
      return reply.code(200).send({
        id: parsed.data,
        startupName,
        has_pdf: isR2Storage(pdf_report_storage),
        has_pitch_deck: isR2Storage(pitch_deck_storage),
        ...adapted,
        publicCard
      });
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'Erreur serveur.' });
    }
  });

  // Route 3 : Telecharger le PDF du rapport
  fastify.get('/api/dashboard/:id/pdf', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const raw = request.params.id;
    const parsed = idSchema.safeParse(raw);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'INVALID_ID', message: 'Identifiant invalide.' });
    }

    try {
      const userEmail = request.user.email;
      const { rows } = await pool.query(
        "SELECT data->'pdf_report_storage' as storage FROM scores WHERE reference_id = $1 AND user_email = $2",
        [parsed.data, userEmail]
      );

      // 404 si row inexistant OU appartient à un autre user (ownership dans WHERE → pas de leak).
      if (rows.length === 0) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Dossier introuvable.' });
      }

      // Row existe mais storage absent/malformé : rapport n8n pas encore reçu, ou legacy pré-Delta 13.
      // Message UX distinct pour ne pas prêter à confusion avec un 404 "dossier introuvable".
      const storage = rows[0].storage;
      if (!isR2Storage(storage)) {
        return reply.code(404).send({
          error: 'PDF_NOT_READY',
          message: 'Le PDF n\'est pas encore disponible. Réessayez dans quelques instants.',
        });
      }

      // TTL 300s : vue dashboard humaine, le browser ouvre le PDF immédiatement.
      const url = await getSignedGetUrl(storage.key, 300);
      return reply.redirect(url, 302);
    } catch (err) {
      request.log.error({ err, id: parsed.data }, 'dashboard_pdf_redirect_failed');
      return reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'Erreur serveur.' });
    }
  });

  // Route 4 : Statut d'un scoring par référence (pour la page succès, sans auth)
  // Retourne uniquement le statut, pas les données complètes (sécurité)
  fastify.get('/api/scoring/status/:ref', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const ref = request.params.ref;
    if (!ref || ref.length > 64 || !/^FLY-[A-F0-9]+$/i.test(ref)) {
      return reply.code(400).send({ error: 'INVALID_REF' });
    }
    try {
      const { rows } = await pool.query(
        "SELECT data->>'status' as status FROM scores WHERE reference_id = $1",
        [ref]
      );
      if (rows.length === 0) {
        return reply.code(404).send({ error: 'NOT_FOUND' });
      }
      return reply.send({
        reference: ref,
        status: rows[0].status || 'unknown',
      });
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ error: 'INTERNAL_ERROR' });
    }
  });
}