function n8nConnectOrigin() {
  // ARCHITECT-PRIME: aligné avec le nom dans envSchema (server.js) et render.yaml
  const u = process.env.N8N_WEBHOOK_URL;
  if (!u) return [];
  try {
    return [new URL(u).origin];
  } catch {
    return [];
  }
}

// ARCHITECT-PRIME: directives CSP partagées (helmet config + override /score/:slug).
// Exposées séparément pour que les routes Score Card publique puissent construire
// un header CSP scoped incluant un hash SHA-256 du JSON-LD inline (delta 9 J4).
const CSP_DIRECTIVES = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", 'https://cdn.jsdelivr.net', 'https://js.stripe.com'],
  styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  fontSrc: ["'self'", "https://fonts.gstatic.com"],
  imgSrc: ["'self'", "data:", "https://*.stripe.com"],
  connectSrc: [
    "'self'",
    'https://cdn.jsdelivr.net',
    'https://fonts.googleapis.com',
    'https://fonts.gstatic.com',
    'https://api.stripe.com',
    ...n8nConnectOrigin()
  ],
  frameSrc: ["'self'", "https://js.stripe.com"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  objectSrc: ["'none'"],
  upgradeInsecureRequests: []
};

function kebabCase(camel) {
  return camel.replace(/([A-Z])/g, '-$1').toLowerCase();
}

function serializeCspDirectives(directives) {
  const parts = [];
  for (const [key, values] of Object.entries(directives)) {
    const name = kebabCase(key);
    if (!values || values.length === 0) {
      parts.push(name);
    } else {
      parts.push(`${name} ${values.join(' ')}`);
    }
  }
  return parts.join('; ');
}

// Construit un header CSP identique à celui posé par helmet, + éventuellement
// des hashes additionnels dans script-src (format 'sha256-BASE64' SANS les
// apostrophes — elles sont ajoutées ici). Scoped : utilisé uniquement pour
// /score/:slug qui a besoin d'autoriser un <script type="application/ld+json">.
export function buildCspHeader(extraScriptSrcHashes = []) {
  const directives = { ...CSP_DIRECTIVES };
  if (extraScriptSrcHashes.length > 0) {
    directives.scriptSrc = [
      ...CSP_DIRECTIVES.scriptSrc,
      ...extraScriptSrcHashes.map((h) => `'${h}'`)
    ];
  }
  return serializeCspDirectives(directives);
}

export const helmetConfig = {
  contentSecurityPolicy: {
    directives: CSP_DIRECTIVES
  },
  /* COEP désactivée : import dynamique Three/GSAP depuis jsDelivr + WebGL sinon souvent bloqués */
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: true,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  dnsPrefetchControl: { allow: false },
  frameguard: { action: 'deny' },
  hidePoweredBy: true,
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  ieNoOpen: true,
  noSniff: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  xssFilter: true
};

// ARCHITECT-PRIME: les domaines de PROD sont hardcodés ici, jamais lus depuis l'env.
// Raison : un typo dans une variable Render avait coupé l'auth de tous les users en avril
// 2026 (CORS_ORIGIN mal écrit → flaynn.tech rejeté → login impossible). Désormais ces
// domaines sont garantis quel que soit l'état de l'env. Ils sont versionnés dans git.
const CANONICAL_PROD_ORIGINS = Object.freeze([
  'https://flaynn.io',    // SaaS API + dashboard (primaire)
  'https://flaynn.tech',  // Ancien domaine SaaS (backward compat)
  'https://flaynn.com',   // Landing investisseurs / page /rejoindre
  'https://flaynn.fr'     // Legacy redirect
]);

// CORS_ORIGIN reste utile pour AJOUTER des origines (preview Vercel, staging…).
// Il ne peut PAS retirer un canonical. Lu à chaque requête pour qu'un changement
// dashboard s'applique sans redeploy.
function buildAllowlist() {
  const set = new Set(CANONICAL_PROD_ORIGINS);
  const raw = process.env.CORS_ORIGIN;
  if (raw) {
    for (const part of raw.split(',')) {
      const trimmed = part.trim();
      if (trimmed) set.add(trimmed);
    }
  }
  return set;
}

function prodOriginCheck(origin, cb) {
  // Requêtes server-to-server / curl / health checks sans header Origin → autorisées
  if (!origin) return cb(null, true);
  if (buildAllowlist().has(origin)) return cb(null, true);
  return cb(new Error(`Origin not allowed by CORS: ${origin}`), false);
}

export const corsConfig = {
  origin: process.env.NODE_ENV === 'production' ? prodOriginCheck : true,
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Flaynn-Source'],
  credentials: true
};
