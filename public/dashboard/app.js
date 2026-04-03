/**
 * Flaynn dashboard — routeur vanilla, D3 (ESM), pas d'innerHTML pour le contenu dynamique.
 */

const D3_ESM = 'https://cdn.jsdelivr.net/npm/d3@7/+esm';

let d3Cache = null;
async function loadD3() {
  if (!d3Cache) {
    d3Cache = await import(D3_ESM);
  }
  return d3Cache;
}

function el(tag, className, attrs = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'textContent') node.textContent = v;
    else if (k === 'id') node.id = v;
    else node.setAttribute(k, v);
  });
  return node;
}

function clearEl(node) {
  node.replaceChildren();
}

function renderScoreRadial(container, score, d3) {
  const size = 240;
  const thickness = 12;
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;

  const svg = d3
    .select(container)
    .append('svg')
    .attr('viewBox', `0 0 ${size} ${size}`)
    .attr('role', 'img')
    .attr('aria-label', `Score global ${score} sur 100`);

  svg
    .append('circle')
    .attr('cx', size / 2)
    .attr('cy', size / 2)
    .attr('r', radius)
    .attr('fill', 'none')
    .attr('stroke', 'var(--surface-raised)')
    .attr('stroke-width', thickness);

  const stroke =
    score >= 70 ? 'var(--accent-emerald)' : score >= 40 ? 'var(--accent-amber)' : 'var(--accent-rose)';

  const arc = svg
    .append('circle')
    .attr('cx', size / 2)
    .attr('cy', size / 2)
    .attr('r', radius)
    .attr('fill', 'none')
    .attr('stroke', stroke)
    .attr('stroke-width', thickness)
    .attr('stroke-linecap', 'round')
    .attr('stroke-dasharray', circumference)
    .attr('stroke-dashoffset', circumference)
    .attr('transform', `rotate(-90 ${size / 2} ${size / 2})`);

  arc
    .transition()
    .duration(1200)
    .ease(d3.easeCubicOut)
    .attr('stroke-dashoffset', circumference - (score / 100) * circumference);

  const text = svg
    .append('text')
    .attr('x', size / 2)
    .attr('y', size / 2)
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'central')
    .attr('class', 'score-radial__value')
    .text('0');

  d3.transition()
    .duration(1200)
    .ease(d3.easeCubicOut)
    .tween('text', () => {
      const i = d3.interpolateNumber(0, score);
      return (t) => {
        text.text(String(Math.round(i(t))));
      };
    });
}

function renderPillarRadar(container, pillars, d3) {
  const size = 320;
  const center = size / 2;
  const maxR = 120;
  const angle = (i) => ((2 * Math.PI) / pillars.length) * i - Math.PI / 2;

  const svg = d3.select(container).append('svg').attr('viewBox', `0 0 ${size} ${size}`).attr('role', 'img');

  for (let i = 1; i <= 5; i += 1) {
    svg
      .append('circle')
      .attr('cx', center)
      .attr('cy', center)
      .attr('r', (maxR / 5) * i)
      .attr('fill', 'none')
      .attr('stroke', 'var(--border-subtle)')
      .attr('stroke-dasharray', '4 4');
  }

  pillars.forEach((p, i) => {
    const a = angle(i);
    const x = center + maxR * Math.cos(a);
    const y = center + maxR * Math.sin(a);
    svg
      .append('line')
      .attr('x1', center)
      .attr('y1', center)
      .attr('x2', x)
      .attr('y2', y)
      .attr('stroke', 'var(--border-subtle)');
    svg
      .append('text')
      .attr('x', center + (maxR + 20) * Math.cos(a))
      .attr('y', center + (maxR + 20) * Math.sin(a))
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('class', 'pillar-radar__label')
      .text(p.name);
  });

  const pts = pillars
    .map((p, i) => {
      const a = angle(i);
      const r = (p.score / 100) * maxR;
      return `${center + r * Math.cos(a)},${center + r * Math.sin(a)}`;
    })
    .join(' ');

  svg
    .append('polygon')
    .attr('points', pillars.map(() => `${center},${center}`).join(' '))
    .attr('fill', 'rgba(139,92,246,0.12)')
    .attr('stroke', 'var(--accent-violet)')
    .attr('stroke-width', 2)
    .transition()
    .duration(1000)
    .ease(d3.easeCubicOut)
    .attr('points', pts);
}

