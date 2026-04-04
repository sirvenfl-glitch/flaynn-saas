/**
 * Flaynn Dashboard — app.js
 * Routeur vanilla, D3 (ESM), zero innerHTML pour le contenu dynamique.
 * Gestion auth localStorage : demo mode si non connecté.
 */

const D3_ESM = 'https://cdn.jsdelivr.net/npm/d3@7/+esm';
let d3Cache = null;
async function loadD3() {
  if (!d3Cache) d3Cache = await import(D3_ESM);
  return d3Cache;
}

/* ── Auth ──────────────────────────────────────────────────────────────── */
function getAuth() {
  try { return JSON.parse(localStorage.getItem('flaynn_auth') || 'null'); }
  catch { return null; }
}

function clearAuth() {
  localStorage.removeItem('flaynn_auth');
}

async function syncAuthFromSession() {
  try {
    const res = await fetch('/api/auth/session', { credentials: 'same-origin' });
    if (!res.ok) {
      clearAuth();
      return null;
    }
    const data = await res.json();
    localStorage.setItem('flaynn_auth', JSON.stringify(data.user));
    return data.user;
  } catch {
    return getAuth();
  }
}

/* ── Demo data ─────────────────────────────────────────────────────────── */
const DEMO_DATA = {
  isDemo: true,
  startupName: 'Exemple Startup',
  score: 74,
  scorePrev: 67,
  level: 'Potentiel Élevé',
  updatedAt: new Date().toISOString(),
  stage: 'Seed',
  sector: 'SaaS / B2B',
  pillars: [
    { name: 'Market',    score: 82, prev: 78, color: 'var(--accent-violet)',
      insight: 'TAM solide, positionnement différencié. Renforcer la défensibilité sur le segment mid-market.' },
    { name: 'Product',   score: 71, prev: 63, color: 'var(--accent-blue)',
      insight: 'MVP validé, proposition de valeur claire. Roadmap 12 mois à documenter pour rassurer les investisseurs.' },
    { name: 'Traction',  score: 68, prev: 56, color: 'var(--accent-emerald)',
      insight: 'Croissance MoM positive (+15%) mais churn élevé (8%). Priorité : réduire le churn sous 3%.' },
    { name: 'Team',      score: 85, prev: 83, color: 'var(--accent-violet)',
      insight: 'Équipe fondatrice complémentaire et expérimentée. Advisory board à structurer avant la levée.' },
    { name: 'Execution', score: 62, prev: 56, color: 'var(--accent-amber)',
      insight: 'Point faible identifié. Mettre en place des OKRs trimestriels et un reporting hebdomadaire structuré.' },
  ],
  history: [
    { label: 'Audit #1', date: 'Oct 2024', score: 52 },
    { label: 'Audit #2', date: 'Jan 2025', score: 67 },
    { label: 'Audit #3', date: 'Avr 2025', score: 74 },
  ],
  recommendations: [
    { priority: 'high',   pillar: 'Execution', title: 'Structurer la cadence opérationnelle',       desc: 'Mettre en place des OKRs trimestriels et un reporting hebdomadaire. Les investisseurs Série A exigent une rigueur process démontrée.' },
    { priority: 'high',   pillar: 'Traction',  title: 'Réduire le churn mensuel',                   desc: 'Churn actuel : 8% — objectif : < 3%. Identifier et adresser les 3 principales causes de résiliation en priorité.' },
    { priority: 'medium', pillar: 'Product',   title: 'Documenter la roadmap 12 mois',              desc: 'Manque de visibilité sur les prochaines releases. Ce point freine la confiance des investisseurs lors du premier call.' },
    { priority: 'low',    pillar: 'Team',      title: 'Structurer un advisory board',               desc: 'Ajouter 2–3 advisors sectoriels reconnus. Signal fort de crédibilité pour les investisseurs institutionnels.' },
  ],
  investorReadiness: [
    { status: 'ok',      label: 'Pitch deck à jour' },
    { status: 'ok',      label: 'Métriques financières documentées' },
    { status: 'warn',    label: 'Data room partielle — compléter' },
    { status: 'warn',    label: 'Prévisions 3 ans à affiner' },
    { status: 'missing', label: 'Cap table non communiquée' },
  ],
  market: { tam: '€2.4B', sam: '€340M', som: '€28M' },
  graph: {
    nodes: [
      { id: 'you',  label: 'Vous',        type: 'user' },
      { id: 'c1',   label: 'Concurrent A', type: 'competitor' },
      { id: 'c2',   label: 'Concurrent B', type: 'competitor' },
      { id: 'c3',   label: 'Concurrent C', type: 'competitor' },
      { id: 'p1',   label: 'Partenaire X', type: 'partner' },
      { id: 'p2',   label: 'Marché FR',    type: 'partner' },
    ],
    links: [
      { source: 'you', target: 'c1', strength: 1.5 },
      { source: 'you', target: 'c2', strength: 1.2 },
      { source: 'you', target: 'c3', strength: 0.9 },
      { source: 'you', target: 'p1', strength: 0.8 },
      { source: 'you', target: 'p2', strength: 0.6 },
      { source: 'c1',  target: 'c2', strength: 0.4 },
    ]
  }
};

