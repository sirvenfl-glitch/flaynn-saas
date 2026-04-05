/**
 * Flaynn — landing (vanilla, pas d'innerHTML pour données dynamiques)
 */

const MORPH_PHRASES = [
  'avant la diligence.',
  'avec des données.',
  'sans storytelling creux.'
];

function initMorph(el) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let i = 0;
  window.setInterval(() => {
    i = (i + 1) % MORPH_PHRASES.length;
    el.textContent = MORPH_PHRASES[i];
  }, 4000);
}

function initScoreCounter(el) {
  const raw = el.dataset?.score ?? el.textContent.trim();
  const target = Number.parseInt(raw, 10);
  if (Number.isNaN(target)) return;
  let n = 0;
  const step = () => {
    n = Math.min(target, n + Math.max(1, Math.ceil((target - n) / 10)));
    el.textContent = String(n);
    if (n < target) window.requestAnimationFrame(step);
  };
  window.requestAnimationFrame(step);
}

/**
 * IntersectionObserver natif pour simuler GSAP ScrollTrigger (Fade In & Slide Up)
 */
function initNativeScrollReveal() {
  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-revealed');
        obs.unobserve(entry.target); // Ne s'anime qu'une seule fois
      }
    });
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0 });

  document.querySelectorAll('[data-animate="reveal"]').forEach(section => {
    section.querySelectorAll('[data-animate-child]').forEach((child, index) => {
      child.classList.add('reveal-native');
      child.style.transitionDelay = `${index * 100}ms`; // Effet stagger (cascade)
      observer.observe(child);
    });
  });
}

function scrollToId(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const focusable = el.querySelector('input, button, select, textarea');
  if (focusable) window.setTimeout(() => focusable.focus(), 400);
}

function showToast(root, message, variant) {
  if (!root) return;
  const t = document.createElement('div');
  t.className = `toast toast--${variant}`;
  t.setAttribute('role', 'alert');
  t.textContent = message;
  root.appendChild(t);
  window.requestAnimationFrame(() => {
    t.classList.add('is-visible');
  });
  window.setTimeout(() => {
    t.classList.remove('is-visible');
    window.setTimeout(() => t.remove(), 300);
  }, 4200);
}

function buildSuccessView(reference) {
  const wrap = document.createElement('div');
  wrap.className = 'form-success-inner';

  const icon = document.createElement('div');
  icon.className = 'form-success__icon';
  icon.setAttribute('aria-hidden', 'true');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '32');
  svg.setAttribute('height', '32');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'var(--accent-emerald)');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('d', 'M5 13l4 4L19 7');
  svg.appendChild(path);
  icon.appendChild(svg);

  const title = document.createElement('h3');
  title.className = 'form-success__title';
  title.textContent = 'Scoring enregistré';

  const text = document.createElement('p');
  text.className = 'form-success__text';
  text.textContent =
    'Nous analysons votre dossier. Vous recevrez une synthèse sous 24h ouvrées à l’adresse indiquée.';

  const ref = document.createElement('p');
  ref.className = 'form-success__ref';
  ref.textContent = `Référence : ${reference}`;

  const auth = (() => {
    try { return JSON.parse(localStorage.getItem('flaynn_auth') || 'null'); } catch { return null; }
  })();

  const cta = document.createElement('a');
  cta.className = 'btn-primary btn-inline form-success__cta';
  if (auth) {
    cta.href = `/dashboard/?id=${encodeURIComponent(reference)}`;
    cta.textContent = 'Voir mon analyse';
  } else {
    cta.href = `/auth/#register`;
    cta.textContent = 'Créer un compte pour suivre mon analyse';
  }

  wrap.appendChild(icon);
  wrap.appendChild(title);
  wrap.appendChild(text);
  wrap.appendChild(ref);
  wrap.appendChild(cta);
  return wrap;
}

class ScoringFormController {
  constructor(form) {
    this.form = form;
    this.currentStep = 1;
    this.totalSteps = 3;
    this.toastRoot = document.getElementById('toast-root');
    this.successEl = document.getElementById('form-success');
    this.progressFill = document.getElementById('progress-fill');
    this.stepLabel = document.getElementById('step-current');
    this.#bind();
    this.#initChips();
    this.#updateProgress();
    this.#updateStepButtons();
  }

