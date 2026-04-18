import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import satori from 'satori';
import { html } from 'satori-html';
import { Resvg } from '@resvg/resvg-js';

// ARCHITECT-PRIME — Delta 9 step 3 : rendu OG image 1200×630 via Satori + resvg.
// Pipeline : satori(vdom, fonts) → SVG string → resvg → PNG buffer → disque.
//
// Sensibilité haute : tout input dynamique (startupName, verdict, sector) passe
// par escapeHtml avant injection dans le template HTML. Un `<script>` injecté
// dans le nom ne s'exécute pas (satori ne fait pas tourner de JS) mais peut
// casser le parsing HTML → on escape quand même par défense en profondeur.

const __dirname = dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = resolve(__dirname, '../../assets/fonts');

// Dimensions fixes Open Graph (standard LinkedIn / Twitter / FB).
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

// Charge les fonts une fois par process. Les buffers restent en RAM (≈ 400 KB),
// sans surprise sur la mémoire du dyno Render.
let fontsPromise = null;
function loadFonts() {
  if (fontsPromise) return fontsPromise;
  fontsPromise = (async () => {
    const [regular, bold] = await Promise.all([
      readFile(join(FONTS_DIR, 'IBMPlexSans-Regular.ttf')),
      readFile(join(FONTS_DIR, 'IBMPlexSans-Bold.ttf'))
    ]);
    return [
      { name: 'IBM Plex Sans', data: regular, weight: 400, style: 'normal' },
      { name: 'IBM Plex Sans', data: bold,    weight: 700, style: 'normal' }
    ];
  })();
  return fontsPromise;
}

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

function verdictColor(verdict) {
  if (verdict === 'Ready' || verdict === 'Strong Yes' || verdict === 'Yes') return '#10B981';
  if (verdict === 'Almost') return '#E8651A';
  return '#7B2D8E';
}

function clampName(name, max = 80) {
  const s = String(name || 'Startup');
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

// Construit le vdom satori-html. Uniquement flex layout (contrainte satori).
// Aucun background-clip:text — non supporté correctement par satori → on utilise
// des couleurs plates sur le wordmark et le score.
function buildOgVdom({ startupName, score, verdict, sector, track }) {
  const nameDisplay = escapeHtml(clampName(startupName));
  const sectorDisplay = escapeHtml(sector || 'Startup');
  const trackDisplay = escapeHtml(track || '');
  const verdictDisplay = escapeHtml(verdict || '');
  const verdictBg = verdictColor(verdict);
  const scoreDisplay = String(Number(score) || 0);

  const metaLine = trackDisplay
    ? `${sectorDisplay} · ${trackDisplay}`
    : sectorDisplay;

  return html(`
    <div style="
      width: 1200px; height: 630px;
      display: flex; flex-direction: column;
      background: linear-gradient(135deg, #0A0410 0%, #1A0B2E 55%, #2D1240 100%);
      padding: 72px 80px;
      font-family: 'IBM Plex Sans';
      color: #F5F0FA;
    ">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div style="
          font-size: 36px; font-weight: 700;
          letter-spacing: -0.02em;
          color: #E8651A;
        ">FLAYNN</div>
        <div style="
          display: flex; align-items: center;
          padding: 14px 28px;
          border-radius: 999px;
          background: ${verdictBg};
          font-size: 24px; font-weight: 700;
          color: #0A0410;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        ">${verdictDisplay}</div>
      </div>

      <div style="
        display: flex; flex-direction: column;
        margin-top: 56px; flex: 1;
      ">
        <div style="
          display: flex;
          font-size: 22px; color: #A69BB8;
          letter-spacing: 0.1em; text-transform: uppercase;
          margin-bottom: 20px;
        ">${metaLine}</div>
        <div style="
          display: flex;
          font-size: 76px; font-weight: 700;
          line-height: 1.05; letter-spacing: -0.03em;
          color: #F5F0FA;
          max-width: 1040px;
        ">${nameDisplay}</div>
      </div>

      <div style="display: flex; justify-content: space-between; align-items: flex-end;">
        <div style="display: flex; flex-direction: column;">
          <div style="
            display: flex;
            font-size: 20px; color: #A69BB8;
            letter-spacing: 0.08em; text-transform: uppercase;
            margin-bottom: 8px;
          ">Flaynn Score</div>
          <div style="display: flex; align-items: baseline;">
            <div style="
              font-size: 168px; font-weight: 700;
              line-height: 1; letter-spacing: -0.05em;
              color: #F5F0FA;
            ">${scoreDisplay}</div>
            <div style="
              font-size: 72px; color: #A69BB8;
              line-height: 1; font-weight: 400;
              margin-left: 8px;
            ">/100</div>
          </div>
        </div>
        <div style="
          display: flex;
          font-size: 18px; color: #7B2D8E;
          font-weight: 700; letter-spacing: 0.1em;
          text-transform: uppercase;
        ">Validé · Flaynn Intelligence</div>
      </div>
    </div>
  `);
}

async function vdomToPng(vdom) {
  const fonts = await loadFonts();
  const svg = await satori(vdom, {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts
  });
  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: OG_WIDTH }
  }).render().asPng();
  return png;
}

export function getOgOutputDir() {
  return resolve(process.env.OG_OUTPUT_DIR || './public/og');
}

// Rend l'image pour un slug et l'écrit sur le disque. Retourne le chemin public
// (/og/<slug>.png) à enregistrer dans public_cards.og_image_path.
export async function renderOgImage(slug, snapshot, startupName) {
  const vdom = buildOgVdom({
    startupName: startupName || 'Startup',
    score: snapshot?.score ?? 0,
    verdict: snapshot?.verdict || '',
    sector: snapshot?.sector || '',
    track: snapshot?.track || ''
  });
  const png = await vdomToPng(vdom);
  const outDir = getOgOutputDir();
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, `${slug}.png`);
  await writeFile(outPath, png);
  return `/og/${slug}.png`;
}

// Warm-up : charge les fonts et exécute un render 100×100 jeté. Appelé au boot
// serveur pour éviter ~150–300 ms de cold path sur le premier publish réel.
// Le render fantôme n'écrit rien sur le disque.
export async function warmUpOgRender() {
  const started = Date.now();
  await loadFonts();
  const vdom = html(`
    <div style="
      width: 100px; height: 100px;
      display: flex; justify-content: center; align-items: center;
      background: #0A0410; font-family: 'IBM Plex Sans';
      color: #F5F0FA; font-weight: 700;
    ">F</div>
  `);
  const fonts = await loadFonts();
  const svg = await satori(vdom, { width: 100, height: 100, fonts });
  new Resvg(svg, { fitTo: { mode: 'width', value: 100 } }).render().asPng();
  return Date.now() - started;
}