/* ── DOM helpers ───────────────────────────────────────────────────────── */
function el(tag, className, attrs = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'textContent') node.textContent = v;
    else if (k === 'id') node.id = v;
    else node.setAttribute(k, v);
  }
  return node;
}

function clearEl(node) { node.replaceChildren(); }

let activeForceSimulation = null;
function stopForceSimulation() {
  if (activeForceSimulation) { activeForceSimulation.stop(); activeForceSimulation = null; }
}

/* ── Renderers D3 ──────────────────────────────────────────────────────── */

/** Score radial animé */
function renderScoreRadial(container, score, d3) {
  const size = 200, thick = 14, radius = (size - thick) / 2;
  const circ = 2 * Math.PI * radius;
  const stroke = score >= 70 ? 'var(--accent-emerald)' : score >= 40 ? 'var(--accent-amber)' : 'var(--accent-rose)';

  const svg = d3.select(container).append('svg')
    .attr('viewBox', `0 0 ${size} ${size}`)
    .attr('role', 'img')
    .attr('aria-label', `Score global ${score} sur 100`);

  svg.append('circle').attr('cx', size/2).attr('cy', size/2).attr('r', radius)
    .attr('fill', 'none').attr('stroke', 'var(--surface-overlay)').attr('stroke-width', thick);

  const arc = svg.append('circle').attr('cx', size/2).attr('cy', size/2).attr('r', radius)
    .attr('fill', 'none').attr('stroke', stroke).attr('stroke-width', thick)
    .attr('stroke-linecap', 'round')
    .attr('stroke-dasharray', circ).attr('stroke-dashoffset', circ)
    .attr('transform', `rotate(-90 ${size/2} ${size/2})`);

  arc.transition().duration(1400).ease(d3.easeCubicOut)
    .attr('stroke-dashoffset', circ - (score / 100) * circ);

  const scoreText = svg.append('text').attr('x', size/2).attr('y', size/2 - 6)
    .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
    .attr('class', 'score-radial__value').text('0');

  const subText = svg.append('text').attr('x', size/2).attr('y', size/2 + 22)
    .attr('text-anchor', 'middle').attr('font-size', '11').attr('fill', 'var(--text-tertiary)')
    .attr('font-family', 'var(--font-mono)').text('/100');

  d3.transition().duration(1400).ease(d3.easeCubicOut).tween('text', () => {
    const i = d3.interpolateNumber(0, score);
    return (t) => { scoreText.text(String(Math.round(i(t)))); };
  });

  void subText; /* silence lint */
}

/** Radar 5 piliers */
function renderPillarRadar(container, pillars, d3) {
  const size = 300, center = size / 2, maxR = 110;
  const angle = (i) => ((2 * Math.PI) / pillars.length) * i - Math.PI / 2;

  const svg = d3.select(container).append('svg')
    .attr('viewBox', `0 0 ${size} ${size}`)
    .attr('role', 'img')
    .attr('aria-label', 'Radar des cinq piliers de scoring');

  /* Grilles concentriques */
  for (let i = 1; i <= 5; i++) {
    svg.append('circle').attr('cx', center).attr('cy', center).attr('r', (maxR/5)*i)
      .attr('fill', 'none').attr('stroke', 'var(--border-subtle)').attr('stroke-dasharray', '3 3');
  }

  /* Axes + labels */
  pillars.forEach((p, i) => {
    const a = angle(i);
    const x = center + maxR * Math.cos(a), y = center + maxR * Math.sin(a);
    svg.append('line').attr('x1', center).attr('y1', center).attr('x2', x).attr('y2', y)
      .attr('stroke', 'var(--border-subtle)');
    svg.append('text')
      .attr('x', center + (maxR + 22) * Math.cos(a))
      .attr('y', center + (maxR + 22) * Math.sin(a))
      .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
      .attr('class', 'pillar-radar__label').text(p.name);
  });

  const pts = pillars.map((p, i) => {
    const a = angle(i), r = (p.score / 100) * maxR;
    return `${center + r * Math.cos(a)},${center + r * Math.sin(a)}`;
  }).join(' ');

  /* Zone remplie animée */
  const fill = svg.append('polygon')
    .attr('points', pillars.map(() => `${center},${center}`).join(' '))
    .attr('fill', 'rgba(139,92,246,0.15)').attr('stroke', 'var(--accent-violet)').attr('stroke-width', 2);

  fill.transition().duration(1000).ease(d3.easeCubicOut).attr('points', pts);

  /* Dots sur les sommets */
  pillars.forEach((p, i) => {
    const a = angle(i), r = (p.score / 100) * maxR;
    const dot = svg.append('circle')
      .attr('cx', center).attr('cy', center).attr('r', 4)
      .attr('fill', 'var(--accent-violet)').attr('stroke', 'var(--surface-void)').attr('stroke-width', 2);
    dot.transition().duration(1000).ease(d3.easeCubicOut)
      .attr('cx', center + r * Math.cos(a)).attr('cy', center + r * Math.sin(a));
  });
}