  #bind() {
    this.form.querySelectorAll('.field__input').forEach((input) => {
      input.addEventListener('input', () => this.#validateField(input, false));
      input.addEventListener('blur', () => this.#validateField(input, true));
    });

    this.form.querySelector('#stage')?.addEventListener('input', () => {
      const h = this.form.querySelector('#stage');
      if (h) this.#validateField(h, false);
    });

    this.form.querySelector('#sector')?.addEventListener('change', () => {
      const s = this.form.querySelector('#sector');
      if (s) this.#validateField(s, false);
    });

    this.form.querySelectorAll('.btn-form--next').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = Number(btn.getAttribute('data-next'), 10);
        if (!this.#validateStep(this.currentStep, true)) return;
        this.#goToStep(next);
      });
    });

    this.form.querySelectorAll('.btn-form--ghost').forEach((btn) => {
      btn.addEventListener('click', () => {
        const back = Number(btn.getAttribute('data-back'), 10);
        this.#goToStep(back);
      });
    });

    this.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.#submit();
    });
  }

  #initChips() {
    this.form.querySelectorAll('.field__chips').forEach((group) => {
      group.querySelectorAll('.chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          // Liquid UX: Retour haptique natif sur les boutons tactiles
          if (typeof navigator.vibrate === 'function') {
            navigator.vibrate(15);
          }

          group.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-checked', 'false'));
          chip.setAttribute('aria-checked', 'true');
          const hidden = group.parentElement.querySelector('input[type="hidden"][name="stage"]');
          if (hidden) {
            hidden.value = chip.dataset.value || '';
            hidden.dispatchEvent(new Event('input', { bubbles: true }));
          }
          this.#updateStepButtons();
        });
      });
    });
  }

  #validateField(input, showError, skipButtonUpdate = false) {
    const field = input.closest('.field');
    if (!field || !field.dataset.validate) return true;
    if (input.type === 'hidden' && input.id !== 'stage') return true;
    const rules = field.dataset.validate.split('|');
    const value = input.value.trim();
    let error = '';

    for (const rule of rules) {
      if (rule === 'required' && !value) {
        error = 'Ce champ est requis.';
        break;
      }
      if (rule.startsWith('min:') && value.length < Number(rule.split(':')[1])) {
        error = `Minimum ${rule.split(':')[1]} caractères.`;
        break;
      }
      if (rule.startsWith('max:') && value.length > Number(rule.split(':')[1])) {
        error = `Maximum ${rule.split(':')[1]} caractères.`;
        break;
      }
      if (rule === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        error = 'Email invalide.';
        break;
      }
      if (rule === 'urlopt' && value) {
        try {
          new URL(value);
        } catch {
          error = 'URL invalide.';
          break;
        }
      }
      if (rule === 'numopt' && value) {
        const n = Number(value);
        if (!Number.isFinite(n)) {
          error = 'Nombre invalide.';
          break;
        }
      }
    }

    field.classList.toggle('field--valid', !error && !!value);
    field.classList.toggle('field--error', !!error && showError);
    const errEl = field.querySelector('.field__error');
    if (errEl) errEl.textContent = showError ? error : '';
    
    if (!skipButtonUpdate) this.#updateStepButtons();
    
    return !error;
  }

  #validateStep(step, showError) {
    const container = this.form.querySelector(`.form-step[data-step="${step}"]`);
    if (!container) return false;
    let ok = true;
    container.querySelectorAll('.field__input, input[type="hidden"]').forEach((input) => {
      if (input.type === 'hidden' && input.name === 'stage') {
        const field = input.closest('.field');
        if (field && field.dataset.validate?.includes('required') && !input.value.trim()) {
          ok = false;
          if (showError) {
            field.classList.add('field--error');
            const errEl = field.querySelector('.field__error');
            if (errEl) errEl.textContent = 'Sélectionnez un stade.';
          }
        }
        return;
      }
      if (!this.#validateField(input, showError, true)) ok = false;
    });
    return ok;
  }

  #updateStepButtons() {
    const step = this.form.querySelector(`.form-step[data-step="${this.currentStep}"]`);
    if (!step) return;

    if (this.currentStep === 3) {
      const email = this.form.querySelector('#email');
      const submitBtn = this.form.querySelector('#btn-submit');
      if (email && submitBtn) {
        const ok = this.#validateField(email, false, true);
        submitBtn.disabled = !ok;
      }
      return;
    }

    const nextBtn = step.querySelector('.btn-form--next');
    if (!nextBtn) return;
    const valid = this.#validateStep(this.currentStep, false);
    nextBtn.disabled = !valid;
  }

  #goToStep(target) {
    if (target < 1 || target > this.totalSteps) return;
    const currentEl = this.form.querySelector(`.form-step[data-step="${this.currentStep}"]`);
    const nextEl = this.form.querySelector(`.form-step[data-step="${target}"]`);
    if (!currentEl || !nextEl) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion || currentEl === nextEl || typeof currentEl.animate !== 'function') {
      this.#swapStepDom(target, currentEl, nextEl);
      const f = nextEl.querySelector('.field__input, .chip');
      if (f) f.focus();
      return;
    }

    const forward = target > this.currentStep;
    const exitX = forward ? -18 : 18;
    const enterX = forward ? 22 : -22;
    const easing = 'cubic-bezier(0.16, 1, 0.3, 1)';

    const exitAnim = currentEl.animate(
      [
        { opacity: 1, transform: 'translateX(0)' },
        { opacity: 0, transform: `translateX(${exitX}px)` }
      ],
      { duration: 280, easing, fill: 'both' }
    );

    exitAnim.finished
      .then(() => {
        exitAnim.cancel();
        this.#swapStepDom(target, currentEl, nextEl);
        const enterAnim = nextEl.animate(
          [
            { opacity: 0, transform: `translateX(${enterX}px)` },
            { opacity: 1, transform: 'translateX(0)' }
          ],
          { duration: 320, easing, fill: 'both' }
        );
        return enterAnim.finished.then(() => {
          enterAnim.cancel();
          const first = nextEl.querySelector('.field__input, .chip');
          if (first) first.focus();
        });
      })
      .catch(() => {
        this.#swapStepDom(target, currentEl, nextEl);
        const f = nextEl.querySelector('.field__input, .chip');
        if (f) f.focus();
      });
  }

  #swapStepDom(target, currentEl, nextEl) {
    currentEl.classList.remove('is-active');
    currentEl.hidden = true;
    currentEl.classList.add('is-hidden');

    nextEl.hidden = false;
    nextEl.classList.remove('is-hidden');
    nextEl.classList.add('is-active');

    this.currentStep = target;
    this.#updateProgress();
    this.#updateStepButtons();
  }

  #updateProgress() {
    if (this.progressFill) {
      this.progressFill.style.width = `${(this.currentStep / this.totalSteps) * 100}%`;
    }
    if (this.stepLabel) {
      this.stepLabel.textContent = String(this.currentStep);
    }
    const dots = this.form.closest('.scoring-form-wrap')
      ?.querySelectorAll('.progress-dot');
    if (dots) {
      dots.forEach((dot, i) => {
        dot.classList.toggle('progress-dot--active', i < this.currentStep);
      });
    }
  }

  async #submit() {
    if (!this.#validateStep(3, true)) return;

    const btn = this.form.querySelector('#btn-submit');
    const label = btn?.querySelector('.btn-form__text');
    if (btn) btn.disabled = true;
    if (label) label.textContent = 'Envoi…';

    const payload = {
      startup_name: this.form.querySelector('#startup-name')?.value.trim() ?? '',
      sector: this.form.querySelector('#sector')?.value ?? '',
      stage: this.form.querySelector('#stage')?.value ?? '',
      pitch: this.form.querySelector('#pitch')?.value.trim() ?? '',
      email: this.form.querySelector('#email')?.value.trim() ?? ''
    };

    const urlVal = this.form.querySelector('#url')?.value.trim() ?? '';
    if (urlVal) payload.url = urlVal;

    const rev = this.form.querySelector('#revenue_monthly')?.value.trim() ?? '';
    if (rev !== '') payload.revenue_monthly = Number(rev);

    const team = this.form.querySelector('#team_size')?.value.trim() ?? '';
    if (team !== '') payload.team_size = Number(team);

    try {
      const res = await fetch('/api/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Flaynn-Source': 'web-form' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20000)
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (data.error === 'VALIDATION_FAILED' && data.details) {
          // Liquid UX: Affichage dynamique des erreurs Zod (Zero innerHTML)
          for (const [key, msgs] of Object.entries(data.details)) {
            const input = this.form.querySelector(`[name="${key}"]`);
            if (input) {
              const field = input.closest('.field');
              if (field) {
                field.classList.add('field--error');
                const errEl = field.querySelector('.field__error');
                if (errEl) errEl.textContent = msgs[0];
              }
            }
          }
          throw new Error('Veuillez corriger les erreurs surlignées.');
        }
        throw new Error(data.message || 'Service temporairement indisponible.');
      }

      const ref = data.reference || '—';
      this.form.classList.add('is-hidden');
      this.form.hidden = true;
      if (this.successEl) {
        this.successEl.replaceChildren();
        this.successEl.appendChild(buildSuccessView(ref));
        this.successEl.hidden = false;
        this.successEl.classList.remove('is-hidden');
        this.successEl.focus();
      }
    } catch (err) {
      showToast(this.toastRoot, err.message || 'Erreur réseau.', 'error');
      if (btn) btn.disabled = false;
      if (label) label.textContent = 'Soumettre';
    }
  }
}