function renderCompetitiveGraph(container, data, d3) {
  const w = Math.max(container.clientWidth || 400, 320);
  const h = 420;

  const nodes = data.nodes.map((d) => ({ ...d }));
  const links = data.links.map((d) => ({ ...d }));

  const svg = d3.select(container).append('svg').attr('viewBox', `0 0 ${w} ${h}`).attr('role', 'img');

  const simulation = d3
    .forceSimulation(nodes)
    .force(
      'link',
      d3
        .forceLink(links)
        .id((d) => d.id)
        .distance(100)
    )
    .force('charge', d3.forceManyBody().strength(-220))
    .force('center', d3.forceCenter(w / 2, h / 2))
    .force('collision', d3.forceCollide(44));

  const link = svg
    .selectAll('.link')
    .data(links)
    .enter()
    .append('line')
    .attr('stroke', 'var(--border-default)')
    .attr('stroke-width', (d) => (d.strength != null ? d.strength * 2 : 2))
    .attr('stroke-opacity', 0.45);

  const node = svg
    .selectAll('.node')
    .data(nodes)
    .enter()
    .append('g')
    .call(
      d3
        .drag()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.35).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        })
    );

  node
    .append('circle')
    .attr('r', (d) => (d.type === 'user' ? 22 : 14))
    .attr('fill', (d) =>
      d.type === 'user'
        ? 'var(--accent-violet)'
        : d.type === 'competitor'
          ? 'var(--accent-rose)'
          : 'var(--accent-blue)'
    )
    .attr('stroke', 'var(--surface-base)')
    .attr('stroke-width', 2);

  node
    .append('text')
    .text((d) => d.label)
    .attr('dy', (d) => (d.type === 'user' ? 34 : 26))
    .attr('text-anchor', 'middle')
    .attr('class', 'graph-node__label');

  simulation.on('tick', () => {
    link
      .attr('x1', (d) => d.source.x)
      .attr('y1', (d) => d.source.y)
      .attr('x2', (d) => d.target.x)
      .attr('y2', (d) => d.target.y);
    node.attr('transform', (d) => `translate(${d.x},${d.y})`);
  });
}

function normalizePath(pathname) {
  if (pathname === '/dashboard') return '/dashboard/';
  return pathname;
}

class FlaynnRouter {
  /**
   * @param {{ path: RegExp | string; handler: (root: HTMLElement, path: string, data: object) => void | Promise<void>}[]} routes
   * @param {HTMLElement} root
   * @param {object} data
   */
  constructor(routes, root, data) {
    this.routes = routes;
    this.root = root;
    this.data = data;
    window.addEventListener('popstate', () => this.#resolve());
    document.addEventListener('click', (e) => {
      const link = e.target.closest('[data-route]');
      if (!link) return;
      e.preventDefault();
      const path = link.getAttribute('data-route');
      if (path) this.navigate(path);
    });
    this.#resolve();
  }

  navigate(path) {
    history.pushState(null, '', path);
    this.#resolve();
  }

  async #resolve() {
    const path = normalizePath(window.location.pathname);
    const match = this.routes.find((r) => {
      if (typeof r.path === 'string') return r.path === path;
      return r.path.test(path);
    });
    if (!match) {
      if (path.startsWith('/dashboard')) {
        window.history.replaceState(null, '', '/dashboard/');
        return this.#resolve();
      }
      return;
    }
    clearEl(this.root);
    await match.handler(this.root, path, this.data);
    this.#syncNav(path);
    this.root.focus();
  }

  #syncNav(path) {
    const p = path === '/dashboard' ? '/dashboard/' : path;
    document.querySelectorAll('[data-route]').forEach((el) => {
      const route = el.getAttribute('data-route');
      const active = route === p || (p === '/dashboard/' && route === '/dashboard/');
      el.classList.toggle('is-active', active);
    });
  }
}