/** Historique des scores — ligne + aire gradient */
function renderScoreHistory(container, history, d3) {
  const w = Math.max(container.clientWidth || 360, 280);
  const h = 140;
  const m = { top: 12, right: 16, bottom: 32, left: 36 };

  const svg = d3.select(container).append('svg')
    .attr('viewBox', `0 0 ${w} ${h}`)
    .attr('role', 'img')
    .attr('aria-label', 'Historique des scores — ' + history.map(d => `${d.label} : ${d.score}`).join(', '));

  /* Dégradé sous la courbe */
  const defs = svg.append('defs');
  const grad = defs.append('linearGradient').attr('id', 'hist-grad')
    .attr('x1', '0%').attr('y1', '0%').attr('x2', '0%').attr('y2', '100%');
  grad.append('stop').attr('offset', '0%').attr('stop-color', 'var(--accent-violet)').attr('stop-opacity', 0.25);
  grad.append('stop').attr('offset', '100%').attr('stop-color', 'var(--accent-violet)').attr('stop-opacity', 0);

  const x = d3.scalePoint().range([m.left, w - m.right]).padding(0.4).domain(history.map(d => d.label));
  const y = d3.scaleLinear().range([h - m.bottom, m.top]).domain([0, 100]);

  /* Axe Y discret */
  [0, 25, 50, 75, 100].forEach(v => {
    svg.append('line')
      .attr('x1', m.left).attr('y1', y(v))
      .attr('x2', w - m.right).attr('y2', y(v))
      .attr('stroke', 'var(--border-subtle)').attr('stroke-dasharray', '3 3');
    svg.append('text').attr('x', m.left - 6).attr('y', y(v))
      .attr('text-anchor', 'end').attr('dominant-baseline', 'central')
      .attr('font-size', '9').attr('fill', 'var(--text-tertiary)').attr('font-family', 'var(--font-mono)')
      .text(v);
  });

  /* Axe X labels */
  history.forEach(d => {
    svg.append('text').attr('x', x(d.label)).attr('y', h - m.bottom + 14)
      .attr('text-anchor', 'middle').attr('font-size', '9').attr('fill', 'var(--text-tertiary)')
      .attr('font-family', 'var(--font-body)').text(d.label);
    svg.append('text').attr('x', x(d.label)).attr('y', h - m.bottom + 24)
      .attr('text-anchor', 'middle').attr('font-size', '8').attr('fill', 'var(--text-tertiary)')
      .attr('font-family', 'var(--font-body)').attr('opacity', 0.6).text(d.date);
  });

  const line = d3.line().x(d => x(d.label)).y(d => y(d.score)).curve(d3.curveCatmullRom);
  const area = d3.area().x(d => x(d.label)).y0(h - m.bottom).y1(d => y(d.score)).curve(d3.curveCatmullRom);

  /* Aire (opacité faible) */
  svg.append('path').datum(history).attr('fill', 'url(#hist-grad)').attr('d', area);

  /* Ligne principale animée */
  const path = svg.append('path').datum(history)
    .attr('fill', 'none').attr('stroke', 'var(--accent-violet)')
    .attr('stroke-width', 2).attr('stroke-linecap', 'round').attr('d', line);

  const totalLen = path.node().getTotalLength();
  path.attr('stroke-dasharray', totalLen).attr('stroke-dashoffset', totalLen)
    .transition().duration(1200).ease(d3.easeCubicOut).attr('stroke-dashoffset', 0);

  /* Points + valeurs */
  history.forEach(d => {
    const cx = x(d.label), cy = y(d.score);
    const dot = svg.append('circle').attr('cx', cx).attr('cy', h - m.bottom)
      .attr('r', 5).attr('fill', 'var(--accent-violet)')
      .attr('stroke', 'var(--surface-void)').attr('stroke-width', 2);
    dot.transition().delay(900).duration(400).ease(d3.easeBackOut).attr('cy', cy);

    const vText = svg.append('text').attr('x', cx).attr('y', h - m.bottom)
      .attr('text-anchor', 'middle').attr('font-size', '10').attr('font-weight', '700')
      .attr('fill', 'var(--text-primary)').attr('font-family', 'var(--font-mono)').text(d.score);
    vText.transition().delay(900).duration(400).attr('y', cy - 12);
  });
}

/** Graphe force-directed concurrentiel */
function renderCompetitiveGraph(container, data, d3) {
  stopForceSimulation();
  const w = Math.max(container.clientWidth || 400, 320), h = 420;
  const nodes = data.nodes.map(d => ({ ...d }));
  const links = data.links.map(d => ({ ...d }));

  const svg = d3.select(container).append('svg')
    .attr('viewBox', `0 0 ${w} ${h}`)
    .attr('role', 'img')
    .attr('aria-label', 'Graphe de marché — positionnement relatif concurrents et partenaires');

  const sim = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(d => d.id).distance(110))
    .force('charge', d3.forceManyBody().strength(-250))
    .force('center', d3.forceCenter(w/2, h/2))
    .force('collision', d3.forceCollide(46));

  const link = svg.selectAll('.link').data(links).enter().append('line')
    .attr('stroke', 'var(--border-default)')
    .attr('stroke-width', d => (d.strength ?? 1) * 1.8)
    .attr('stroke-opacity', 0.4);

  const node = svg.selectAll('.node').data(nodes).enter().append('g')
    .call(d3.drag()
      .on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.35).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag',  (e, d) => { d.fx = e.x; d.fy = e.y; })
      .on('end',   (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; })
    );

  node.append('circle')
    .attr('r', d => d.type === 'user' ? 22 : 14)
    .attr('fill', d => d.type === 'user' ? 'var(--accent-violet)' : d.type === 'competitor' ? 'var(--accent-rose)' : 'var(--accent-blue)')
    .attr('stroke', 'var(--surface-base)').attr('stroke-width', 2);

  node.append('text').text(d => d.label)
    .attr('dy', d => d.type === 'user' ? 35 : 27)
    .attr('text-anchor', 'middle').attr('class', 'graph-node__label');

  sim.on('tick', () => {
    link.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
    node.attr('transform', d => `translate(${d.x},${d.y})`);
  });

  activeForceSimulation = sim;
}