function getDeviceTier() {
  const mem = typeof navigator.deviceMemory === 'number' ? navigator.deviceMemory : 4;
  const conn = navigator.connection;
  const ect = conn?.effectiveType || '4g';
  if (conn?.saveData || ect === '2g' || ect === 'slow-2g') return 1;
  if (mem <= 2 || ect === '3g') return 2;
  return 3;
}

window.__FLAYNN_TIER = getDeviceTier();

async function bootDeferred() {
  const tier = window.__FLAYNN_TIER;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const morphEl = document.querySelector('.js-morph-text');
  const counterEl = document.querySelector('[data-score]');

  // CSS scroll reveal fonctionne sur TOUS les tiers (pas besoin de GSAP)
  if (!reduced) {
    initNativeScrollReveal();
  }

  if (reduced) {
    if (counterEl) {
      const t = Number.parseInt(counterEl.dataset.score || counterEl.textContent, 10);
      if (!Number.isNaN(t)) {
        counterEl.textContent = String(t);
        const r = t / 100;
        counterEl.style.color =
          r < 0.4 ? 'var(--accent-rose)' : r < 0.7 ? 'var(--accent-amber)' : 'var(--accent-emerald)';
      }
    }
  } else if (tier >= 2) {
    try {
      const { loadGsapBundle, initMorphGsap, initScrollReveal, initGsapScoreCounters } = await import(
        './js/landing-motion.js'
      );
      await loadGsapBundle();
      const gsap = window.gsap;
      if (morphEl) initMorphGsap(gsap, morphEl, MORPH_PHRASES);
      initScrollReveal(gsap);
      initGsapScoreCounters(gsap);
    } catch {
      if (morphEl) initMorph(morphEl);
      if (counterEl) initScoreCounter(counterEl);
      initNativeScrollReveal(); // Fallback si GSAP échoue
    }
  } else {
    // Tier 1 : animations legeres CSS-only (pas de GSAP, pas de Three.js)
    if (morphEl) initMorph(morphEl);
    if (counterEl) initScoreCounter(counterEl);
    if (!reduced) {
      initNativeScrollReveal(); // Appareil bas de gamme (Tier 1) mais sans reduced-motion
    }
  }

  const debugThree = new URLSearchParams(window.location.search).get('debug_three') === '1';
  /* Three.js : tier 2 = léger (cf. .md), tier 3 = dense */
  if ((tier >= 2 || debugThree) && !reduced) {
    try {
      const { FlaynnNeuralBackground } = await import('./js/three-neural.js');
      const canvas = document.getElementById('bg-canvas');
      if (canvas) {
        const particles = debugThree ? 1200 : tier >= 3 ? 2800 : 600;
        /* Exposé globalement pour que triggerWarpTransition soit accessible
           depuis les intercepteurs de navigation ci-dessous.
           @type {any} — cast intentionnel, propriété custom sur window */
        /** @type {any} */ (window).globalBg = new FlaynnNeuralBackground(canvas, { particles });
      }
    } catch {
      /* WebGL / module indisponible : fond CSS (.ambient-bg) */
    }
  }

  const scoringFormSection = document.getElementById('scoring-form');
  const scoringForm =
    scoringFormSection?.querySelector('form') || document.getElementById('scoring-form-form');
  if (scoringForm instanceof HTMLFormElement) {
    new ScoringFormController(scoringForm);
  }
}

