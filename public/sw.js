// ARCHITECT-PRIME: Stratégie de cache différenciée par type de ressource.
// HTML → Network First (toujours chercher la version fraîche, cache = fallback offline).
// Assets (CSS/JS/images) → Stale-While-Revalidate (réponse instantanée depuis le cache,
// mise à jour en arrière-plan pour la prochaine visite).
const CACHE_VERSION = 18;
const CACHE_NAME = `flaynn-v${CACHE_VERSION}`;

const PRECACHE_URLS = [
  '/',
  '/manifest.json',
  '/favicon.svg',
  '/defaut.css',
  '/script.js',
  '/js/transition.js',
  '/js/landing-motion.js',
  '/js/starfield.js',
  '/js/mini-score.js',
  '/scoring/',
  '/auth/',
  '/auth/app.js',
  '/auth/auth.css',
  '/dashboard/',
  '/dashboard/app.js',
  '/dashboard/dashboard.css'
];

// —— Install : pré-cache des ressources critiques ———————————————
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// —— Activate : purge des anciens caches + prise de contrôle immédiate ——
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// —— Fetch : stratégie par type de contenu ————————————————————————
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // ARCHITECT-PRIME: on laisse le navigateur gérer les CDN externes.
  // Sinon le SW intercepte les fontes cross-origin et amplifie les erreurs CSP.
  if (
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/')
  ) {
    return;
  }

  // HTML (navigations) : Network First
  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Assets (CSS, JS, images, fonts, manifest) : Stale-While-Revalidate
  // Lancer le fetch réseau immédiatement (en parallèle avec la lecture cache)
  const networkUpdate = fetch(event.request)
    .then((response) => {
      if (response.ok && response.type === 'basic') {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
      }
      return response;
    })
    .catch(() => null);

  // Garder le fetch réseau actif même après la réponse depuis le cache
  event.waitUntil(networkUpdate);

  event.respondWith(
    caches.match(event.request)
      .then((cached) => cached || networkUpdate)
      .then((response) => response || new Response('', { status: 503, statusText: 'Offline' }))
  );
});

// —— Network First (HTML) ———————————————————————————————————————
async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline : servir depuis le cache, ou la page d'accueil en dernier recours
    return (await cache.match(request)) || cache.match('/');
  }
}