/* ── Builders DOM (zero innerHTML) ────────────────────────────────────── */

/** Bannière démo (non connecté) */
function buildDemoBanner() {
  const wrap = el('div', 'demo-banner');

  const text = el('div', 'demo-banner__text');
  const title = el('p', 'demo-banner__title', { textContent: 'Mode démo — données illustratives' });
  const sub = el('p', 'demo-banner__sub', {
    textContent: 'Connectez-vous ou créez un compte pour accéder à votre analyse personnalisée, basée sur vos données réelles.'
  });
  text.appendChild(title);
  text.appendChild(sub);

  const actions = el('div', 'demo-banner__actions');
  const loginBtn = el('a', 'btn-primary btn-gradient', { href: '/auth/', textContent: 'Se connecter' });
  loginBtn.style.minHeight = '40px';
  loginBtn.style.fontSize  = '0.875rem';
  const regBtn = el('a', 'btn-ghost btn-ghost--hero', { href: '/auth/', textContent: 'Créer un compte' });
  regBtn.style.minHeight = '40px';
  regBtn.style.fontSize  = '0.875rem';
  actions.appendChild(loginBtn);
  actions.appendChild(regBtn);

  wrap.appendChild(text);
  wrap.appendChild(actions);
  return wrap;
}

/** Chip trend +/- */
function buildTrendChip(curr, prev) {
  const diff = curr - prev;
  const chip = el('span', `trend-chip trend-chip--${diff >= 0 ? 'up' : 'down'}`);
  chip.textContent = `${diff >= 0 ? '+' : ''}${diff} pts`;
  return chip;
}

/** Card récapitulative latérale (niveau, delta, stage) */
function buildSummaryCard(label, value, sub) {
  const card = el('article', 'card-glass score-summary-card');
  card.appendChild(el('span', 'score-summary-card__label', { textContent: label }));
  card.appendChild(el('p',    'score-summary-card__value', { textContent: value }));
  if (sub) card.appendChild(el('p', 'score-summary-card__sub', { textContent: sub }));
  return card;
}

/** Cards recommandations */
function buildRecommendations(list) {
  const reco = el('div', 'reco-list');
  list.forEach(r => {
    const card = el('div', `reco-card reco-card--${r.priority}`);
    const body = el('div', 'reco-card__body');
    const header = el('div', 'reco-card__header');

    const pBadge = el('span', `priority-badge priority-badge--${r.priority}`,
      { textContent: r.priority === 'high' ? 'Critique' : r.priority === 'medium' ? 'Moyen' : 'Faible' });
    const pTag = el('span', 'pillar-tag', { textContent: r.pillar });
    const title = el('p', 'reco-card__title', { textContent: r.title });
    const desc  = el('p', 'reco-card__desc',  { textContent: r.desc });

    header.appendChild(pBadge);
    header.appendChild(pTag);
    body.appendChild(header);
    body.appendChild(title);
    body.appendChild(desc);
    card.appendChild(body);
    reco.appendChild(card);
  });
  return reco;
}

/** Barres piliers (overview) */
function buildPillarRows(pillars) {
  const wrap = el('div', 'pillar-rows');
  pillars.forEach(p => {
    const row = el('div', 'pillar-row');
    const nameEl = el('span', 'pillar-row__name', { textContent: p.name });
    const track  = el('div', 'pillar-row__track');
    const fill   = el('div', 'pillar-row__fill');
    fill.style.background = p.color;
    track.appendChild(fill);
    const scoreEl = el('span', 'pillar-row__score', { textContent: String(p.score) });
    scoreEl.style.color = p.color;
    row.appendChild(nameEl);
    row.appendChild(track);
    row.appendChild(scoreEl);
    row.appendChild(buildTrendChip(p.score, p.prev));
    wrap.appendChild(row);

    /* Animate bar après insertion */
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => { fill.style.width = `${p.score}%`; });
    });
  });
  return wrap;
}