document.getElementById('footer-year').textContent = String(new Date().getFullYear());

/* ── Nav auth state : Espace membre (invité) ou Prénom (connecté) ─ */
(function updateNavAuth() {
  const auth = (() => {
    try { return JSON.parse(localStorage.getItem('flaynn_auth') || 'null'); } catch { return null; }
  })();
  const guestLink = document.getElementById('nav-auth-guest');
  const userLink = /** @type {HTMLAnchorElement|null} */ (document.getElementById('nav-member-link'));
  const memberName = document.getElementById('nav-member-name');
  const mobileGuest = document.getElementById('nav-mobile-auth-guest');
  const mobileUser = /** @type {HTMLAnchorElement|null} */ (document.getElementById('nav-mobile-member'));

  if (auth) {
    if (guestLink) guestLink.hidden = true;
    if (mobileGuest) mobileGuest.hidden = true;
    if (userLink) {
      userLink.hidden = false;
      if (memberName) memberName.textContent = auth.name ? String(auth.name).split(' ')[0] : 'Mon espace';
    }
    if (mobileUser) {
      mobileUser.hidden = false;
      mobileUser.textContent = auth.name ? String(auth.name).split(' ')[0] : 'Mon espace';
    }
  } else {
    if (guestLink) guestLink.hidden = false;
    if (mobileGuest) mobileGuest.hidden = false;
    if (userLink) userLink.hidden = true;
    if (mobileUser) mobileUser.hidden = true;
  }
})();

