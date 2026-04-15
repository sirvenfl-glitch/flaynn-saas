/**
 * GSAP + ScrollTrigger — chargement à la demande (UMD jsDelivr) pour tier 2+
 */

export function loadGsapBundle() {
  if (window.gsap && window.ScrollTrigger) {
    window.gsap.registerPlugin(window.ScrollTrigger);
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const a = document.createElement('script');
    a.src = 'https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js';
    a.onload = () => {
      const b = document.createElement('script');
      b.src = 'https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js';
      b.onload = () => {
        const gsap = window.gsap;
        const ST = window.ScrollTrigger;
        if (!gsap || !ST) {
          reject(new Error('GSAP ou ScrollTrigger indisponible après chargement'));
          return;
        }
        gsap.registerPlugin(ST);
        resolve();
      };
      b.onerror = () => reject(new Error('ScrollTrigger'));
      document.head.appendChild(b);
    };
    a.onerror = () => reject(new Error('gsap'));
    document.head.appendChild(a);
  });
}

export function initMorphGsap(gsap, el, phrases) {
  if (!el || !phrases?.length || !gsap) return;
  let i = 0;
  const tick = () => {
    i = (i + 1) % phrases.length;
    const next = phrases[i];
    gsap
      .timeline()
      .to(el, { opacity: 0, y: -10, duration: 0.35, ease: 'power2.in' })
      .add(() => {
        el.textContent = next;
      })
      .fromTo(el, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.45, ease: 'power3.out' });
  };
  window.setInterval(tick, 4000);
}

export function initScrollReveal(gsap) {
  const ST = window.ScrollTrigger;
  if (!ST || !gsap) return;
  gsap.registerPlugin(ST);
  gsap.utils.toArray('[data-animate="reveal"]').forEach((section) => {
    const children = section.querySelectorAll('[data-animate-child]');
    if (!children.length) return;
    gsap.from(children, {
      scrollTrigger: {
        trigger: section,
        start: 'top 85%',
        toggleActions: 'play none none none',
        onEnter: () => {
          section.querySelectorAll('.pillar-fill, .showcase-pillar-fill').forEach(b => b.classList.add('animate'));
        }
      },
      y: 36,
      opacity: 0,
      stagger: 0.1,
      duration: 0.75,
      ease: 'power3.out'
    });
  });
}

export function initGsapScoreCounters(gsap) {
  gsap.utils.toArray('[data-score]').forEach((el) => {
    const target = Number.parseInt(el.dataset.score, 10);
    if (Number.isNaN(target)) return;
    const obj = { val: 0 };
    el.textContent = '0';
    gsap.to(obj, {
      val: target,
      scrollTrigger: {
        trigger: el,
        start: 'top 80%',
        toggleActions: 'play none none none'
      },
      duration: 1.8,
      ease: 'power2.out',
      onUpdate: () => {
        const v = Math.round(obj.val);
        el.textContent = String(v);
        const r = v / 100;
        el.style.color =
          r < 0.4 ? 'var(--accent-rose)' : r < 0.7 ? 'var(--accent-amber)' : 'var(--accent-emerald)';
      }
    });
  });
}
