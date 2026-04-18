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

// ARCHITECT-PRIME: allowlist multi-origines (flaynn.tech = SaaS, flaynn.com = investors landing,
// flaynn.fr = legacy). CORS_ORIGIN peut surcharger via CSV en prod.
// Defaults inclus pour résister à un déploiement sans variable correctement set
// (le pire serait de bloquer le frontend en silence — ici on garantit au minimum
// les domaines connus, et toute origine non-listée reste rejetée).
const DEFAULT_PROD_ORIGINS = [
  'https://flaynn.tech',
  'https://flaynn.com',
  'https://flaynn.fr'
];

function parseOriginList(raw) {
  if (!raw) return DEFAULT_PROD_ORIGINS;
  return raw.split(',').map((o) => o.trim()).filter(Boolean);
}

const prodAllowlist = parseOriginList(process.env.CORS_ORIGIN);

function prodOriginCheck(origin, cb) {
  // Requêtes server-to-server / curl / health checks sans header Origin → autorisées
  if (!origin) return cb(null, true);
  if (prodAllowlist.includes(origin)) return cb(null, true);
  return cb(new Error(`Origin not allowed by CORS: ${origin}`), false);
}

export const corsConfig = {
  origin: process.env.NODE_ENV === 'production' ? prodOriginCheck : true,
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Flaynn-Source'],
  credentials: true
};
