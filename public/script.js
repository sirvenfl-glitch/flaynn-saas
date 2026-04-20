/**
 * Flaynn — landing (vanilla, pas d'innerHTML pour données dynamiques)
 */

const MORPH_PHRASES = [
  'Start Proving.',
  'Prouvez-le.',
  'Obtenez votre verdict.',
  'Passez le filtre.',
  'Start Proving.',
];

// ARCHITECT-PRIME: Anti copy-paste validation — Jaccard similarity on word sets
function similarityRatio(a, b) {
  if (!a || !b) return 0;
  const normalize = s => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const na = normalize(a), nb = normalize(b);
  if (na === nb) return 1;
  const setA = new Set(na.split(' ')), setB = new Set(nb.split(' '));
  const intersection = [...setA].filter(w => setB.has(w)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

function initMorph(el) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let i = 0;
  let running = false;

  function morphTo(text) {
    if (running) return;
    running = true;

    // Phase 1 : fade out les lettres actuelles
    const currentLetters = el.querySelectorAll('.morph-letter');
    if (currentLetters.length) {
      // ARCHITECT-PRIME: un seul reflow pour toutes les lettres (pas dans la boucle)
      currentLetters.forEach((l) => { l.style.animation = 'none'; });
      void el.offsetHeight; // un seul reflow batché
      currentLetters.forEach((l, idx) => {
        l.style.transition = `opacity 0.15s ease ${idx * 15}ms, transform 0.15s ease ${idx * 15}ms, filter 0.15s ease ${idx * 15}ms`;
        l.style.opacity = '0';
        l.style.transform = 'translateY(-8px) scale(0.7)';
        l.style.filter = 'blur(3px)';
      });
    }

    const fadeOutTime = currentLetters.length ? Math.min(currentLetters.length * 15 + 150, 350) : 0;

    setTimeout(() => {
      // Vider le conteneur
      el.replaceChildren();

      // Phase 2 : créer les nouvelles lettres + particules
      for (let c = 0; c < text.length; c++) {
        const ch = text[c];
        const span = document.createElement('span');
        span.className = 'morph-letter';
        span.textContent = ch === ' ' ? '\u00A0' : ch;
        span.style.animationDelay = `${c * 30}ms`;
        el.appendChild(span);

        // Particules (2-3 par lettre, sauf espaces)
        if (ch !== ' ' && ch !== '.') {
          const count = Math.floor(Math.random() * 2) + 2;
          for (let p = 0; p < count; p++) {
            const particle = document.createElement('span');
            particle.className = 'morph-particle';
            // Position de départ aléatoire autour de la lettre
            const px = (Math.random() - 0.5) * 60;
            const py = (Math.random() - 0.5) * 40 - 10;
            particle.style.setProperty('--px', `${px}px`);
            particle.style.setProperty('--py', `${py}px`);
            particle.style.left = `${(c / text.length) * 100}%`;
            particle.style.top = '50%';
            particle.style.animationDelay = `${c * 25 + p * 40}ms`;
            // Couleur aléatoire parmi les accents
            const colors = ['var(--accent-violet)', 'var(--accent-blue)', 'rgba(255,255,255,0.7)'];
            particle.style.background = colors[Math.floor(Math.random() * colors.length)];
            particle.style.boxShadow = `0 0 6px ${colors[Math.floor(Math.random() * colors.length)]}`;
            el.appendChild(particle);
          }
        }
      }

      // Nettoyage particules après animation
      setTimeout(() => {
        el.querySelectorAll('.morph-particle').forEach(p => p.remove());
        running = false;
      }, text.length * 30 + 600);

    }, fadeOutTime);
  }

  // Init : afficher la première phrase
  morphTo(MORPH_PHRASES[0]);

  // Cycle toutes les 3.2s (20% plus rapide que 4s)
  setInterval(() => {
    i = (i + 1) % MORPH_PHRASES.length;
    morphTo(MORPH_PHRASES[i]);
  }, 3200);
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
        entry.target.querySelectorAll('.pillar-fill, .showcase-pillar-fill').forEach(b => b.classList.add('animate'));
        obs.unobserve(entry.target); // Ne s'anime qu'une seule fois
      }
    });
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0 });

  document.querySelectorAll('[data-animate="reveal"]').forEach(section => {
    section.querySelectorAll('[data-animate-child]').forEach((child, index) => {
      child.classList.add('reveal-native');
      child.style.transitionDelay = `${index * 60}ms`; // Effet stagger (cascade)
      observer.observe(child);
    });
  });
}