/* ── Warp navigation : intercepte les liens vers /dashboard/ ───────────── */
/**
 * Affiche l'overlay glassmorphism + déclenche le warp Three.js.
 * Si globalBg n'est pas disponible (WebGL absent / tier 1),
 * la navigation se fait normalement sans effet.
 * @param {string} targetUrl
 * @param {Event}  e
 */
function warpNavigate(targetUrl, e) {
  e.preventDefault();

  const overlay = document.getElementById('page-transition-overlay');
  if (overlay) overlay.classList.add('is-active');

  const bg = /** @type {any} */ (window).globalBg;
  if (bg && typeof bg.triggerWarpTransition === 'function') {
    bg.triggerWarpTransition(targetUrl);
  } else {
    /* Fallback : redirection directe après l'apparition de l'overlay */
    window.setTimeout(() => { window.location.href = targetUrl; }, 300);
  }
}

/* Sélecteur large : capture tous les liens pointant vers /dashboard/ */
document.addEventListener('click', (e) => {
  const link = e.target.closest('a[href]');
  if (!link) return;
  const href = link.getAttribute('href');
  if (href && (href.startsWith('/dashboard') || href === '/dashboard/')) {
    warpNavigate(href, e);
  }
});

document.getElementById('btn-header-cta')?.addEventListener('click', () => scrollToId('scoring-form'));
document.getElementById('btn-hero-cta')?.addEventListener('click', () => scrollToId('scoring-form'));
document.getElementById('btn-sticky-cta')?.addEventListener('click', () => scrollToId('scoring-form'));
document.getElementById('btn-mobile-cta')?.addEventListener('click', () => {
  closeMobileMenu();
  scrollToId('scoring-form');
});

