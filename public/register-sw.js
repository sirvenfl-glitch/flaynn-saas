/**
 * Enregistrement SW + PWA install prompt
 */
const SW_URL = '/sw.js';
const SW_SCOPE = '/';
const SW_CACHE_VERSION = 'flaynn-cache-v5';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(SW_URL, { scope: SW_SCOPE })
      .catch(() => {});
  });
}

// PWA install prompt — capture l'événement et propose l'installation
let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;

  // Affiche un bouton d'installation discret après 30s
  setTimeout(() => {
    if (!deferredPrompt) return;
    const banner = document.createElement('div');
    banner.className = 'pwa-install-banner';
    banner.setAttribute('role', 'alert');

    const text = document.createElement('span');
    text.className = 'pwa-install-banner__text';
    text.textContent = 'Installer Flaynn sur votre appareil';

    const btn = document.createElement('button');
    btn.className = 'pwa-install-banner__btn';
    btn.textContent = 'Installer';
    btn.addEventListener('click', async () => {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      banner.remove();
    });

    const close = document.createElement('button');
    close.className = 'pwa-install-banner__close';
    close.setAttribute('aria-label', 'Fermer');
    close.textContent = '\u00D7';
    close.addEventListener('click', () => banner.remove());

    banner.appendChild(text);
    banner.appendChild(btn);
    banner.appendChild(close);
    document.body.appendChild(banner);

    requestAnimationFrame(() => banner.classList.add('is-visible'));
  }, 30000);
});