function scrollToId(id) {
  const el = document.getElementById(id);
  if (!el) return;
  // Offset pour la nav fixe (4rem — 64px)
  const navHeight = document.querySelector('.nav-glass')?.offsetHeight || 64;
  const top = el.getBoundingClientRect().top + window.scrollY - navHeight - 16;
  window.scrollTo({ top, behavior: 'smooth' });
  const focusable = el.querySelector('input, button, select, textarea');
  if (focusable) window.setTimeout(() => focusable.focus(), 500);
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
    'Nous analysons votre dossier. Vous recevrez une synthèse sous 24h ouvrées à l\u2019adresse indiquée.';

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
    cta.href = '/auth/';
    cta.textContent = 'Se connecter pour suivre mon analyse';
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
    this.currentStep = 0;
    this.totalSteps = 8;
    this.toastRoot = document.getElementById('toast-root');
    this.successEl = document.getElementById('form-success');
    this.progressFill = document.getElementById('progress-fill');
    this.stepLabel = document.getElementById('step-current');
    this.#bind();
    this.#initChips();
    this.#initLabelBadges();
    this.#initResubmitToggle();
    this.#initCharCounters();
    this.#initSegmentClienteleConditional();
    this.#initDraftAutosave();
    this.#updateProgress();
    this.#updateStepButtons();
  }

  #bind() {
    this.form.querySelectorAll('.field__input').forEach((input) => {
      input.addEventListener('input', () => this.#validateField(input, false));
      input.addEventListener('blur', () => this.#validateField(input, true));
    });

    // Tous les hidden inputs (chips) déclenchent la validation au changement
    this.form.querySelectorAll('input[type="hidden"]').forEach((h) => {
      h.addEventListener('input', () => this.#validateField(h, false));
    });

    // Tous les selects déclenchent la validation au changement
    this.form.querySelectorAll('select').forEach((s) => {
      s.addEventListener('change', () => this.#validateField(s, false));
    });

    // Toggle revenus oui/non — affiche MRR + clients si oui, message pré-revenus si non.
    const revenusInput = this.form.querySelector('#revenus');
    if (revenusInput) {
      revenusInput.addEventListener('input', () => {
        const details = this.form.querySelector('#revenus-details');
        const preBlock = this.form.querySelector('#pre-revenus-block');
        const val = revenusInput.value;
        if (details) details.hidden = val !== 'oui';
        if (preBlock) preBlock.hidden = val !== 'non';
      });
    }

    this.form.querySelectorAll('.btn-form--next').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = Number(btn.getAttribute('data-next'), 10);
        if (!this.#validateStep(this.currentStep, true)) return;
        if (!this.#checkSimilarity(this.currentStep)) return;
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

    // ARCHITECT-PRIME: Secteur — free-form input with datalist autocomplete.
    // Normalise à chaque frappe en slug ASCII ([a-z0-9-]) et propage dans le hidden #secteur.
    const secteurInput = this.form.querySelector('#secteur_input');
    const secteurHidden = this.form.querySelector('#secteur');
    if (secteurInput && secteurHidden) {
      // ARCHITECT-PRIME: slugification — accents → ASCII, lowercase, tout caractère
      // hors [a-z0-9-] supprimé (espaces compris). Le user type "Health Tech Ω !" →
      // "healthtech". Les tirets explicites saisis par l'utilisateur sont conservés.
      const slugify = (raw) => {
        return String(raw || '')
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '')
          .replace(/-+/g, '-')
          .replace(/^-+|-+$/g, '');
      };
      const syncSecteur = () => {
        secteurHidden.value = slugify(secteurInput.value);
        secteurHidden.dispatchEvent(new Event('input', { bubbles: true }));
      };
      secteurInput.addEventListener('input', syncSecteur);
      secteurInput.addEventListener('change', syncSecteur); // datalist pick
    }

    // ARCHITECT-PRIME: Custom dark dropdowns (unified style, no native OS selects)
    this.form.querySelectorAll('[data-custom-dropdown]').forEach((dropdown) => {
      const trigger = dropdown.querySelector('.custom-dropdown__trigger');
      const textEl = dropdown.querySelector('.custom-dropdown__text');
      const list = dropdown.querySelector('[role="listbox"]');
      const hiddenInput = dropdown.parentElement.querySelector('input[type="hidden"]');
      if (!trigger || !list || !hiddenInput) return;
      const items = Array.from(list.querySelectorAll('[role="option"]'));

      const open = () => {
        list.hidden = false;
        dropdown.setAttribute('aria-expanded', 'true');
        trigger.setAttribute('aria-expanded', 'true');
      };
      const close = () => {
        list.hidden = true;
        dropdown.setAttribute('aria-expanded', 'false');
        trigger.setAttribute('aria-expanded', 'false');
      };

      trigger.addEventListener('click', () => {
        if (list.hidden) open(); else close();
      });

      items.forEach((item) => {
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          items.forEach(i => i.removeAttribute('aria-selected'));
          item.setAttribute('aria-selected', 'true');
          hiddenInput.value = item.dataset.value;
          if (textEl) textEl.textContent = item.textContent;
          trigger.setAttribute('data-filled', 'true');
          close();
          hiddenInput.dispatchEvent(new Event('input', { bubbles: true }));
          this.#updateStepButtons();
        });
      });

      trigger.addEventListener('blur', () => { setTimeout(close, 150); });

      trigger.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { close(); trigger.blur(); }
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (list.hidden) open(); else close();
        }
        if (e.key === 'ArrowDown' && !list.hidden) {
          e.preventDefault();
          const current = list.querySelector('[aria-selected="true"]');
          const next = current ? current.nextElementSibling : items[0];
          if (next) next.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        }
        if (e.key === 'ArrowUp' && !list.hidden) {
          e.preventDefault();
          const current = list.querySelector('[aria-selected="true"]');
          const prev = current ? current.previousElementSibling : items[items.length - 1];
          if (prev) prev.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        }
      });
    });

    // ARCHITECT-PRIME: TAM + Levée — slider + input libre bidirectionnel.
    // Le hidden `#tam_amount` / `#levee_amount` est la source de vérité envoyée au back
    // (format regex /^\d+(\.\d+)?(K|M|Md)?€?$/). Slider → snap vers stop prédéfini,
    // input libre → snap log-proche côté slider (affichage uniquement) + hidden brut.
    const UNIT_FACTORS = { K: 1e3, M: 1e6, Md: 1e9 };
    const amountToEur = (amount, unit) => {
      const n = Number(amount);
      if (!Number.isFinite(n) || n <= 0) return NaN;
      return n * (UNIT_FACTORS[unit] || 1);
    };
    const formatNumber = (n) => {
      const rounded = Math.round(n * 100) / 100;
      return String(rounded).replace(/\.?0+$/, ''); // strip trailing zeros
    };
    const labelFor = (amount, unit) => `~${formatNumber(amount)}${unit}€`;
    const normalizedFor = (amount, unit) => `${formatNumber(amount)}${unit}`;

    const setupRangeWithInput = ({ rangeId, hiddenId, floatId, valueInputId, unitInputId, stops }) => {
      const range = this.form.querySelector(`#${rangeId}`);
      const hidden = this.form.querySelector(`#${hiddenId}`);
      const floatLabel = this.form.querySelector(`#${floatId}`);
      const valueInput = this.form.querySelector(`#${valueInputId}`);
      const unitInput = this.form.querySelector(`#${unitInputId}`);
      if (!range || !hidden || !valueInput || !unitInput) return;

      // ARCHITECT-PRIME: flag anti-boucle — le slider met à jour les inputs
      // sans déclencher de re-snap (et inversement).
      let suppressEcho = false;

      const snapRangeToEur = (eur) => {
        if (!Number.isFinite(eur) || eur <= 0) return 0;
        const logE = Math.log10(eur);
        let bestIdx = 0;
        let bestDist = Infinity;
        stops.forEach((stop, i) => {
          const stopEur = amountToEur(stop.amount, stop.unit);
          const dist = Math.abs(Math.log10(stopEur) - logE);
          if (dist < bestDist) { bestDist = dist; bestIdx = i; }
        });
        return bestIdx;
      };

      const applyAmountUnit = (amount, unit, { fromRange = false } = {}) => {
        if (!Number.isFinite(amount) || amount <= 0) return;
        hidden.value = normalizedFor(amount, unit);
        if (floatLabel) {
          floatLabel.textContent = labelFor(amount, unit);
          const idx = Number(range.value);
          const max = Number(range.max) || 1;
          const pct = (idx / max) * 100;
          const clampedPct = Math.max(8, Math.min(92, pct));
          floatLabel.style.left = `${clampedPct}%`;
        }
        range.setAttribute('aria-valuenow', range.value);
        range.setAttribute('aria-valuetext', labelFor(amount, unit));
        if (!fromRange) {
          // Écho vers valeurs affichées uniquement depuis le côté input libre
        } else {
          suppressEcho = true;
          valueInput.value = formatNumber(amount);
          unitInput.value = unit;
          suppressEcho = false;
        }
        hidden.dispatchEvent(new Event('input', { bubbles: true }));
        this.#updateStepButtons();
      };

      const onRangeInput = () => {
        const idx = Number(range.value);
        const stop = stops[idx] || stops[0];
        applyAmountUnit(stop.amount, stop.unit, { fromRange: true });
      };

      const onAmountInput = () => {
        if (suppressEcho) return;
        const raw = valueInput.value.trim();
        if (raw === '') return; // slider reste source de vérité si vide
        const amount = Number(raw.replace(',', '.'));
        const unit = unitInput.value || 'M';
        if (!Number.isFinite(amount) || amount <= 0) return;
        const eur = amountToEur(amount, unit);
        if (!Number.isFinite(eur)) return;
        const idx = snapRangeToEur(eur);
        suppressEcho = true;
        range.value = String(idx);
        suppressEcho = false;
        applyAmountUnit(amount, unit);
      };

      range.addEventListener('input', onRangeInput);
      valueInput.addEventListener('input', onAmountInput);
      unitInput.addEventListener('change', onAmountInput);
      onRangeInput(); // init hidden + label
    };

    setupRangeWithInput({
      rangeId: 'tam_range',
      hiddenId: 'tam_amount',
      floatId: 'tam-float-label',
      valueInputId: 'tam_amount_value',
      unitInputId: 'tam_amount_unit',
      stops: [
        { amount: 100, unit: 'K' },
        { amount: 500, unit: 'K' },
        { amount: 1,   unit: 'M' },
        { amount: 5,   unit: 'M' },
        { amount: 10,  unit: 'M' },
        { amount: 50,  unit: 'M' },
        { amount: 100, unit: 'M' },
        { amount: 500, unit: 'M' },
        { amount: 1,   unit: 'Md' },
        { amount: 5,   unit: 'Md' },
        { amount: 10,  unit: 'Md' },
      ],
    });

    setupRangeWithInput({
      rangeId: 'levee_range',
      hiddenId: 'levee_amount',
      floatId: 'levee-float-label',
      valueInputId: 'levee_amount_value',
      unitInputId: 'levee_amount_unit',
      stops: [
        { amount: 25,  unit: 'K' },
        { amount: 50,  unit: 'K' },
        { amount: 100, unit: 'K' },
        { amount: 150, unit: 'K' },
        { amount: 250, unit: 'K' },
        { amount: 500, unit: 'K' },
        { amount: 750, unit: 'K' },
        { amount: 1,   unit: 'M' },
        { amount: 1.5, unit: 'M' },
        { amount: 2,   unit: 'M' },
        { amount: 3,   unit: 'M' },
        { amount: 5,   unit: 'M' },
        { amount: 10,  unit: 'M' },
        { amount: 20,  unit: 'M' },
        { amount: 50,  unit: 'M' },
      ],
    });

    // Pitch deck file upload — base64 conversion
    // ARCHITECT-PRIME: Pitch deck upload — PDF uniquement (requis)
    const ALLOWED_DECK_TYPES = ['application/pdf'];
    const ALLOWED_DECK_EXTENSIONS = ['.pdf'];
    // Extra docs still accept PDF, PPTX, DOCX
    const ALLOWED_DOC_TYPES = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    const ALLOWED_EXTENSIONS = ['.pdf', '.pptx', '.docx'];

    function isPdfFile(file) {
      if (ALLOWED_DECK_TYPES.includes(file.type)) return true;
      const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
      return ALLOWED_DECK_EXTENSIONS.includes(ext);
    }

    function isAllowedFile(file) {
      if (ALLOWED_DOC_TYPES.includes(file.type)) return true;
      const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
      return ALLOWED_EXTENSIONS.includes(ext);
    }

    function fileIcon(name) {
      const ext = name.toLowerCase().slice(name.lastIndexOf('.'));
      if (ext === '.pdf') return '\u{1F4C4}';
      if (ext === '.pptx') return '\u{1F4CA}';
      if (ext === '.docx') return '\u{1F4DD}';
      return '\u{1F4CE}';
    }

    function formatSize(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    // ARCHITECT-PRIME: POLISH 10 — extraction best-effort du nombre de pages d'un PDF
    // sans dépendance externe. On décode en latin1 et on compte les occurrences
    // "/Type /Page" (pas "/Pages"). Les PDFs avec objets compressés (objet stream)
    // peuvent retourner 0 ou une valeur incomplète — on skip silencieusement.
    async function extractPdfPageCount(file) {
      if (!file || file.size > 15 * 1024 * 1024) return null;
      try {
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        const text = new TextDecoder('latin1').decode(bytes);
        const matches = text.match(/\/Type\s*\/Page[^s]/g);
        return matches && matches.length > 0 ? matches.length : null;
      } catch { return null; }
    }

    const fileInput = this.form.querySelector('#pitch_deck_file');
    if (fileInput) {
      const preview = this.form.querySelector('#pitch-deck-preview');
      fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        const b64Input = this.form.querySelector('#pitch_deck_base64');
        const nameInput = this.form.querySelector('#pitch_deck_filename');
        const errEl = fileInput.closest('.field')?.querySelector('.field__error');

        if (!file) {
          if (b64Input) b64Input.value = '';
          if (nameInput) nameInput.value = '';
          if (preview) preview.hidden = true;
          return;
        }

        if (!isPdfFile(file)) {
          if (errEl) errEl.textContent = 'Le pitch deck doit être au format PDF.';
          fileInput.closest('.field')?.classList.add('field--error');
          fileInput.value = '';
          return;
        }

        if (file.size > 25 * 1024 * 1024) {
          if (errEl) errEl.textContent = 'Fichier trop volumineux (max 25 MB).';
          fileInput.value = '';
          return;
        }

        if (errEl) errEl.textContent = '';
        fileInput.closest('.field')?.classList.remove('field--error');
        fileInput.closest('.field')?.classList.add('field--valid');
        if (preview) {
          const iconEl = preview.querySelector('.file-preview__icon');
          const nameEl = preview.querySelector('.file-preview__name');
          if (iconEl) iconEl.textContent = fileIcon(file.name);
          if (nameEl) nameEl.textContent = `${file.name} · ${formatSize(file.size)}`;
          preview.hidden = false;
        }

        // Best-effort page count (asynchrone, n'aligne pas la soumission)
        extractPdfPageCount(file).then((pages) => {
          if (!pages || !preview || preview.hidden) return;
          const nameEl = preview.querySelector('.file-preview__name');
          if (!nameEl) return;
          nameEl.textContent = `${file.name} · ${formatSize(file.size)} · ${pages} page${pages > 1 ? 's' : ''}`;
        });

        const reader = new FileReader();
        reader.onload = () => {
          const base64 = reader.result.split(',')[1];
          if (b64Input) b64Input.value = base64;
          if (nameInput) nameInput.value = file.name;
          this.#updateStepButtons();
        };
        reader.readAsDataURL(file);
      });
    }

    // ARCHITECT-PRIME: Extra docs dropzone with drag-and-drop
    const dropzone = this.form.querySelector('#extra-docs-dropzone');
    const extraInput = this.form.querySelector('#extra_docs_files');
    const extraList = this.form.querySelector('#extra-docs-list');
    if (dropzone && extraInput && extraList) {
      this._extraFiles = [];

      const renderExtraFiles = () => {
        extraList.replaceChildren();
        this._extraFiles.forEach((file, idx) => {
          const li = document.createElement('li');
          li.className = 'dropzone__file-item';

          const icon = document.createElement('span');
          icon.setAttribute('aria-hidden', 'true');
          icon.textContent = fileIcon(file.name);

          const name = document.createElement('span');
          name.className = 'dropzone__file-name';
          name.textContent = file.name;

          const size = document.createElement('span');
          size.className = 'dropzone__file-size';
          size.textContent = formatSize(file.size);

          const removeBtn = document.createElement('button');
          removeBtn.type = 'button';
          removeBtn.className = 'dropzone__file-remove';
          removeBtn.setAttribute('aria-label', `Retirer ${file.name}`);
          removeBtn.textContent = '\u2715';
          removeBtn.addEventListener('click', () => {
            this._extraFiles.splice(idx, 1);
            renderExtraFiles();
          });

          li.appendChild(icon);
          li.appendChild(name);
          li.appendChild(size);
          li.appendChild(removeBtn);
          extraList.appendChild(li);
        });
      };

      const addFiles = (files) => {
        const errEl = dropzone.closest('.field')?.querySelector('.field__error');
        let errorMsg = '';
        for (const file of files) {
          if (!isAllowedFile(file)) {
            errorMsg = `${file.name} : format non accepté (PDF, PPTX, DOCX).`;
            continue;
          }
          if (file.size > 10 * 1024 * 1024) {
            errorMsg = `${file.name} : fichier trop volumineux (max 10 MB).`;
            continue;
          }
          this._extraFiles.push(file);
        }
        if (errEl) errEl.textContent = errorMsg;
        renderExtraFiles();
      };

      dropzone.addEventListener('click', () => extraInput.click());
      dropzone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); extraInput.click(); }
      });
      extraInput.addEventListener('change', () => {
        if (extraInput.files.length) addFiles(Array.from(extraInput.files));
        extraInput.value = '';
      });

      dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('is-dragover'); });
      dropzone.addEventListener('dragleave', () => { dropzone.classList.remove('is-dragover'); });
      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('is-dragover');
        if (e.dataTransfer?.files.length) addFiles(Array.from(e.dataTransfer.files));
      });
    }

    // ARCHITECT-PRIME: URL validation for linkedin/site fields
    this.form.querySelectorAll('[data-validate="urlopt"]').forEach((field) => {
      const input = field.querySelector('.field__input');
      if (!input) return;
      input.addEventListener('blur', () => {
        const val = input.value.trim();
        const errEl = field.querySelector('.field__error');
        if (val && !val.startsWith('https://')) {
          if (errEl) errEl.textContent = 'L\'URL doit commencer par https://';
          field.classList.add('field--error');
        } else if (val) {
          try { new URL(val); if (errEl) errEl.textContent = ''; field.classList.remove('field--error'); }
          catch { if (errEl) errEl.textContent = 'URL invalide.'; field.classList.add('field--error'); }
        } else {
          if (errEl) errEl.textContent = '';
          field.classList.remove('field--error');
        }
      });
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
          // Trouve le hidden input associé au radiogroup (stage, revenus, equipe_temps_plein)
          const hidden = group.parentElement.querySelector('input[type="hidden"]');
          if (hidden) {
            hidden.value = chip.dataset.value || '';
            hidden.dispatchEvent(new Event('input', { bubbles: true }));
          }
          this.#updateStepButtons();
        });
      });
    });
  }

  // ARCHITECT-PRIME: Add Requis/Optionnel micro-badges to all labels
  #initLabelBadges() {
    this.form.querySelectorAll('.field').forEach((field) => {
      // POLISH 16 : certains champs portent l'info "optionnel" dans le label lui-même,
      // un badge serait redondant. data-no-badge skip l'ajout.
      if (field.hasAttribute('data-no-badge')) return;
      const label = field.querySelector('.field__label');
      if (!label) return;
      // Skip if badge already exists
      if (label.querySelector('.field__label-badge')) return;
      const input = field.querySelector('.field__input, input[type="hidden"][required], select[required], textarea[required]');
      const isRequired = field.dataset.validate?.includes('required') || input?.hasAttribute('required');
      // Skip labels that are spans (chip groups — they have their own patterns)
      if (label.tagName === 'SPAN') return;
      const badge = document.createElement('span');
      badge.className = 'field__label-badge';
      badge.textContent = isRequired ? 'Requis' : 'Optionnel';
      label.appendChild(badge);
    });
  }

  #initResubmitToggle() {
    const checkbox = this.form.querySelector('#resubmit_check');
    const field = this.form.querySelector('#previous-ref-field');
    const input = this.form.querySelector('#previous_ref');
    if (!checkbox || !field || !input) return;
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        field.style.display = '';
      } else {
        field.style.display = 'none';
        input.value = '';
      }
    });
  }

  // ARCHITECT-PRIME: live char counters sur tout champ avec data-validate "max:N".
  // S'applique aux textareas et aux input[type=text] (ex: segment_clientele).
  #initCharCounters() {
    this.form.querySelectorAll('[data-validate]').forEach((field) => {
      const rules = (field.dataset.validate || '').split('|');
      const maxRule = rules.find((r) => r.startsWith('max:'));
      if (!maxRule) return;
      const input = field.querySelector('textarea, input[type="text"], input[type="email"]');
      if (!input) return;
      if (field.querySelector('.field__counter')) return;

      const max = Number(maxRule.split(':')[1]);
      if (!Number.isFinite(max) || max <= 0) return;

      const counter = document.createElement('span');
      counter.className = 'field__counter';
      counter.setAttribute('aria-live', 'polite');

      const errEl = field.querySelector('.field__error');
      if (errEl) field.insertBefore(counter, errEl);
      else field.appendChild(counter);

      const warnAt = Math.floor(max * 0.9);
      const update = () => {
        const len = input.value.length;
        counter.textContent = `${len} / ${max}`;
        counter.classList.toggle('field__counter--warning', len >= warnAt && len <= max);
        counter.classList.toggle('field__counter--error', len > max);
      };
      input.addEventListener('input', update);
      update();
      // Stocker pour rafraîchir quand la règle max change dynamiquement (ex: segment_clientele)
      field._flaynnCounterUpdate = update;
    });
  }

  // ARCHITECT-PRIME: MAJEUR 7 — sauvegarde draft localStorage toutes les 5 s.
  // Clé 'flaynn_scoring_draft' = { timestamp, fields: { [id]: value } }. TTL 48 h.
  // Au load : bannière "Reprendre" si draft < 48 h. Skippée si resubmit check +
  // previous_ref déjà actifs à l'ouverture. Effacée après soumission réussie
  // (cf. #clearDraft appelé dans #submit).
  #initDraftAutosave() {
    const DRAFT_KEY = 'flaynn_scoring_draft';
    const DRAFT_TTL_MS = 48 * 60 * 60 * 1000;
    const SKIP_IDS = new Set([
      'pitch_deck_file', 'extra_docs_files',
      'pitch_deck_base64', 'pitch_deck_filename',
    ]);

    const collect = () => {
      const data = {};
      this.form.querySelectorAll('input, textarea, select').forEach((el) => {
        if (!el.id || SKIP_IDS.has(el.id)) return;
        if (el.type === 'file') return;
        if (el.type === 'checkbox') { data[el.id] = el.checked ? '1' : '0'; return; }
        data[el.id] = el.value;
      });
      return data;
    };

    const hasAnyContent = (data) => {
      // Ignorer les valeurs par défaut (sliders à 0, unit par défaut, hidden initialisés).
      const DEFAULTS = {
        tam_range: '0', levee_range: '0',
        tam_amount_unit: 'M', levee_amount_unit: 'K',
        tam_amount: '100K', levee_amount: '25K',
        resubmit_check: '0', revenus: '', equipe_temps_plein: '',
      };
      for (const [k, v] of Object.entries(data)) {
        if (v === '' || v === undefined || v === null) continue;
        if (DEFAULTS[k] !== undefined && DEFAULTS[k] === v) continue;
        return true;
      }
      return false;
    };

    const save = () => {
      try {
        const data = collect();
        if (!hasAnyContent(data)) { localStorage.removeItem(DRAFT_KEY); return; }
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ timestamp: Date.now(), fields: data }));
      } catch { /* quota ou localStorage indisponible */ }
    };

    this._clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch {} };

    const restore = (fields) => {
      // Pass 1 : injection silencieuse.
      for (const [id, val] of Object.entries(fields)) {
        const el = this.form.querySelector('#' + CSS.escape(id));
        if (!el) continue;
        if (el.type === 'checkbox') el.checked = val === '1';
        else el.value = val;
      }
      // Pass 2 : cascades UI.
      const resubmit = this.form.querySelector('#resubmit_check');
      if (resubmit) resubmit.dispatchEvent(new Event('change', { bubbles: true }));

      // Sliders d'abord (initialise hidden depuis stop).
      this.form.querySelectorAll('input[type="range"]').forEach((r) => {
        r.dispatchEvent(new Event('input', { bubbles: true }));
      });
      // Réinjecter amount_value / amount_unit (le slider ci-dessus a pu les overrider
      // via son écho), puis fire input si non-vide (snap depuis l'input libre).
      ['tam_amount_value', 'tam_amount_unit', 'levee_amount_value', 'levee_amount_unit'].forEach((id) => {
        if (fields[id] !== undefined) {
          const el = this.form.querySelector('#' + CSS.escape(id));
          if (el) el.value = fields[id];
        }
      });
      ['tam_amount_value', 'levee_amount_value'].forEach((id) => {
        const el = this.form.querySelector('#' + CSS.escape(id));
        if (el && el.value) el.dispatchEvent(new Event('input', { bubbles: true }));
      });

      // Autres saisies texte : dispatch input pour déclencher validation + compteurs.
      this.form.querySelectorAll('textarea, input[type="text"], input[type="email"], input[type="url"], input[type="number"]').forEach((el) => {
        if (['tam_amount_value', 'levee_amount_value'].includes(el.id)) return; // déjà traité
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });

      // Chips + custom dropdowns : synchro visuelle depuis hidden.
      this.form.querySelectorAll('input[type="hidden"]').forEach((hidden) => {
        if (!hidden.id || !hidden.value) return;
        if (['tam_amount', 'levee_amount', 'secteur'].includes(hidden.id)) {
          hidden.dispatchEvent(new Event('input', { bubbles: true }));
          return;
        }
        const field = hidden.closest('.field');
        if (!field) return;
        field.querySelectorAll('.chip[data-value]').forEach((chip) => {
          chip.setAttribute('aria-checked', chip.dataset.value === hidden.value ? 'true' : 'false');
        });
        const item = field.querySelector(`.custom-dropdown__item[data-value="${CSS.escape(hidden.value)}"]`);
        if (item) {
          field.querySelectorAll('.custom-dropdown__item').forEach((i) => i.removeAttribute('aria-selected'));
          item.setAttribute('aria-selected', 'true');
          const textEl = field.querySelector('.custom-dropdown__text');
          const trigger = field.querySelector('.custom-dropdown__trigger');
          if (textEl) textEl.textContent = item.textContent;
          if (trigger) trigger.setAttribute('data-filled', 'true');
        }
        hidden.dispatchEvent(new Event('input', { bubbles: true }));
      });

      // Révéler MRR / clients si revenus=oui, ou message pré-revenus si revenus=non.
      const revenusInput = this.form.querySelector('#revenus');
      if (revenusInput) {
        const details = this.form.querySelector('#revenus-details');
        const preBlock = this.form.querySelector('#pre-revenus-block');
        const val = revenusInput.value;
        if (details) details.hidden = val !== 'oui';
        if (preBlock) preBlock.hidden = val !== 'non';
      }
      this.#updateStepButtons();
    };

    // Autosave 5 s (setInterval, pas setTimeout récursif — plus simple à stopper).
    this._draftInterval = setInterval(save, 5000);

    // Lecture au boot.
    let envelope = null;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) envelope = JSON.parse(raw);
    } catch { /* JSON corrompu → ignore */ }
    if (!envelope || !envelope.timestamp || !envelope.fields) return;
    if (Date.now() - envelope.timestamp > DRAFT_TTL_MS) { this._clearDraft(); return; }

    // Skip si on est clairement en flow "re-soumets" (checkbox + previous_ref déjà remplis).
    const resubmitCheckbox = this.form.querySelector('#resubmit_check');
    const prevRefInput = this.form.querySelector('#previous_ref');
    if (resubmitCheckbox?.checked && prevRefInput?.value?.trim()) return;

    const ageMs = Date.now() - envelope.timestamp;
    const ageMin = Math.floor(ageMs / 60000);
    const ageLabel = ageMin < 1 ? "il y a moins d'une minute"
      : ageMin < 60 ? `il y a ${ageMin} min`
      : `il y a ${Math.floor(ageMin / 60)} h`;

    this.#showDraftBanner(ageLabel, () => restore(envelope.fields), () => this._clearDraft());
  }

  #showDraftBanner(ageLabel, onRestore, onDismiss) {
    const banner = document.createElement('div');
    banner.className = 'draft-restore-banner card-glass';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');

    const text = document.createElement('p');
    text.className = 'draft-restore-banner__text';
    text.textContent = `Un brouillon de votre dossier existe (${ageLabel}). Reprendre votre saisie ?`;

    const btnRestore = document.createElement('button');
    btnRestore.type = 'button';
    btnRestore.className = 'btn-form btn-form--ghost draft-restore-banner__btn';
    btnRestore.textContent = 'Reprendre';
    btnRestore.addEventListener('click', () => { onRestore(); banner.remove(); });

    const btnDismiss = document.createElement('button');
    btnDismiss.type = 'button';
    btnDismiss.className = 'btn-form btn-form--ghost draft-restore-banner__btn';
    btnDismiss.textContent = 'Effacer';
    btnDismiss.addEventListener('click', () => { onDismiss(); banner.remove(); });

    banner.appendChild(text);
    banner.appendChild(btnRestore);
    banner.appendChild(btnDismiss);

    // Insérer juste au-dessus de la progress bar.
    const progress = this.form.querySelector('.form-progress');
    if (progress && progress.parentElement) {
      progress.parentElement.insertBefore(banner, progress);
    } else {
      this.form.prepend(banner);
    }
  }

  // ARCHITECT-PRIME: segment_clientele devient requis (min 3) quand type_client = "other".
  // Sinon optionnel (max 200). On synchronise data-validate, le badge de label, et on
  // re-valide pour mettre à jour la state des boutons.
  #initSegmentClienteleConditional() {
    const typeHidden = this.form.querySelector('#type_client');
    const field = this.form.querySelector('#segment-clientele-field');
    const input = this.form.querySelector('#segment_clientele');
    const hint = this.form.querySelector('#segment-clientele-hint');
    if (!typeHidden || !field || !input) return;

    const badge = field.querySelector('.field__label-badge');

    const update = () => {
      const isOther = typeHidden.value === 'other';
      field.dataset.validate = isOther ? 'required|min:3|max:200' : 'max:200';
      if (hint) hint.textContent = isOther ? '(requis pour le type de client « Autre »)' : '(optionnel)';
      if (badge) badge.textContent = isOther ? 'Requis' : 'Optionnel';
      this.#validateField(input, false);
      this.#updateStepButtons();
    };
    typeHidden.addEventListener('input', update);
    update();
  }

  #validateField(input, showError, skipButtonUpdate = false) {
    const field = input.closest('.field');
    if (!field || !field.dataset.validate) return true;
    if (field.hidden) return true;
    // Helpers amount+unit sont des saisies d'affichage uniquement : le hidden
    // tam_amount / levee_amount (whitelisté ci-dessous) porte la source de vérité.
    if (input.closest('[data-amount-row]')) return true;
    if (input.type === 'hidden' && !['stage', 'secteur', 'tam_amount', 'type_client', 'stade', 'levee_amount', 'revenus', 'equipe_temps_plein'].includes(input.id)) return true;
    const rules = field.dataset.validate.split('|');
    const value = input.value.trim();
    let error = '';
    // ARCHITECT-PRIME: max: doit afficher l'erreur au `input` (pas seulement au blur).
    // On force showError=true dans ce cas pour ne pas laisser passer des textareas
    // au-delà de la limite jusqu'au changement de champ.
    let forceShow = false;

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
        forceShow = true;
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

    const shouldShow = showError || forceShow;
    field.classList.toggle('field--valid', !error && !!value);
    field.classList.toggle('field--error', !!error && shouldShow);
    const errEl = field.querySelector('.field__error');
    if (errEl) errEl.textContent = shouldShow ? error : '';

    if (!skipButtonUpdate) this.#updateStepButtons();

    return !error;
  }

  #validateStep(step, showError) {
    const container = this.form.querySelector(`.form-step[data-step="${step}"]`);
    if (!container) return false;
    let ok = true;
    container.querySelectorAll('.field__input, input[type="hidden"]').forEach((input) => {
      // Skip inputs inside a hidden parent field (ex: #previous-ref-field quand resubmit décoché)
      const field = input.closest('.field');
      if (field && field.hidden) return;

      if (input.type === 'hidden') {
        if (field && field.dataset.validate?.includes('required') && !input.value.trim()) {
          ok = false;
          if (showError) {
            field.classList.add('field--error');
            const errEl = field.querySelector('.field__error');
            if (errEl) errEl.textContent = 'Sélectionnez une option.';
          }
        }
        return;
      }
      if (!this.#validateField(input, showError, true)) ok = false;
    });
    return ok;
  }

  // ARCHITECT-PRIME: Anti copy-paste — block if two textareas on same step are >= 80% similar
  #checkSimilarity(step) {
    const container = this.form.querySelector(`.form-step[data-step="${step}"]`);
    if (!container) return true;
    const textareas = Array.from(container.querySelectorAll('textarea'));
    if (textareas.length < 2) return true;

    // Clear previous similarity errors
    textareas.forEach((ta) => {
      const errEl = ta.closest('.field')?.querySelector('.field__error');
      if (errEl && errEl.textContent === 'Cette réponse ressemble trop à une autre. Développez votre réponse.') {
        errEl.textContent = '';
        ta.closest('.field')?.classList.remove('field--error');
      }
    });

    for (let i = 0; i < textareas.length; i++) {
      for (let j = i + 1; j < textareas.length; j++) {
        const ratio = similarityRatio(textareas[i].value, textareas[j].value);
        if (ratio >= 0.8) {
          const field = textareas[j].closest('.field');
          if (field) {
            field.classList.add('field--error');
            const errEl = field.querySelector('.field__error');
            if (errEl) errEl.textContent = 'Cette réponse ressemble trop à une autre. Développez votre réponse.';
          }
          return false;
        }
      }
    }
    return true;
  }

  #updateStepButtons() {
    const step = this.form.querySelector(`.form-step[data-step="${this.currentStep}"]`);
    if (!step) return;

    if (this.currentStep === this.totalSteps) {
      const submitBtn = this.form.querySelector('#btn-submit');
      if (submitBtn) {
        submitBtn.disabled = false; // Dernière étape = documents optionnels
      }
      return;
    }

    const nextBtn = step.querySelector('.btn-form--next');
    if (!nextBtn) return;
    const valid = this.#validateStep(this.currentStep, false);
    nextBtn.disabled = !valid;
    this.#updateMissingHint(step, nextBtn, valid);
  }

  // ARCHITECT-PRIME: MAJEUR 9 — hint contextuel sous le bouton Continuer quand
  // il est désactivé. Liste les 3 premiers labels manquants/invalides + compteur.
  #updateMissingHint(step, nextBtn, valid) {
    const actions = nextBtn.closest('.form-step-actions');
    if (!actions) return;
    let hint = actions.parentElement.querySelector(':scope > .btn-form__hint');
    if (valid) {
      if (hint) { hint.textContent = ''; hint.hidden = true; }
      return;
    }
    if (!hint) {
      hint = document.createElement('p');
      hint.className = 'btn-form__hint';
      hint.setAttribute('role', 'status');
      hint.setAttribute('aria-live', 'polite');
      actions.insertAdjacentElement('afterend', hint);
    }
    const missing = this.#collectMissingLabels(step);
    if (missing.length === 0) {
      hint.textContent = '';
      hint.hidden = true;
      return;
    }
    const shown = missing.slice(0, 3).join(', ');
    const extra = missing.length > 3 ? ` … et ${missing.length - 3} autre${missing.length - 3 > 1 ? 's' : ''}` : '';
    hint.textContent = `Champs à compléter : ${shown}${extra}`;
    hint.hidden = false;
  }

  #collectMissingLabels(step) {
    const labels = [];
    step.querySelectorAll('.field__input, input[type="hidden"]').forEach((input) => {
      const field = input.closest('.field');
      if (!field || !field.dataset.validate) return;
      if (field.hidden) return;
      if (input.closest('[data-amount-row]')) return;
      if (input.type === 'hidden' && !['stage', 'secteur', 'tam_amount', 'type_client', 'stade', 'levee_amount', 'revenus', 'equipe_temps_plein'].includes(input.id)) return;
      const ok = this.#validateField(input, false, true);
      if (ok) return;
      const labelEl = field.querySelector('.field__label');
      if (!labelEl) return;
      const cloned = labelEl.cloneNode(true);
      cloned.querySelectorAll('.field__label-badge, .field__label-hint').forEach((el) => el.remove());
      const text = cloned.textContent.trim().replace(/\s+/g, ' ');
      if (text && !labels.includes(text)) labels.push(text);
    });
    return labels;
  }

  #goToStep(target) {
    if (target < 0 || target > this.totalSteps) return;
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

    // ARCHITECT-PRIME: Wormhole transition with starfield warp
    // Disable navigation buttons during transition
    const navBtns = this.form.querySelectorAll('.btn-form--next, .btn-form--ghost');
    navBtns.forEach((btn) => { btn.style.pointerEvents = 'none'; btn.setAttribute('aria-disabled', 'true'); });

    // t=0ms: Starfield warp + content fade-out
    if (window.starfield?.setSpeed) window.starfield.setSpeed(15);

    const exitAnim = currentEl.animate(
      [
        { opacity: 1, transform: 'scale(1)' },
        { opacity: 0, transform: 'scale(0.95)' }
      ],
      { duration: 300, easing: 'ease-in', fill: 'both' }
    );

    exitAnim.finished
      .then(() => {
        // t=300ms: Swap content
        exitAnim.cancel();
        this.#swapStepDom(target, currentEl, nextEl);
        nextEl.style.opacity = '0';

        // t=600ms: Decelerate starfield + fade-in new content
        return new Promise(resolve => setTimeout(resolve, 300));
      })
      .then(() => {
        if (window.starfield?.setSpeed) window.starfield.setSpeed(1, 400);

        const enterAnim = nextEl.animate(
          [
            { opacity: 0, transform: 'translateY(20px)' },
            { opacity: 1, transform: 'translateY(0)' }
          ],
          { duration: 350, easing: 'ease-out', fill: 'both' }
        );

        return enterAnim.finished.then(() => {
          enterAnim.cancel();
          nextEl.style.opacity = '';
          const first = nextEl.querySelector('.field__input, .chip, [data-dropdown-search]');
          if (first) first.focus();
          // Re-enable buttons
          navBtns.forEach((btn) => { btn.style.pointerEvents = ''; btn.removeAttribute('aria-disabled'); });
        });
      })
      .catch(() => {
        if (window.starfield?.setSpeed) window.starfield.setSpeed(1);
        this.#swapStepDom(target, currentEl, nextEl);
        nextEl.style.opacity = '';
        navBtns.forEach((btn) => { btn.style.pointerEvents = ''; btn.removeAttribute('aria-disabled'); });
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

    // Générer le récapitulatif quand on arrive à l'étape 8
    if (target === 8) this.#buildRecap();
  }

  #updateProgress() {
    if (this.progressFill) {
      this.progressFill.style.width = `${(this.currentStep / this.totalSteps) * 100}%`;
    }
    // ARCHITECT-PRIME: POLISH 13 — compteur visible. aria-live sur .form-progress
    // assure déjà l'annonce SR lorsqu'on change de step.
    if (this.stepLabel) {
      this.stepLabel.textContent = `Étape ${this.currentStep} sur ${this.totalSteps}`;
    }

    // ARCHITECT-PRIME: Linear-style progress dots
    const dotsBar = document.getElementById('progress-dots-bar');
    if (dotsBar) {
      const dots = dotsBar.querySelectorAll('.progress-dots-bar__dot');
      dots.forEach((dot, i) => {
        dot.classList.remove('progress-dots-bar__dot--completed', 'progress-dots-bar__dot--current');
        if (i < this.currentStep) {
          dot.classList.add('progress-dots-bar__dot--completed');
        } else if (i === this.currentStep) {
          dot.classList.add('progress-dots-bar__dot--current');
        }
      });
    }
  }

  #buildRecap() {
    const container = document.getElementById('recap-content');
    if (!container) return;
    container.replaceChildren();

    const labels = {
      previous_ref: 'Référence de votre scoring précédent',
      nom_fondateur: 'Fondateur', email: 'Email', pays: 'Pays', ville: 'Ville',
      nom_startup: 'Startup', pitch_une_phrase: 'Pitch', probleme: 'Problème',
      solution: 'Solution', secteur: 'Secteur', type_client: 'Client cible',
      segment_clientele: 'Segment clientèle',
      tam_amount: 'TAM', estimation_tam: 'Estimation TAM',
      acquisition_clients: 'Acquisition', concurrents: 'Concurrents',
      stade: 'Stade', revenus: 'Revenus', mrr: 'MRR', clients_payants: 'Clients payants',
      moat: 'Barrières à l\'entrée',
      pourquoi_vous: 'Pourquoi vous', equipe_temps_plein: 'Temps plein',
      priorite_6_mois: 'Priorité 6 mois', levee_amount: 'Montant levée',
      jalons_18_mois: 'Jalons 18 mois', utilisation_fonds: 'Utilisation fonds',
      vision_5_ans: 'Vision 5 ans', autres_informations: 'Infos complémentaires',
      pitch_deck_filename: 'Pitch deck', doc_supplementaire_url: 'Liens documents',
      linkedin_url: 'LinkedIn', site_url: 'Site web'
    };

    const formData = new FormData(this.form);
    for (const [key, value] of formData.entries()) {
      const val = typeof value === 'string' ? value.trim() : '';
      if (!val) continue;

      const row = document.createElement('div');
      row.className = 'recap-row';

      const labelEl = document.createElement('span');
      labelEl.className = 'recap-row__label';
      labelEl.textContent = labels[key] || key;

      const valueEl = document.createElement('span');
      valueEl.className = 'recap-row__value';
      valueEl.textContent = val.length > 120 ? val.slice(0, 120) + '\u2026' : val;

      row.appendChild(labelEl);
      row.appendChild(valueEl);
      container.appendChild(row);
    }
  }

  #toBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = () => reject(new Error(`Impossible de lire ${file.name}`));
      reader.readAsDataURL(file);
    });
  }

  async #submit() {
    if (!this.#validateStep(this.totalSteps, true)) return;

    const btn = this.form.querySelector('#btn-submit');
    if (btn) {
      btn.disabled = true;
      btn.classList.add('btn-form--loading');
      btn.setAttribute('aria-disabled', 'true');
      btn.style.pointerEvents = 'none';
    }

    // Collecte automatique de tous les champs par leur name
    const formData = new FormData(this.form);
    const payload = {};
    for (const [key, value] of formData.entries()) {
      // Skip le file input, on utilise le hidden base64
      if (key === 'pitch_deck_file') continue;
      const trimmed = typeof value === 'string' ? value.trim() : value;
      if (trimmed !== '') payload[key] = trimmed;
    }

    // Conversion des champs numériques
    if (payload.mrr) payload.mrr = Number(payload.mrr);
    if (payload.clients_payants) payload.clients_payants = Number(payload.clients_payants);

    // Split doc_supplementaire_url : virgules ou retours à la ligne → tableau d'URLs
    if (payload.doc_supplementaire_url) {
      const urls = payload.doc_supplementaire_url
        .split(/[\n,]+/)
        .map(u => u.trim())
        .filter(u => u.length > 0);
      payload.doc_supplementaire_url = urls.length > 0 ? urls : undefined;
    }

    // Conversion des documents additionnels en base64
    if (this._extraFiles && this._extraFiles.length > 0) {
      const extraDocsBase64 = await Promise.all(
        this._extraFiles.map(f => this.#toBase64(f))
      );
      payload.extra_docs = extraDocsBase64.map((data, i) => ({
        filename: this._extraFiles[i].name,
        base64: data
      }));
    }

    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Flaynn-Source': 'web-form' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60000)
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

      // ARCHITECT-PRIME: MAJEUR 7 — soumission OK → purge draft autosave.
      // Même intention pour les deux branches (checkout Stripe ou succès direct) :
      // on quitte la page de saisie, le brouillon n'a plus de raison d'être.
      if (typeof this._clearDraft === 'function') this._clearDraft();
      if (this._draftInterval) clearInterval(this._draftInterval);

      if (data.checkout_url) {
        localStorage.setItem('flaynn_pending_ref', data.reference || '');
        const emailVal = this.form.email?.value || '';
        localStorage.setItem('flaynn_pending_email', emailVal);
        window.location.href = data.checkout_url;
      } else {
        window.navigateTo ? window.navigateTo(`/scoring/succes?ref=${data.reference}`) : (window.location.href = `/scoring/succes?ref=${data.reference}`);
      }
    } catch (err) {
      showToast(this.toastRoot, err.message || 'Erreur réseau.', 'error');
      if (btn) {
        btn.disabled = false;
        btn.classList.remove('btn-form--loading');
        btn.removeAttribute('aria-disabled');
        btn.style.pointerEvents = '';
      }
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
      const { loadGsapBundle, initScrollReveal, initGsapScoreCounters } = await import(
        './js/landing-motion.js'
      );
      await loadGsapBundle();
      const gsap = window.gsap;
      if (morphEl) initMorph(morphEl);
      initScrollReveal(gsap);
      initGsapScoreCounters(gsap);
    } catch {
      // GSAP échoué : fallback natif
      if (morphEl) initMorph(morphEl);
      if (counterEl) initScoreCounter(counterEl);
      initNativeScrollReveal();
    }
  } else {
    // Tier 1 : animations legeres CSS-only
    if (morphEl) initMorph(morphEl);
    if (counterEl) initScoreCounter(counterEl);
    initNativeScrollReveal();
  }

  const scoringFormSection = document.getElementById('scoring-form');
  const scoringForm =
    scoringFormSection?.querySelector('form') || document.getElementById('scoring-form-form');
  if (scoringForm instanceof HTMLFormElement) {
    new ScoringFormController(scoringForm);
  }
}