/** Carte investor readiness */
function buildInvestorReadiness(items) {
  const card = el('article', 'card-glass investor-readiness-card');
  card.appendChild(el('h3', 'dashboard-card-title', { textContent: 'Investor Readiness' }));

  const list = el('ul', 'investor-readiness-list', { role: 'list' });
  items.forEach(item => {
    const li = el('li', 'investor-readiness-item');
    const dot = el('span', `readiness-dot readiness-dot--${item.status}`);
    dot.setAttribute('aria-hidden', 'true');
    const label = el('span', '', { textContent: item.label });
    li.appendChild(dot);
    li.appendChild(label);
    list.appendChild(li);
  });

  const barWrap = el('div', 'readiness-bar-wrap');
  const okCount = items.filter(i => i.status === 'ok').length;
  const pct = Math.round((okCount / items.length) * 100);

  const barLabel = el('div', 'readiness-bar-label');
  barLabel.appendChild(el('span', '', { textContent: 'Préparation globale' }));
  barLabel.appendChild(el('span', '', { textContent: `${pct}%` }));
  const track = el('div', 'readiness-bar-track');
  const fill  = el('div', 'readiness-bar-fill');
  track.appendChild(fill);
  barWrap.appendChild(barLabel);
  barWrap.appendChild(track);

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => { fill.style.width = `${pct}%`; });
  });

  card.appendChild(list);
  card.appendChild(barWrap);
  return card;
}