// ── Collapsing header on scroll ──────────────────────────────────────────────
const navGlass = document.querySelector('.nav-glass');
if (navGlass) {
  let lastScroll = 0;
  const onScroll = () => {
    const y = window.scrollY;
    navGlass.classList.toggle('is-scrolled', y > 60);
    lastScroll = y;
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

// ── View Transition API — smooth page transitions ──────────────────────────
document.addEventListener('click', (e) => {
  const link = e.target.closest('a[href]');
  if (!link || !link.href) return;
  const url = new URL(link.href, location.origin);
  if (url.origin !== location.origin || url.pathname === location.pathname) return;
  if (link.getAttribute('href').startsWith('#')) return;
  if (!document.startViewTransition) return;
  e.preventDefault();
  document.startViewTransition(() => {
    window.location.href = link.href;
  });
});

// ── Nav mobile ──────────────────────────────────────────────────────────────
function openMobileMenu() {
  const btn = document.getElementById('nav-hamburger');
  const menu = document.getElementById('nav-mobile-menu');
  if (!btn || !menu) return;
  menu.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  document.body.style.overflow = 'hidden';
  window.requestAnimationFrame(() => menu.removeAttribute('hidden'));
}

function closeMobileMenu() {
  const btn = document.getElementById('nav-hamburger');
  const menu = document.getElementById('nav-mobile-menu');
  if (!btn || !menu) return;
  btn.setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
  menu.hidden = true;
}

document.getElementById('nav-hamburger')?.addEventListener('click', () => {
  const isOpen = document.getElementById('nav-hamburger')?.getAttribute('aria-expanded') === 'true';
  if (isOpen) closeMobileMenu();
  else openMobileMenu();
});

document.getElementById('nav-mobile-menu')?.querySelectorAll('.nav-mobile-link').forEach((link) => {
  link.addEventListener('click', () => closeMobileMenu());
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMobileMenu();
});

// ── Bottom nav mobile — active section tracking + CTA ───────────────────────
document.getElementById('btn-bnav-cta')?.addEventListener('click', () => scrollToId('scoring-form'));

// Active link tracking via IntersectionObserver
(function initBnavTracking() {
  const links = document.querySelectorAll('.landing-bnav__link[data-section]');
  if (!links.length) return;

  const sectionMap = {
    hero: document.querySelector('.hero'),
    pillars: document.getElementById('pillars'),
    investors: document.getElementById('investors'),
  };

  const setActive = (id) => {
    links.forEach(l => l.classList.toggle('is-active', l.dataset.section === id));
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        for (const [key, el] of Object.entries(sectionMap)) {
          if (el === entry.target) { setActive(key); break; }
        }
      }
    });
  }, { rootMargin: '-30% 0px -60% 0px', threshold: 0 });

  for (const el of Object.values(sectionMap)) {
    if (el) observer.observe(el);
  }

  // Update auth link si connecte
  const auth = (() => {
    try { return JSON.parse(localStorage.getItem('flaynn_auth') || 'null'); } catch { return null; }
  })();
  const bnavAuth = document.getElementById('bnav-auth-link');
  if (bnavAuth && auth) {
    bnavAuth.href = '/dashboard/';
    const span = bnavAuth.querySelector('span');
    if (span) span.textContent = auth.name ? String(auth.name).split(' ')[0] : 'Compte';
  }
})();

// ── Gestionnaire de Modales Vanilla JS ──────────────────────────────────────
function initModals() {
  const overlays = document.querySelectorAll('.modal-overlay');
  const triggers = document.querySelectorAll('.js-modal-trigger');
  const closes = document.querySelectorAll('.js-modal-close');

  function openModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.add('is-active');
    document.body.style.overflow = 'hidden'; // Bloque le scroll derrière la modale

    // Relance l'animation d'apparition fluide (Liquid UX) à chaque ouverture
    const children = modal.querySelectorAll('[data-animate-child]');
    children.forEach(c => {
      c.classList.remove('is-revealed');
      c.classList.add('reveal-native');
    });
    void modal.offsetWidth; // Force le reflow du navigateur
    children.forEach((c, i) => {
      c.style.transitionDelay = `${i * 60}ms`;
      c.classList.add('is-revealed');
    });
  }

  function closeModal() {
    overlays.forEach(m => {
      m.classList.remove('is-active');
      m.querySelectorAll('[data-animate-child]').forEach(c => c.classList.remove('is-revealed'));
    });
    document.body.style.overflow = '';
  }

  triggers.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      openModal(btn.getAttribute('href').replace('#', ''));
    });
  });
  closes.forEach(btn => btn.addEventListener('click', closeModal));
  overlays.forEach(overlay => overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); }));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
}

