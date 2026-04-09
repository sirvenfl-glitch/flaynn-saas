/**
 * ARCHITECT-PRIME: "The Void Shutter" — Page Transition System
 *
 * Intercepte tous les liens internes, joue une animation iris (clip-path circle)
 * avec l'icone Flaynn au centre, puis redirige. Au DOMContentLoaded, l'animation
 * inverse revele la page avec un effet de profondeur Z (scale 1.04 -> 1).
 *
 * Utilise GSAP si disponible (tier 2+), sinon fallback Web Animations API.
 * Ne casse pas le smooth scroll (liens #hash exclus).
 */

const DURATION_OUT = 0.5;
const DURATION_IN  = 0.6;
const EASE_OUT     = 'expo.out';
const EASE_IN      = 'expo.inOut';

const overlay = document.getElementById('page-transition-overlay');
const wing    = overlay?.querySelector('.transition-wing');

// ── Helpers ──────────────────────────────────────────────────────────────────

function isInternalLink(link) {
  if (!link || !link.href) return false;
  const href = link.getAttribute('href');
  if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return false;
  if (link.target === '_blank') return false;
  try {
    const url = new URL(link.href, location.origin);
    return url.origin === location.origin && url.pathname !== location.pathname;
  } catch { return false; }
}

/** ARCHITECT-PRIME: Cible le <main> ou le premier conteneur de contenu */
function getPageContent() {
  return document.querySelector('main') || document.querySelector('.page') || document.body;
}

// ── Animation OUT (page exit) ────────────────────────────────────────────────

function animateOut(targetUrl) {
  if (!overlay) { window.location.href = targetUrl; return; }

  overlay.classList.add('is-active');
  const content = getPageContent();

  // GSAP path (preferred)
  if (window.gsap) {
    const tl = window.gsap.timeline({
      onComplete: () => { window.location.href = targetUrl; }
    });

    // ARCHITECT-PRIME: Le contenu recule dans la profondeur avant l'iris
    tl.to(content, {
      scale: 0.96,
      opacity: 0.4,
      filter: 'blur(4px)',
      duration: DURATION_OUT * 0.7,
      ease: 'power3.in',
      transformOrigin: '50% 50%'
    }, 0)
    .to(overlay, {
      clipPath: 'circle(120% at 50% 50%)',
      duration: DURATION_OUT,
      ease: EASE_OUT
    }, 0.05)
    .to(wing, {
      opacity: 1,
      scale: 1,
      filter: 'drop-shadow(0 0 24px rgba(232, 101, 26, 0.6))',
      duration: 0.35,
      ease: 'back.out(1.4)'
    }, 0.1)
    .to(wing, {
      filter: 'drop-shadow(0 0 40px rgba(139, 92, 246, 0.4))',
      scale: 1.05,
      duration: 0.3,
      ease: 'sine.inOut',
      yoyo: true,
      repeat: 1
    }, 0.3);

    return;
  }

  // Fallback: Web Animations API
  content.animate(
    [
      { transform: 'scale(1)', opacity: 1, filter: 'blur(0px)' },
      { transform: 'scale(0.96)', opacity: 0.4, filter: 'blur(4px)' }
    ],
    { duration: DURATION_OUT * 700, easing: 'cubic-bezier(0.55, 0, 1, 0.45)', fill: 'forwards' }
  );

  overlay.animate(
    [
      { clipPath: 'circle(0% at 50% 50%)' },
      { clipPath: 'circle(120% at 50% 50%)' }
    ],
    { duration: DURATION_OUT * 1000, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'forwards' }
  );

  if (wing) {
    wing.animate(
      [
        { opacity: 0, transform: 'scale(0.7)' },
        { opacity: 1, transform: 'scale(1)' }
      ],
      { duration: 350, delay: 100, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)', fill: 'forwards' }
    );
  }

  setTimeout(() => { window.location.href = targetUrl; }, DURATION_OUT * 1000 + 50);
}

// ── Animation IN (page reveal — profondeur Z) ─────────────────────────────