document.getElementById('footer-year').textContent = String(new Date().getFullYear());

// ARCHITECT-PRIME: Reset overflow au chargement — évite le blocage scroll en navigation privée
// ou après fermeture incorrecte de modale/menu mobile
document.documentElement.style.overflow = '';
document.body.style.overflow = '';

// ARCHITECT-PRIME: View Transition removed — wormhole only (starfield.js)

/* —— Nav auth state : Espace membre (invité) ou Prénom (connecté) — */
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

/* —— Warp navigation : intercepte les liens vers /dashboard/ ————————— */
function warpNavigate(targetUrl, e) {
  e.preventDefault();
  (window.navigateTo || function(u) { window.location.href = u; })(targetUrl);
}

document.addEventListener('click', (e) => {
  const link = e.target.closest('a[href]');
  if (!link) return;
  const href = link.getAttribute('href');
  if (href && (href.startsWith('/dashboard') || href === '/dashboard/')) {
    warpNavigate(href, e);
  }
});

document.getElementById('btn-header-cta')?.addEventListener('click', () => { window.navigateTo ? window.navigateTo('/scoring/') : (window.location.href = '/scoring/'); });
document.getElementById('btn-hero-cta')?.addEventListener('click', () => { window.navigateTo ? window.navigateTo('/scoring/') : (window.location.href = '/scoring/'); });