function initLiquidUX() {
  const setMouseFromEvent = (el, e) => {
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
    el.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
  };

  // 1. Glow magnétique : cartes glass, champs, wrappers .field (bordure scoring)
  const applyGlow = () => {
    document.querySelectorAll('.card-glass, .field__input, .scoring-form .field').forEach((el) => {
      if (el.dataset.glowBound) return;
      el.dataset.glowBound = 'true';
      const move = (e) => setMouseFromEvent(el, e);
      el.addEventListener('mousemove', move, { passive: true });
      el.addEventListener('touchmove', move, { passive: true });
    });
  };
  applyGlow();
  const observer = new MutationObserver(() => applyGlow());
  observer.observe(document.body, { childList: true, subtree: true });

  // 2. Spring scale (0.97) pour JS dynamically injected elements
  const interactives = 'button.modal-close, .js-modal-close';
  document.addEventListener('pointerdown', (e) => {
    const t = e.target.closest(interactives);
    if (t && !t.disabled) { t.style.transform = 'scale(0.92)'; t.style.transition = 'transform 0.1s ease'; }
  });
  const reset = (e) => {
    const t = e.target.closest(interactives);
    if (t) { t.style.transform = ''; t.style.transition = 'transform 0.4s cubic-bezier(0.34,1.56,0.64,1)'; }
  };
  document.addEventListener('pointerup', reset);
  document.addEventListener('pointercancel', reset);
  document.addEventListener('pointerout', reset);

  // 3. Flash discret sur saisie (complète le focus ring CSS)
  document.addEventListener('input', (e) => {
    if (e.target.matches('.field__input')) {
      e.target.animate(
        [
          { boxShadow: '0 0 0 4px rgba(139, 92, 246, 0.28)' },
          { boxShadow: '0 0 0 0px rgba(139, 92, 246, 0)' }
        ],
        { duration: 350, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
      );
    }
  });
}

function initBarReveal() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.querySelectorAll('.pillar-score-bar, .bento-pillar-track').forEach(el => el.classList.add('is-revealed'));
    return;
  }
  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-revealed');
        obs.unobserve(entry.target);
      }
    });
  }, { rootMargin: '0px 0px -5% 0px', threshold: 0 });

  document.querySelectorAll('.pillar-score-bar, .bento-pillar-track, .score-ring-wrap').forEach(el => observer.observe(el));
}

/**
 * Live Scoring — anime en permanence les donnees du bento
 * avec des variations aleatoires pour simuler des analyses en temps reel.
 */
