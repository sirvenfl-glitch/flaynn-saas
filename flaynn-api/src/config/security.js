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

export const helmetConfig = {
  contentSecurityPolicy: {
    directives: {
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
    }
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
// 2026 (CORS_ORIGIN mal écrit → flaynn.tech rejeté → login impossible). Désormais ces 3
// domaines sont garantis quel que soit l'état de l'env. Ils sont versionnés dans git.
const CANONICAL_PROD_ORIGINS = Object.freeze([
  'https://flaynn.tech',  // SaaS API + dashboard
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