// —— Collapsing header on scroll ——————————————————————————————————————
const navGlass = document.querySelector('.nav-glass');
if (navGlass) {
  const onScroll = () => {
    navGlass.classList.toggle('is-scrolled', window.scrollY > 60);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

// ARCHITECT-PRIME: Logo transition removed — wormhole starfield only

// —— Nav mobile ——————————————————————————————————————————————————————
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

// —— Bottom nav mobile — active section tracking + CTA ———————————————
document.getElementById('btn-bnav-cta')?.addEventListener('click', () => { window.navigateTo ? window.navigateTo('/scoring/') : (window.location.href = '/scoring/'); });

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

// —— Gestionnaire de Modales Vanilla JS ——————————————————————————————
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
  // ARCHITECT-PRIME: court-circuiter le cursor tracking sur tablette/mobile
  const hasHover = window.matchMedia('(hover: hover)').matches;

  const setMouseFromEvent = (el, e) => {
    if (e.target.closest('input, textarea, select, button')) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
    el.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
  };

  // 1. Glow magnétique : cartes glass, champs, wrappers .field (bordure scoring)
  // Uniquement sur desktop (hover: hover) — désaxe les éléments au tap sur touch
  const applyGlow = () => {
    if (!hasHover) return;
    document.querySelectorAll('.card-glass, .field__input, .scoring-form .field').forEach((el) => {
      if (el.dataset.glowBound) return;
      el.dataset.glowBound = 'true';
      const move = (e) => setMouseFromEvent(el, e);
      el.addEventListener('mousemove', move, { passive: true });
    });
  };
  applyGlow();
  // ARCHITECT-PRIME: debounced MutationObserver pour éviter le DOM thrashing
  let glowTimer = null;
  const observer = new MutationObserver(() => {
    if (glowTimer) return;
    glowTimer = setTimeout(() => { applyGlow(); glowTimer = null; }, 200);
  });
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

// ARCHITECT-PRIME: Phase 3 — Cursor glow tracking on premium cards
function initCardGlow() {
  if (window.matchMedia('(hover: none)').matches) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cards = document.querySelectorAll('.pillar-card, .process-step, .trust-card');
  cards.forEach(card => {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      card.style.setProperty('--glow-x', x + '%');
      card.style.setProperty('--glow-y', y + '%');
    }, { passive: true });
    card.addEventListener('mouseleave', () => {
      card.style.setProperty('--glow-x', '50%');
      card.style.setProperty('--glow-y', '50%');
    });
  });
}