/* ── Handlers de routes ────────────────────────────────────────────────── */
function buildRoutes(data) {
  return [
    /* ── VUE D'ENSEMBLE ── */
    {
      path: /^\/dashboard\/?$/,
      async handler(root) {
        const section = el('section', 'dashboard-app__section');

        if (data.isList) {
          section.appendChild(el('h2', 'heading-section', { textContent: 'Mes Analyses' }));
          
          if (!data.items || data.items.length === 0) {
            const emptyMsg = el('p', 'dashboard-app__lead', { textContent: 'Vous n\'avez pas encore soumis de startup. Retournez à l\'accueil pour lancer une analyse.' });
            const backBtn = el('a', 'btn-primary', { href: '/', textContent: 'Lancer un scoring' });
            backBtn.style.display = 'inline-flex';
            backBtn.style.marginTop = 'var(--space-4)';
            section.appendChild(emptyMsg);
            section.appendChild(backBtn);
            root.appendChild(section);
            return;
          }

          const grid = el('div', 'dashboard-grid-2');
          data.items.forEach(item => {
            const card = el('article', 'card-glass');
            card.style.padding = 'var(--space-5)';
            card.style.cursor = 'pointer';
            card.addEventListener('click', () => { window.location.href = `/dashboard/?id=${item.reference_id}`; });
            const title = el('h3', 'dashboard-card-title', { textContent: item.startup_name || item.reference_id });
            const date = el('p', 'dashboard-meta', { textContent: 'Analysée le ' + new Date(item.created_at).toLocaleDateString('fr-FR') });
            card.appendChild(title);
            card.appendChild(date);
            grid.appendChild(card);
          });
          section.appendChild(grid);
          root.appendChild(section);
          return;
        }

        // ARCHITECT-PRIME : Gestion des états asynchrones (En cours / Erreur)
        if (data.status === 'pending_analysis' || data.status === 'pending_webhook') {
          section.appendChild(el('h2', 'heading-section', { textContent: 'Analyse en cours...' }));
          section.appendChild(el('p', 'dashboard-app__lead', { textContent: 'Notre IA Claude 3.5 Sonnet est en train d\'évaluer vos données. Cela prend généralement moins de 15 secondes. Veuillez patienter, la page se rafraîchira automatiquement.' }));
          root.appendChild(section);

          // ARCHITECT-PRIME : Polling (Rafraîchissement automatique)
          const pollInterval = setInterval(async () => {
            // Si l'utilisateur change d'onglet, la section est détruite, on arrête proprement le polling
            if (!document.body.contains(section)) {
              clearInterval(pollInterval);
              return;
            }
            try {
              const res = await fetch(`/api/dashboard/${encodeURIComponent(data.id)}`, { credentials: 'same-origin' });
              if (res.ok) {
                const newData = await res.json();
                if (newData.status !== 'pending_analysis' && newData.status !== 'pending_webhook') {
                  clearInterval(pollInterval);
                  window.location.reload(); // Rafraîchit l'application avec les nouvelles données IA
                }
              }
            } catch (err) {}
          }, 3000); // Vérification silencieuse toutes les 3 secondes

          return;
        }

        if (data.status === 'error') {
          section.appendChild(el('h2', 'heading-section', { textContent: 'Analyse échouée' }));
          const errLead = el('p', 'dashboard-app__lead', { textContent: 'Un problème technique est survenu lors de l\'évaluation de votre dossier par l\'IA. Veuillez nous contacter ou relancer un audit.' });
          errLead.style.color = 'var(--accent-rose)';
          section.appendChild(errLead);
          root.appendChild(section);
          return;
        }

        const d3 = await loadD3();
        /* Demo banner */
        if (data.isDemo) section.appendChild(buildDemoBanner());

        /* Score summary row */
        const summaryRow = el('div', 'score-summary-row');

        const radialCard = el('article', 'card-glass score-summary-card score-radial-wrap');
        const radialViz  = el('div', 'dashboard-viz');
        radialViz.style.minHeight = '200px';
        radialCard.appendChild(radialViz);
        summaryRow.appendChild(radialCard);

        const diff = data.score - data.scorePrev;
        summaryRow.appendChild(buildSummaryCard('Niveau', data.level, `${data.stage} · ${data.sector}`));
        summaryRow.appendChild(buildSummaryCard('Évolution', `${diff >= 0 ? '+' : ''}${diff} pts`,
          `vs audit précédent (${data.scorePrev}/100)`));
        summaryRow.appendChild(buildSummaryCard('Mis à jour',
          new Date(data.updatedAt).toLocaleDateString('fr-FR', { day:'2-digit', month:'short' }),
          'Dernière analyse'));

        section.appendChild(summaryRow);

        /* Pillar rows */
        const pillarCard = el('article', 'card-glass');
        pillarCard.appendChild(el('h3', 'dashboard-card-title', { textContent: 'Cinq piliers — synthèse' }));
        pillarCard.appendChild(buildPillarRows(data.pillars));
        section.appendChild(pillarCard);

        /* 2-col: historique + investor readiness */
        const grid = el('div', 'dashboard-grid-2');

        const histCard = el('article', 'card-glass');
        histCard.appendChild(el('h3', 'dashboard-card-title', { textContent: 'Évolution des scores' }));
        const histViz = el('div', 'chart-container');
        histCard.appendChild(histViz);
        grid.appendChild(histCard);

        grid.appendChild(buildInvestorReadiness(data.investorReadiness));
        section.appendChild(grid);

        /* Recommandations */
        const recoCard = el('article', 'card-glass');
        recoCard.appendChild(el('h3', 'dashboard-card-title', { textContent: 'Recommandations prioritaires' }));
        recoCard.appendChild(buildRecommendations(data.recommendations));
        section.appendChild(recoCard);

        root.appendChild(section);

        /* D3 renders */
        renderScoreRadial(radialViz, data.score, d3);
        renderScoreHistory(histViz, data.history, d3);
      }
    },

    /* ── PILIERS DÉTAIL ── */
    {
      path: /^\/dashboard\/pillars$/,
      async handler(root) {
        const section = el('section', 'dashboard-app__section');
        if (data.isList) {
          section.appendChild(el('p', 'dashboard-meta', { textContent: 'Veuillez sélectionner une analyse dans l\'onglet Overview.' }));
          root.appendChild(section);
          return;
        }
        if (data.status === 'pending_analysis' || data.status === 'pending_webhook' || data.status === 'error') {
          section.appendChild(el('p', 'dashboard-meta', { textContent: 'Données indisponibles. Consultez l\'onglet Overview pour voir le statut de l\'analyse.' }));
          root.appendChild(section);
          return;
        }
        const d3 = await loadD3();
        if (data.isDemo) section.appendChild(buildDemoBanner());

        section.appendChild(el('h2', 'heading-section', { textContent: 'Analyse par pilier' }));
        section.appendChild(el('p', 'dashboard-app__lead', {
          textContent: 'Chaque pilier est noté de 0 à 100 et benchmarké contre des entreprises comparables à votre stade et secteur.'
        }));

        /* Radar centré */
        const radarCard = el('article', 'card-glass');
        radarCard.appendChild(el('h3', 'dashboard-card-title', { textContent: 'Radar des piliers' }));
        const radarViz = el('div', 'dashboard-viz dashboard-viz--wide');
        radarViz.style.minHeight = '320px';
        radarCard.appendChild(radarViz);
        section.appendChild(radarCard);

        /* Cards détail */
        const detailGrid = el('div', 'pillar-detail-grid');
        data.pillars.forEach(p => {
          const card = el('article', 'card-glass pillar-detail-card');

          const header = el('div', 'pillar-detail-card__header');
          const name   = el('h3', 'pillar-detail-card__name', { textContent: p.name });
          const swrap  = el('div', 'pillar-detail-card__score-wrap');
          const score  = el('span', 'pillar-detail-card__score', { textContent: String(p.score) });
          score.style.color = p.color;
          swrap.appendChild(score);
          swrap.appendChild(el('span', 'pillar-detail-card__score-max', { textContent: '/100' }));
          header.appendChild(name);
          header.appendChild(swrap);

          const track = el('div', 'pillar-detail-card__track');
          const fill  = el('div', 'pillar-detail-card__fill');
          fill.style.background = p.color;
          track.appendChild(fill);

          const meta = el('div', '', { style: 'display:flex;align-items:center;gap:8px;margin-top:2px' });
          meta.appendChild(buildTrendChip(p.score, p.prev));
          meta.appendChild(el('span', 'dashboard-meta', { textContent: `Précédent : ${p.prev}/100` }));

          card.appendChild(header);
          card.appendChild(track);
          card.appendChild(meta);
          card.appendChild(el('p', 'pillar-detail-card__insight', { textContent: p.insight }));
          detailGrid.appendChild(card);

          window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => { fill.style.width = `${p.score}%`; });
          });
        });

        section.appendChild(detailGrid);
        root.appendChild(section);
        renderPillarRadar(radarViz, data.pillars, d3);
      }
    },

    /* ── MARCHÉ ── */
    {
      path: /^\/dashboard\/network$/,
      async handler(root) {
        const section = el('section', 'dashboard-app__section');
        if (data.isList) {
          section.appendChild(el('p', 'dashboard-meta', { textContent: 'Veuillez sélectionner une analyse dans l\'onglet Overview.' }));
          root.appendChild(section);
          return;
        }
        if (data.status === 'pending_analysis' || data.status === 'pending_webhook' || data.status === 'error') {
          section.appendChild(el('p', 'dashboard-meta', { textContent: 'Données indisponibles. Consultez l\'onglet Overview pour voir le statut de l\'analyse.' }));
          root.appendChild(section);
          return;
        }
        const d3 = await loadD3();
        if (data.isDemo) section.appendChild(buildDemoBanner());

        section.appendChild(el('h2', 'heading-section', { textContent: 'Analyse de marché' }));
        section.appendChild(el('p', 'dashboard-app__lead', {
          textContent: 'Estimation du marché adressable et positionnement concurrentiel — données illustratives benchmarkées sur votre secteur.'
        }));

        /* TAM / SAM / SOM */
        const statsGrid = el('div', 'market-stats-grid');
        const marketDefs = [
          { label: 'TAM — Marché total',     value: data.market.tam, sub: 'Marché global adressable' },
          { label: 'SAM — Marché accessible', value: data.market.sam, sub: 'Votre segment cible réaliste' },
          { label: 'SOM — Part atteignable',  value: data.market.som, sub: 'Objectif 3 ans (5% SAM)' },
        ];
        marketDefs.forEach((m, idx) => {
          const card = el('article', 'card-glass market-stat-card');
          card.appendChild(el('span', 'market-stat-card__label', { textContent: m.label }));
          const val = el('p', 'market-stat-card__value', { textContent: m.value });
          val.style.color = ['var(--accent-violet)', 'var(--accent-blue)', 'var(--accent-emerald)'][idx];
          card.appendChild(val);
          card.appendChild(el('p', 'market-stat-card__sub', { textContent: m.sub }));
          statsGrid.appendChild(card);
        });
        section.appendChild(statsGrid);

        /* Graphe force-directed */
        const graphCard = el('article', 'card-glass');
        graphCard.appendChild(el('h3', 'dashboard-card-title', { textContent: 'Carte concurrentielle' }));
        const graphViz = el('div', 'dashboard-viz dashboard-viz--wide');
        graphViz.style.minHeight = '440px';
        graphCard.appendChild(graphViz);
        section.appendChild(graphCard);

        /* Légende */
        const legend = el('div', '', { style: 'display:flex;gap:16px;flex-wrap:wrap;margin-top:12px' });
        [
          { c: 'var(--accent-violet)', l: 'Votre startup' },
          { c: 'var(--accent-rose)',   l: 'Concurrent' },
          { c: 'var(--accent-blue)',   l: 'Partenaire' },
        ].forEach(({ c, l }) => {
          const item = el('div', '', { style: 'display:flex;align-items:center;gap:6px' });
          const dot  = el('span', '', { style: `width:10px;height:10px;border-radius:50%;background:${c};display:inline-block` });
          item.appendChild(dot);
          item.appendChild(el('span', 'dashboard-meta', { textContent: l }));
          legend.appendChild(item);
        });
        graphCard.appendChild(legend);

        root.appendChild(section);
        renderCompetitiveGraph(graphViz, data.graph, d3);
      }
    }
  ];
}

