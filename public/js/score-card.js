// FLAYNN SCORE CARD — Delta 9 J6
// Wiring JS minimal pour la page publique /score/:slug.
// Scope : bouton "Copier le lien" (data-action="copy-link").
// Pas d'analytics, pas de fetch — chargé en defer, zéro impact LCP.

(function () {
  'use strict';

  const btn = document.querySelector('[data-action="copy-link"]');
  if (!btn) return;

  const originalLabel = btn.textContent;

  async function copyCurrentUrl() {
    const url = window.location.href;

    // 1) navigator.clipboard si disponible et contexte sécurisé (HTTPS ou localhost).
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(url);
        return true;
      } catch {
        /* fallback ci-dessous */
      }
    }

    // 2) Fallback execCommand pour navigateurs anciens / pages HTTP.
    const ta = document.createElement('textarea');
    ta.value = url;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }

  btn.addEventListener('click', async () => {
    const ok = await copyCurrentUrl();
    btn.textContent = ok ? 'Lien copié ✓' : 'Sélectionnez l\u2019URL';
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = originalLabel;
      btn.disabled = false;
    }, 2000);
  });
})();