// ARCHITECT-PRIME: Phase 3 — Lenis smooth scroll 120Hz
function initLenis() {
  if (typeof Lenis === 'undefined') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const lenis = new Lenis({
    duration: 1.1,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    orientation: 'vertical',
    smoothWheel: true,
    touchMultiplier: 1.5,
  });

  // Synchroniser avec GSAP ScrollTrigger si chargé
  lenis.on('scroll', () => {
    if (window.ScrollTrigger) window.ScrollTrigger.update();
  });

  function raf(time) {
    lenis.raf(time);
    requestAnimationFrame(raf);
  }
  requestAnimationFrame(raf);

  window.lenisInstance = lenis;

  // ARCHITECT-PRIME: Intercept anchor links for smooth Lenis scroll
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', (e) => {
      const href = anchor.getAttribute('href');
      if (!href || href === '#') return;
      const target = document.querySelector(href);
      if (!target || !window.lenisInstance) return;
      e.preventDefault();
      window.lenisInstance.scrollTo(target, {
        duration: 1.2,
        easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t))
      });
    });
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

  // ARCHITECT-PRIME: Fallback immédiat pour les barres déjà visibles dans le viewport au chargement
  document.querySelectorAll('.pillar-score-bar__fill, .pillar-fill, .bento-pillar-track').forEach(el => {
    if (!el.classList.contains('is-revealed')) {
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight) {
        el.classList.add('is-revealed');
        // Aussi révéler le parent .pillar-score-bar si c'est un fill
        const parentBar = el.closest('.pillar-score-bar');
        if (parentBar) parentBar.classList.add('is-revealed');
      }
    }
  });
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
  // ARCHITECT-PRIME: Force opacity visible — inline style="opacity:0" in HTML hides the score
  if (scoreValue) scoreValue.style.opacity = '1';
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

  const tamValues = ['\u20AC1.8B', '\u20AC2.1B', '\u20AC2.4B', '\u20AC2.9B', '\u20AC3.2B', '\u20AC1.5B', '\u20AC4.1B'];
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
    if (score >= 85) return 'Tr\u00E8s fort potentiel';
    if (score >= 70) return 'Potentiel \u00E9lev\u00E9';
    if (score >= 55) return 'Potentiel confirm\u00E9';
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
      fill.classList.add('is-revealed');
      // ARCHITECT-PRIME: Révéler le parent track pour déclencher le CSS .bento-pillar-track.is-revealed
      const parentTrack = fill.closest('.bento-pillar-track');
      if (parentTrack) parentTrack.classList.add('is-revealed');
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
      fill.classList.add('is-revealed');
      // ARCHITECT-PRIME: Révéler le parent pour déclencher le CSS .pillar-score-bar.is-revealed
      const parentBar = fill.closest('.pillar-score-bar');
      if (parentBar) parentBar.classList.add('is-revealed');
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
  initLenis();
  void bootDeferred();
  initLiquidUX();
  initCardGlow();
  initModals();
  initBarReveal();
  initLiveScoring();
});