/* ── Routeur ───────────────────────────────────────────────────────────── */
function normalizePath(pathname) {
  return pathname === '/dashboard' ? '/dashboard/' : pathname;
}

class FlaynnRouter {
  constructor(routes, root) {
    this.routes = routes;
    this.root   = root;
    window.addEventListener('popstate', () => this.#resolve());
    document.addEventListener('click', (e) => {
      const link = e.target.closest('[data-route]');
      if (!link) return;
      if (typeof navigator.vibrate === 'function') navigator.vibrate(15);
      e.preventDefault();
      const path = link.getAttribute('data-route');
      if (path) this.navigate(path);
    });
    this.#resolve();
  }

  navigate(path) { history.pushState(null, '', path); this.#resolve(); }

  async #resolve() {
    const path = normalizePath(window.location.pathname);
    const match = this.routes.find(r =>
      typeof r.path === 'string' ? r.path === path : r.path.test(path)
    );
    if (!match) {
      if (path.startsWith('/dashboard')) {
        window.history.replaceState(null, '', '/dashboard/');
        return this.#resolve();
      }
      return;
    }
    stopForceSimulation();
    this.root.setAttribute('aria-busy', 'true');
    clearEl(this.root);
    try { await match.handler(this.root, path); }
    finally { this.root.setAttribute('aria-busy', 'false'); }
    this.#syncNav(path);
    initDashboardReveal(this.root);
    this.root.focus();
  }

  #syncNav(path) {
    const p = path === '/dashboard' ? '/dashboard/' : path;
    document.querySelectorAll('[data-route]').forEach(el => {
      el.classList.toggle('is-active', el.getAttribute('data-route') === p);
    });
  }
}