function animateIn() {
  if (!overlay) return;

  // Start fully covered
  overlay.style.clipPath = 'circle(120% at 50% 50%)';
  overlay.classList.add('is-active');
  if (wing) {
    wing.style.opacity = '1';
    wing.style.transform = 'scale(1)';
  }

  // ARCHITECT-PRIME: Le contenu commence agrandi (profondeur Z) et atterrit a scale(1)
  const content = getPageContent();
  content.style.transform = 'scale(1.04)';
  content.style.opacity = '0';
  content.style.willChange = 'transform, opacity';

  if (window.gsap) {
    const tl = window.gsap.timeline({
      onComplete: () => {
        overlay.classList.remove('is-active');
        overlay.style.clipPath = 'circle(0% at 50% 50%)';
        if (wing) { wing.style.opacity = '0'; wing.style.transform = 'scale(0.7)'; wing.style.filter = ''; }
        content.style.willChange = '';
      }
    });

    // Phase 1 : l'iris se retire + le wing disparait
    tl.to(wing, {
      opacity: 0,
      scale: 0.6,
      duration: 0.25,
      ease: 'power2.in'
    }, 0)
    .to(overlay, {
      clipPath: 'circle(0% at 50% 50%)',
      duration: DURATION_IN,
      ease: EASE_IN
    }, 0.1)
    // Phase 2 : le contenu atterrit en douceur (ouverture App iOS)
    .to(content, {
      scale: 1,
      opacity: 1,
      duration: 0.7,
      ease: 'power4.out',
      transformOrigin: '50% 50%'
    }, 0.15);

    return;
  }

  // Fallback
  if (wing) {
    wing.animate(
      [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.6)' }],
      { duration: 250, easing: 'ease-in', fill: 'forwards' }
    );
  }

  overlay.animate(
    [
      { clipPath: 'circle(120% at 50% 50%)' },
      { clipPath: 'circle(0% at 50% 50%)' }
    ],
    { duration: DURATION_IN * 1000, delay: 100, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'forwards' }
  ).onfinish = () => {
    overlay.classList.remove('is-active');
    overlay.style.clipPath = 'circle(0% at 50% 50%)';
    if (wing) { wing.style.opacity = '0'; wing.style.transform = 'scale(0.7)'; }
  };

  // ARCHITECT-PRIME: Fallback profondeur Z via Web Animations API
  content.animate(
    [
      { transform: 'scale(1.04)', opacity: 0 },
      { transform: 'scale(1)', opacity: 1 }
    ],
    { duration: 700, delay: 150, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'forwards' }
  ).onfinish = () => {
    content.style.transform = '';
    content.style.opacity = '';
    content.style.willChange = '';
  };
}

// ── Link interception ────────────────────────────────────────────────────────

document.addEventListener('click', (e) => {
  // ARCHITECT-PRIME: ne pas intercepter si un autre handler a deja prevenu le default
  if (e.defaultPrevented) return;

  const link = e.target.closest('a[href]');
  if (!isInternalLink(link)) return;

  // Ne pas intercepter les liens /dashboard/ (geres par warpNavigate dans script.js)
  // ni les liens SPA dashboard router
  const href = link.getAttribute('href');
  if (href && href.startsWith('/dashboard')) return;
  if (link.hasAttribute('data-route')) return;

  e.preventDefault();
  animateOut(link.href);
});

// ── Page reveal on load ──────────────────────────────────────────────────────

// ARCHITECT-PRIME: only reveal if coming from a transition (sessionStorage flag)
if (sessionStorage.getItem('flaynn_transition')) {
  sessionStorage.removeItem('flaynn_transition');
  animateIn();
}

// ARCHITECT-PRIME: failsafe — si l'overlay reste bloqué plus de 4s, on force le nettoyage
// Empêche le scroll/navigation d'être bloqué par une transition ratée
function clearOverlayFailsafe() {
  if (!overlay) return;
  if (overlay.classList.contains('is-active')) {
    overlay.classList.remove('is-active');
    overlay.style.clipPath = 'circle(0% at 50% 50%)';
    if (wing) { wing.style.opacity = '0'; wing.style.transform = 'scale(0.7)'; wing.style.filter = ''; }
  }
  const content = getPageContent();
  if (content) {
    content.style.transform = '';
    content.style.opacity = '';
    content.style.filter = '';
    content.style.willChange = '';
  }
  document.documentElement.style.overflow = '';
  document.body.style.overflow = '';
}

// Nettoyage au chargement — garantit qu'aucune transition precedente ne reste
window.addEventListener('load', () => {
  setTimeout(clearOverlayFailsafe, 2000);
});

// ARCHITECT-PRIME: set sessionStorage flag in capture phase (before preventDefault)
document.addEventListener('click', (e) => {
  const link = e.target.closest('a[href]');
  if (isInternalLink(link) && !link.hasAttribute('data-route')) {
    sessionStorage.setItem('flaynn_transition', '1');
  }
}, true); // capture phase, runs before the prevent default handler