// FADE-UP SCROLL ANIMATIONS (Apple-style)
(function(){
  var obs = new IntersectionObserver(function(entries) {
    entries.forEach(function(e) {
      if (e.isIntersecting) {
        e.target.classList.add('visible');
        e.target.querySelectorAll('.pillar-fill, .showcase-pillar-fill').forEach(function(b) { b.classList.add('animate'); });
      }
    });
  }, { threshold: 0.13, rootMargin: '0px 0px -40px 0px' });
  document.querySelectorAll('.fade-up').forEach(function(el) { obs.observe(el); });
})();

// PAIN CAROUSEL — autoplay, dots, swipe, progress bar
(function() {
  var track = document.getElementById('pain-track');
  var dotsWrap = document.getElementById('pain-dots');
  var progressFill = document.getElementById('pain-progress');
  if (!track || !dotsWrap) return;

  var slides = track.children;
  var total = slides.length;
  var current = 0;
  var autoplayMs = 5000;
  var autoTimer = null;
  var startX = 0;
  var isDragging = false;
  var prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Build dots
  for (var i = 0; i < total; i++) {
    var dot = document.createElement('button');
    dot.className = 'pain-carousel__dot' + (i === 0 ? ' is-active' : '');
    dot.setAttribute('role', 'tab');
    dot.setAttribute('aria-label', 'Slide ' + (i + 1));
    dot.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
    dot.dataset.index = i;
    dotsWrap.appendChild(dot);
  }

  function goTo(idx) {
    if (idx < 0) idx = total - 1;
    if (idx >= total) idx = 0;
    current = idx;
    track.style.transform = 'translateX(-' + (current * 100) + '%)';
    if (progressFill) progressFill.style.width = ((current + 1) / total * 100) + '%';
    var dots = dotsWrap.children;
    for (var j = 0; j < dots.length; j++) {
      dots[j].classList.toggle('is-active', j === current);
      dots[j].setAttribute('aria-selected', j === current ? 'true' : 'false');
    }
  }

  function startAutoplay() {
    if (prefersReduced) return;
    stopAutoplay();
    autoTimer = setInterval(function() { goTo(current + 1); }, autoplayMs);
  }

  function stopAutoplay() {
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
  }

  dotsWrap.addEventListener('click', function(e) {
    var dot = e.target.closest('.pain-carousel__dot');
    if (!dot) return;
    goTo(parseInt(dot.dataset.index, 10));
    stopAutoplay();
    startAutoplay();
  });

  // Swipe support
  track.addEventListener('touchstart', function(e) {
    startX = e.touches[0].clientX;
    isDragging = true;
    stopAutoplay();
  }, { passive: true });

  track.addEventListener('touchend', function(e) {
    if (!isDragging) return;
    isDragging = false;
    var dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 50) {
      goTo(dx < 0 ? current + 1 : current - 1);
    }
    startAutoplay();
  }, { passive: true });

  // Pause on hover
  track.closest('.pain-carousel').addEventListener('mouseenter', stopAutoplay);
  track.closest('.pain-carousel').addEventListener('mouseleave', startAutoplay);

  // Keyboard
  dotsWrap.addEventListener('keydown', function(e) {
    if (e.key === 'ArrowRight') { goTo(current + 1); stopAutoplay(); startAutoplay(); }
    if (e.key === 'ArrowLeft') { goTo(current - 1); stopAutoplay(); startAutoplay(); }
  });

  startAutoplay();
})();