/* ── Topbar : user info / logout ───────────────────────────────────────── */
function initTopbar(auth) {
  const topbar = document.getElementById('dashboard-startup-name');
  if (!topbar) return;
  topbar.replaceChildren();

  if (auth) {
    const userBtn = el('div', '', { style: 'display:flex;align-items:center;gap:var(--space-3)' });

    const avatar = el('div', 'dashboard-avatar');
    avatar.textContent = auth.name ? auth.name.charAt(0).toUpperCase() : '?';

    const nameSpan = el('span', 'dashboard-topbar__title', { textContent: auth.name || auth.email });

    const logoutBtn = el('button', 'dashboard-logout-btn', { type: 'button' });
    logoutBtn.textContent = 'Déconnexion';
    logoutBtn.addEventListener('click', async () => {
      try {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
      } catch {
        /* On efface quand même l'état local */
      }
      clearAuth();
      window.location.replace('/');
    });

    const listBtn = el('a', 'dashboard-meta', { href: '/dashboard/' });
    listBtn.textContent = 'Mes analyses';
    listBtn.style.textDecoration = 'none';
    listBtn.style.marginRight = 'var(--space-3)';

    userBtn.appendChild(avatar);
    userBtn.appendChild(nameSpan);
    userBtn.appendChild(listBtn);
    userBtn.appendChild(logoutBtn);
    topbar.appendChild(userBtn);
  } else {
    const demoTag = el('span', 'hero-badge', { textContent: '● Mode démo' });
    const loginLink = el('a', 'btn-primary', { href: '/auth/', textContent: 'Se connecter' });
    loginLink.style.minHeight = '36px';
    loginLink.style.fontSize  = '0.8125rem';
    topbar.appendChild(demoTag);
    topbar.appendChild(loginLink);
    topbar.style.display = 'flex';
    topbar.style.alignItems = 'center';
    topbar.style.gap = 'var(--space-3)';
  }
}

/* ── Animations d'apparition (Reveal) ──────────────────────────────────── */
function initDashboardReveal(root) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-revealed');
        obs.unobserve(entry.target);
      }
    });
  }, { rootMargin: '0px 0px -5% 0px', threshold: 0 });

  // Sélection dynamique des blocs à animer lors du rendu de la vue
  const elements = root.querySelectorAll('.heading-section, .dashboard-app__lead, .card-glass, .demo-banner');
  
  elements.forEach((el, index) => {
    el.classList.add('reveal-native');
    el.style.transitionDelay = `${Math.min(index, 12) * 60}ms`; // Stagger en cascade (max 12 éléments pour éviter d'attendre trop longtemps)
    observer.observe(el);
  });
}

/* ── Liquid UX ─────────────────────────────────────────────────────────── */
function initLiquidUX() {
  const applyGlow = () => {
    document.querySelectorAll('.card-glass').forEach(card => {
      if (card.dataset.glowBound) return;
      card.dataset.glowBound = 'true';
      card.addEventListener('mousemove', (e) => {
        const r = card.getBoundingClientRect();
        card.style.setProperty('--mouse-x', `${e.clientX - r.left}px`);
        card.style.setProperty('--mouse-y', `${e.clientY - r.top}px`);
      });
    });
  };
  applyGlow();
  new MutationObserver(() => applyGlow()).observe(document.body, { childList: true, subtree: true });

  const interactives = 'button, a, .dashboard-nav-side__link, .dashboard-nav-mobile__item';
  document.addEventListener('pointerdown', (e) => {
    const t = e.target.closest(interactives);
    if (t && !t.disabled) { t.style.transform = 'scale(0.96)'; t.style.transition = 'transform 0.1s ease'; }
  });
  const reset = (e) => {
    const t = e.target.closest(interactives);
    if (t) { t.style.transform = ''; t.style.transition = 'transform 0.4s cubic-bezier(0.34,1.56,0.64,1)'; }
  };
  document.addEventListener('pointerup',     reset);
  document.addEventListener('pointercancel', reset);
  document.addEventListener('pointerout',    reset);
}

/* ── Main ──────────────────────────────────────────────────────────────── */
async function main() {
  const app = document.getElementById('app');
  if (!app) return;

  const auth = await syncAuthFromSession();
  initTopbar(auth);

  clearEl(app);
  app.setAttribute('aria-busy', 'true');

  const loading = el('p', 'dashboard-loading', { textContent: 'Chargement de votre espace…' });
  loading.setAttribute('role', 'status');
  app.appendChild(loading);

  let data;

  if (!auth) {
    /* Mode démo : pas de fetch API */
    data = DEMO_DATA;
    clearEl(app);
    app.setAttribute('aria-busy', 'false');
  } else {
    /* Utilisateur connecté : tente l'API, fallback démo si indisponible */
    try {
      const id = new URLSearchParams(window.location.search).get('id');
      
      if (id && id !== 'demo') {
        const res = await fetch(`/api/dashboard/${encodeURIComponent(id)}`, { credentials: 'same-origin' });
        if (res.status === 401 || res.status === 403) throw new Error('Non autorisé');
        if (!res.ok) throw new Error('API indisponible');
        const apiData = await res.json();
        data = { ...apiData, isDemo: false, isList: false };
      } else {
        const res = await fetch(`/api/dashboard/list`, { credentials: 'same-origin' });
        if (res.status === 401 || res.status === 403) throw new Error('Non autorisé');
        if (!res.ok) throw new Error('API indisponible');
        const listData = await res.json();
        data = { isDemo: false, isList: true, items: listData };
      }
    } catch {
      /* Fallback démo si API pas prête */
      data = { ...DEMO_DATA, isDemo: true };
    }
    clearEl(app);
    app.setAttribute('aria-busy', 'false');
  }

  const routes = buildRoutes(data);
  new FlaynnRouter(routes, app);
}

initLiquidUX();
main();