function initLiveScoring() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const circ = 2 * Math.PI * 50; // circumference du score ring (r=50)

  // Refs bento
  const scoreArc = document.querySelector('.score-ring__arc');
  const scoreValue = document.querySelector('.score-value');
  const tamMetric = document.querySelector('.bento-metric--blue');
  const tractionMetric = document.querySelector('.bento-metric--emerald');
  const sparklineSvg = document.querySelector('.bento-sparkline svg');
  const pillarFills = document.querySelectorAll('.bento-pillar-fill');
  const pillarScores = document.querySelectorAll('.bento-pillar-score');
  const pillarBarFills = document.querySelectorAll('.pillar-score-bar__fill');

  // Ranges par pilier: [min, max]
  const pillarRanges = [
    [75, 95],  // Market
    [60, 85],  // Product
    [78, 98],  // Traction
    [70, 92],  // Team
    [55, 80],  // Execution
  ];

  const tamValues = ['€1.8B', '€2.1B', '€2.4B', '€2.9B', '€3.2B', '€1.5B', '€4.1B'];
  const tractionValues = ['+12% MoM', '+15% MoM', '+18% MoM', '+22% MoM', '+9% MoM', '+27% MoM', '+14% MoM'];

  function rand(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function getScoreColor(score) {
    if (score < 40) return 'var(--accent-rose)';
    if (score < 70) return 'var(--accent-amber)';
    return 'var(--accent-emerald)';
  }

  function getScoreLabel(score) {
    if (score >= 85) return 'Tres fort potentiel';
    if (score >= 70) return 'Potentiel eleve';
    if (score >= 55) return 'Potentiel confirme';
    return 'En progression';
  }

  // Anime un nombre de `from` a `to` sur `duration` ms
  function animateNumber(el, from, to, duration) {
    if (!el) return;
    const start = performance.now();
    const step = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic
      el.textContent = String(Math.round(from + (to - from) * ease));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // Genere des points de sparkline aleatoires
  function randomSparkline() {
    const pts = [];
    let y = rand(14, 22);
    for (let x = 0; x <= 80; x += 16) {
      y = Math.max(2, Math.min(26, y + rand(-6, -1)));
      pts.push(`${x},${y}`);
    }
    return pts.join(' ');
  }

  let currentGlobal = 92;
  let currentPillars = [88, 76, 92, 84, 70];

  function tick() {
    // Score global
    const newGlobal = rand(62, 97);
    if (scoreArc) {
      const offset = circ - (newGlobal / 100) * circ;
      scoreArc.setAttribute('stroke-dashoffset', String(offset));
      scoreArc.setAttribute('stroke', getScoreColor(newGlobal));
    }
    animateNumber(scoreValue, currentGlobal, newGlobal, 1200);
    if (scoreValue) scoreValue.style.color = getScoreColor(newGlobal);
    currentGlobal = newGlobal;

    // Label
    const titleEl = document.querySelector('.bento-score-title');
    if (titleEl) titleEl.textContent = getScoreLabel(newGlobal);

    // TAM
    if (tamMetric) tamMetric.textContent = tamValues[rand(0, tamValues.length - 1)];

    // Traction
    if (tractionMetric) tractionMetric.textContent = tractionValues[rand(0, tractionValues.length - 1)];

    // TAM bar
    const tamBar = document.querySelector('.bento-bar-mini__fill');
    if (tamBar) tamBar.style.width = `${rand(45, 88)}%`;

    // Sparkline
    if (sparklineSvg) {
      const polyline = sparklineSvg.querySelector('polyline');
      if (polyline) polyline.setAttribute('points', randomSparkline());
    }

    // Bento pillar bars + scores
    pillarFills.forEach((fill, i) => {
      const [min, max] = pillarRanges[i] || [50, 90];
      const newScore = rand(min, max);
      fill.style.setProperty('--w', `${newScore}%`);
      fill.style.width = `${newScore}%`;
      if (pillarScores[i]) {
        animateNumber(pillarScores[i], currentPillars[i], newScore, 1000);
        currentPillars[i] = newScore;
      }
    });

    // Landing pillar card bars
    pillarBarFills.forEach((fill) => {
      const newWidth = rand(55, 96);
      fill.style.setProperty('--bar-width', `${newWidth}%`);
      fill.style.width = `${newWidth}%`;
    });
  }

  // Observer: ne demarre que quand le bento est visible
  const bentoSection = document.querySelector('.bento-section');
  if (!bentoSection) return;

  let intervalId = null;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && !intervalId) {
        tick();
        intervalId = setInterval(tick, 3500);
      } else if (!entry.isIntersecting && intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    });
  }, { threshold: 0.1 });

  observer.observe(bentoSection);
}

const scheduleIdle = (fn) => {
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(fn, { timeout: 2000 });
  } else {
    window.setTimeout(fn, 200);
  }
};
scheduleIdle(() => {
  void bootDeferred();
  initLiquidUX();
  initModals();
  initBarReveal();
  initLiveScoring();
});

// PWA: Enregistrement du Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service Worker non enregistré:', err);
    });
  });
}