// ARCHITECT-PRIME: Showcase live update — when Quick Score returns a result,
// reflect it in the showcase demo section instead of static data.
(function() {
  var scoreNum = document.querySelector('.showcase-score-num');
  if (!scoreNum) return;
  var showcaseVerdict = document.querySelector('.showcase-verdict');
  var showcaseName = document.querySelector('.showcase-dash-header div:first-child div:first-child');
  var demoBadge = document.querySelector('.showcase-demo-badge');
  var showcasePillars = document.querySelector('.showcase-pillars');
  var showcaseHint = document.getElementById('showcase-hint');
  var showcaseFrame = document.querySelector('.showcase-frame');

  window.addEventListener('flaynn:quickscore', function(e) {
    var d = e.detail;
    if (!d || !d.score) return;

    // Hide pillars (quick score has no pillar breakdown)
    if (showcasePillars) {
      showcasePillars.style.transition = 'opacity 0.3s ease, max-height 0.4s ease';
      showcasePillars.style.opacity = '0';
      showcasePillars.style.maxHeight = '0';
      showcasePillars.style.overflow = 'hidden';
      showcasePillars.style.marginBottom = '0';
    }

    // Hide the hint text
    if (showcaseHint) showcaseHint.classList.add('is-hidden');

    scoreNum.style.transition = 'opacity 0.3s ease';
    scoreNum.style.opacity = '0';

    setTimeout(function() {
      scoreNum.textContent = d.score;
      scoreNum.style.opacity = '1';

      if (d.score >= 70) scoreNum.style.color = 'var(--accent-emerald, #10b981)';
      else if (d.score >= 50) scoreNum.style.color = '#E8651A';
      else scoreNum.style.color = 'var(--accent-rose, #f43f5e)';

      if (showcaseVerdict && d.conseil) {
        var verdictTitle = showcaseVerdict.querySelector('div:first-child');
        var verdictDesc = showcaseVerdict.querySelector('div:last-child');
        if (verdictTitle) verdictTitle.textContent = '\u2726 Verdict rapide';
        if (verdictDesc) verdictDesc.textContent = d.conseil;
      }

      if (showcaseName) showcaseName.textContent = 'Votre Quick Score';

      if (demoBadge) {
        demoBadge.textContent = 'Score bas\u00e9 sur votre description \u00b7 Pour un diagnostic complet, lancez le scoring';
        demoBadge.style.borderColor = 'rgba(232, 101, 26, 0.2)';
        demoBadge.style.color = '#E8651A';
      }

      // Smooth scroll to showcase so user sees the update
      if (showcaseFrame) {
        var navH = document.querySelector('.nav-glass')?.offsetHeight || 64;
        var top = showcaseFrame.getBoundingClientRect().top + window.scrollY - navH - 24;
        window.scrollTo({ top: top, behavior: 'smooth' });
      }
    }, 300);
  });
})();

// MOCKUP TILT 3D + PARALLAX
(function(){
  var hv = document.querySelector('.hero-visual');
  var mk = document.querySelector('.mockup-card');
  if (!hv || !mk) return;

  window.addEventListener('scroll', function() {
    if (window.scrollY < window.innerHeight)
      hv.style.transform = 'translateY(' + (window.scrollY * 0.1) + 'px)';
  }, { passive: true });

  hv.addEventListener('mousemove', function(e) {
    var r = hv.getBoundingClientRect();
    var dx = (e.clientX - r.left - r.width / 2) / r.width;
    var dy = (e.clientY - r.top - r.height / 2) / r.height;
    mk.style.transform = 'rotateY(' + (-8 + dx * 14) + 'deg) rotateX(' + (4 - dy * 10) + 'deg)';
  });

  hv.addEventListener('mouseleave', function() {
    mk.style.transform = 'rotateY(-8deg) rotateX(4deg)';
  });
})();

// Animate mockup pillar bars on load
setTimeout(function() {
  document.querySelectorAll('.mockup-card .pillar-fill').forEach(function(b) {
    b.classList.add('animate');
  });
}, 700);

// PWA: Enregistrement du Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service Worker non enregistré:', err);
    });
  });
}
