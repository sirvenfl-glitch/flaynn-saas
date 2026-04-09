/**
 * Enregistrement SW + détection de mise à jour + PWA install prompt
 */
const SW_URL = '/sw.js';
const SW_SCOPE = '/';

if ('serviceWorker' in navigator) {
  // ARCHITECT-PRIME: auto-reload quand un nouveau SW prend le contrôle.
  // Le nouveau SW appelle skipWaiting() + clients.claim(), ce qui déclenche
  // controllerchange sur les onglets ouverts. Le guard `refreshing` empêche
  // les boucles de reload infinies.
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });

      // Vérifier les mises à jour du SW toutes les 30 minutes
      // (en complément de la vérification automatique du navigateur à chaque navigation)
      setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
    } catch {
      // Dégradation gracieuse : le site fonctionne sans SW
    }
  });
}

// PWA install prompt disabled - manifest/SW kept for caching/SEO
