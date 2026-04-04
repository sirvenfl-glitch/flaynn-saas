function n8nConnectOrigin() {
  const u = process.env.N8N_SCORE_WEBHOOK_URL;
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
      scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://api.fontshare.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://api.fontshare.com", "https://cdn.fontshare.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: [
        "'self'", 
        'https://cdn.jsdelivr.net', 
        'https://fonts.googleapis.com', 
        'https://api.fontshare.com', 
        'https://fonts.gstatic.com', 
        'https://cdn.fontshare.com',
        ...n8nConnectOrigin()
      ],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: []
    }
  },
  /* COEP désactivée : import dynamique Three/GSAP depuis jsDelivr + WebGL sinon souvent bloqués */
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: true,
  crossOriginResourcePolicy: true,
  dnsPrefetchControl: { allow: false },
  frameguard: { action: 'deny' },
  hidePoweredBy: true,
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  ieNoOpen: true,
  noSniff: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  xssFilter: true
};

const prodOrigin = process.env.CORS_ORIGIN || 'https://flaynn.fr';

export const corsConfig = {
  origin: process.env.NODE_ENV === 'production' ? prodOrigin : 'http://localhost:3000',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Flaynn-Source'],
  credentials: true
};