async function fetchDashboard() {
  const id = new URLSearchParams(window.location.search).get('id') || 'demo';
  const res = await fetch(`/api/dashboard/${encodeURIComponent(id)}`);
  if (!res.ok) {
    throw new Error('Impossible de charger le dossier.');
  }
  const data = await res.json();
  const title = document.getElementById('dashboard-startup-name');
  if (title) title.textContent = data.startupName || 'Dashboard';
  return data;
}

function buildRoutes(data) {
  return [
    {
      path: /^\/dashboard\/?$/,
      async handler(root) {
        const d3 = await loadD3();
        const section = el('section', 'dashboard-app__section');
        const h2 = el('h2', 'heading-section', { textContent: 'Vue d’ensemble' });
        const lead = el('p', 'dashboard-app__lead', {
          textContent:
            'Synthèse de votre scoring sur les cinq piliers. Les visualisations sont générées côté client (D3.js) à partir des données API.'
        });
        const grid = el('div', 'dashboard-grid-2');
        const card1 = el('article', 'card-glass');
        const t1 = el('h3', 'dashboard-card-title', { textContent: 'Score global' });
        const viz1 = el('div', 'dashboard-viz');
        card1.appendChild(t1);
        card1.appendChild(viz1);
        const card2 = el('article', 'card-glass');
        const t2 = el('h3', 'dashboard-card-title', { textContent: 'Radar des piliers' });
        const viz2 = el('div', 'dashboard-viz dashboard-viz--wide');
        card2.appendChild(t2);
        card2.appendChild(viz2);
        grid.appendChild(card1);
        grid.appendChild(card2);
        const meta = el('p', 'dashboard-meta', {
          textContent: `Dernière mise à jour : ${new Date(data.updatedAt).toLocaleString('fr-FR')}`
        });
        section.appendChild(h2);
        section.appendChild(lead);
        section.appendChild(grid);
        section.appendChild(meta);
        root.appendChild(section);
        renderScoreRadial(viz1, data.score, d3);
        renderPillarRadar(viz2, data.pillars, d3);
      }
    },
    {
      path: /^\/dashboard\/pillars$/,
      async handler(root) {
        const d3 = await loadD3();
        const section = el('section', 'dashboard-app__section');
        section.appendChild(el('h2', 'heading-section', { textContent: 'Détail des piliers' }));
        section.appendChild(
          el('p', 'dashboard-app__lead', {
            textContent:
              'Lecture radar normalisée sur 100. Utile pour identifier vos leviers avant une levée.'
          })
        );
        const wrap = el('article', 'card-glass');
        wrap.appendChild(el('h3', 'dashboard-card-title', { textContent: 'Répartition' }));
        const viz = el('div', 'dashboard-viz dashboard-viz--wide');
        wrap.appendChild(viz);
        section.appendChild(wrap);
        root.appendChild(section);
        renderPillarRadar(viz, data.pillars, d3);
      }
    },
    {
      path: /^\/dashboard\/network$/,
      async handler(root) {
        const d3 = await loadD3();
        const section = el('section', 'dashboard-app__section');
        section.appendChild(el('h2', 'heading-section', { textContent: 'Carte marché (démo)' }));
        section.appendChild(
          el('p', 'dashboard-app__lead', {
            textContent:
              'Graphe de force : vous, concurrents directs et partenaires — données illustratives.'
          })
        );
        const wrap = el('article', 'card-glass');
        const viz = el('div', 'dashboard-viz dashboard-viz--wide');
        viz.style.minHeight = '440px';
        wrap.appendChild(viz);
        section.appendChild(wrap);
        root.appendChild(section);
        renderCompetitiveGraph(viz, data.graph, d3);
      }
    }
  ];
}

async function main() {
  const data = await fetchDashboard();
  const routes = buildRoutes(data);
  const app = document.getElementById('app');
  if (!app) return;
  new FlaynnRouter(routes, app, data);
}

main().catch((err) => {
  const app = document.getElementById('app');
  if (app) {
    const p = el('p', 'dashboard-app__lead', { textContent: err.message || 'Erreur de chargement.' });
    app.appendChild(p);
  }
});
