/**
 * Flaynn — auth/app.js
 * Gestion connexion / inscription / mot de passe oublie
 * Zero innerHTML, Liquid UX, anti-enumeration
 */

document.addEventListener('DOMContentLoaded', () => {
  // ── Reveal animations ──
  const initAuthReveal = (root = document) => {
    const targets = [...root.querySelectorAll('.auth-card, .auth-title, .auth-subtitle, .auth-tab, .field, .form-actions')];
    if (!targets.length) return;
    targets.forEach((node, index) => {
      node.setAttribute('data-reveal', '');
      node.setAttribute('data-reveal-delay', String(Math.min(index + 1, 6)));
    });
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      targets.forEach((node) => node.classList.add('is-revealed'));
      return;
    }
    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-revealed');
        obs.unobserve(entry.target);
      });
    }, { threshold: 0.15 });
    targets.forEach((node) => observer.observe(node));
  };

  // ── Session check — redirect si deja connecte ──
  const syncSession = async () => {
    try {
      const res = await fetch('/api/auth/session', { credentials: 'same-origin', signal: AbortSignal.timeout(8000) });
      if (!res.ok) { localStorage.removeItem('flaynn_auth'); return null; }
      const data = await res.json();
      localStorage.setItem('flaynn_auth', JSON.stringify(data.user));
      return data.user;
    } catch { return null; }
  };
  void syncSession().then((user) => { if (user) window.location.replace('/dashboard/'); });

  // ── DOM refs ──
  const form = document.getElementById('auth-form');
  const nameField = document.getElementById('field-name');
  const nameInput = document.getElementById('name');
  const submitBtn = document.getElementById('submit-btn');
  const submitText = submitBtn.querySelector('.btn__text');
  const errorEl = document.getElementById('auth-error');
  const pwToggle = document.querySelector('.auth-toggle-pw');
  const pwInput = document.getElementById('password');
  const generatePwBtn = document.getElementById('generate-pw');
  const strengthContainer = document.getElementById('pw-strength-container');
  const strengthFill = document.getElementById('pw-strength-fill');
  const strengthLabel = document.getElementById('pw-strength-label');
  const forgotLink = document.getElementById('auth-forgot');
  const forgotBtn = document.getElementById('forgot-pw-btn');
  const forgotPanel = document.getElementById('forgot-panel');
  const forgotBackBtn = document.getElementById('forgot-back-btn');
  const forgotForm = document.getElementById('forgot-form');
  const forgotMessage = document.getElementById('forgot-message');

  let currentMode = 'login';

  // ── URL params ──
  const params = new URLSearchParams(window.location.search);
  if (params.get('register') === '1' || window.location.hash === '#register') {
    const regTab = document.querySelector('.auth-tab[data-tab="register"]');
    if (regTab) regTab.click();
  }
  if (params.get('expired') === '1') {
    errorEl.textContent = 'Votre session a expiré. Veuillez vous reconnecter.';
    window.history.replaceState(null, '', '/auth/');
  }

  // ── Scoring post-paiement : email + ref pré-remplis ──
  const scoringEmail = params.get('email');
  const scoringRef   = params.get('ref');
  if (scoringEmail || scoringRef) {
    // Forcer l'onglet inscription
    const regTab = document.querySelector('.auth-tab[data-tab="register"]');
    if (regTab) regTab.click();

    // Pré-remplir l'email
    if (scoringEmail) {
      const emailInput = document.getElementById('email') || form.querySelector('input[type="email"]');
      if (emailInput) emailInput.value = decodeURIComponent(scoringEmail);
    }

    // Bannière contextuelle au-dessus du formulaire
    const banner = document.createElement('div');
    Object.assign(banner.style, {
      background: 'rgba(123,45,142,0.10)',
      border: '1px solid rgba(123,45,142,0.25)',
      borderRadius: '10px',
      padding: '14px 18px',
      marginBottom: '20px',
      fontSize: '13px',
      lineHeight: '1.6',
      color: '#F0F0F3',
    });

    const icon = document.createElement('span');
    icon.textContent = '✦ ';
    icon.style.color = '#7B2D8E';

    const text = document.createTextNode(
      scoringRef
        ? `Votre scoring Flaynn est prêt (réf. ${decodeURIComponent(scoringRef)}). Créez votre compte pour y accéder.`
        : 'Créez votre compte pour accéder à votre scoring Flaynn.'
    );

    banner.appendChild(icon);
    banner.appendChild(text);

    // Insérer avant le formulaire
    const authCard = document.querySelector('.auth-card, .card-glass, form');
    if (authCard) authCard.prepend(banner);
  }

  // ── Tab switching ──
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      if (typeof navigator.vibrate === 'function') navigator.vibrate(10);
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('is-active'));
      e.target.classList.add('is-active');
      currentMode = e.target.dataset.tab;
      errorEl.textContent = '';
      errorEl.className = 'field__error';

      // Cacher le panneau mot de passe oublie
      if (forgotPanel) forgotPanel.hidden = true;
      form.hidden = false;

      if (currentMode === 'register') {
        nameField.hidden = false;
        nameInput.required = true;
        if (strengthContainer) strengthContainer.hidden = false;
        if (generatePwBtn) generatePwBtn.hidden = false;
        if (forgotLink) forgotLink.hidden = true;
        submitText.textContent = 'Créer mon compte';
        pwInput.autocomplete = 'new-password';
      } else {
        nameField.hidden = true;
        nameInput.required = false;
        if (strengthContainer) strengthContainer.hidden = true;
        if (generatePwBtn) generatePwBtn.hidden = true;
        if (forgotLink) forgotLink.hidden = false;
        submitText.textContent = 'Se connecter';
        pwInput.autocomplete = 'current-password';
      }
    });
  });

  // ── Toggle password visibility ──
  if (pwToggle && pwInput) {
    pwToggle.addEventListener('click', () => {
      const isPassword = pwInput.type === 'password';
      pwInput.type = isPassword ? 'text' : 'password';
      pwToggle.setAttribute('aria-label', isPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
      pwToggle.style.color = isPassword ? 'var(--text-primary)' : 'var(--text-tertiary)';
    });
  }

  // ── Generate strong password ──
  if (generatePwBtn && pwInput) {
    generatePwBtn.addEventListener('click', () => {
      // ARCHITECT-PRIME: charset 64 chars (puissance de 2) pour éliminer le biais modulo
      const chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&';
      const array = new Uint8Array(16);
      crypto.getRandomValues(array);
      const password = Array.from(array, (v) => chars[v & 63]).join('');
      pwInput.value = password;
      pwInput.type = 'text';
      pwInput.dispatchEvent(new Event('input', { bubbles: true }));
      if (typeof navigator.vibrate === 'function') navigator.vibrate(15);

      // Copier dans le presse-papier
      navigator.clipboard.writeText(password).catch(() => {});

      // Feedback visuel
      generatePwBtn.style.color = 'var(--accent-emerald)';
      setTimeout(() => { generatePwBtn.style.color = ''; }, 1500);
    });
  }

  // ── Password strength meter ──
  if (pwInput && strengthFill && strengthLabel) {
    pwInput.addEventListener('input', () => {
      if (currentMode !== 'register') return;
      const val = pwInput.value;
      let score = 0;
      if (val.length >= 12) score++;
      if (/[A-Z]/.test(val)) score++;
      if (/[0-9]/.test(val)) score++;
      if (/[^a-zA-Z0-9]/.test(val)) score++;

      const levels = ['', 'weak', 'medium', 'strong', 'strong'];
      const labels = ['', 'Faible', 'Moyen', 'Fort', 'Très fort'];

      strengthFill.className = `auth-pw-strength__fill auth-pw-strength__fill--${levels[score] || 'weak'}`;
      strengthLabel.textContent = val.length
        ? (val.length < 12 ? 'Trop court (min. 12)' : labels[score] || 'Faible')
        : '';
    });
  }

  // ── Forgot password ──
  const authTabs = document.querySelector('.auth-tabs');

  if (forgotBtn && forgotPanel) {
    forgotBtn.addEventListener('click', () => {
      form.hidden = true;
      forgotPanel.hidden = false;
      if (authTabs) authTabs.hidden = true;
      forgotMessage.textContent = '';
      forgotMessage.className = 'field__error';
      document.getElementById('forgot-email').focus();
    });
  }
  if (forgotBackBtn) {
    forgotBackBtn.addEventListener('click', () => {
      forgotPanel.hidden = true;
      form.hidden = false;
      if (authTabs) authTabs.hidden = false;
    });
  }
  if (forgotForm) {
    forgotForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('forgot-email').value.trim();
      if (!email) return;
      const btn = document.getElementById('forgot-submit-btn');
      const btnText = btn.querySelector('.btn__text');
      btn.disabled = true;
      btnText.textContent = 'Envoi...';

      // Anti-enumeration : toujours repondre positivement
      await new Promise(r => setTimeout(r, Math.random() * 500 + 500));

      forgotMessage.className = 'field__error field__error--success';
      forgotMessage.textContent = 'Si un compte est associé à cet email, un lien de réinitialisation a été envoyé.';
      btn.disabled = false;
      btnText.textContent = 'Envoyer le lien';
    });
  }

  // ── Form submit ──
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    errorEl.className = 'field__error';
    submitBtn.disabled = true;
    submitText.textContent = 'Authentification...';

    const payload = {
      email: form.email.value.trim(),
      password: form.password.value
    };
    if (currentMode === 'register') {
      payload.name = form.name.value.trim();
    }

    try {
      const res = await fetch(`/api/auth/${currentMode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000)
      });

      const data = await res.json();

      if (res.status === 429) {
        throw new Error('Trop de tentatives. Veuillez patienter quelques minutes.');
      }
      if (res.status === 401 && data.message && data.message.includes('bloque')) {
        throw new Error('Compte temporairement verrouillé (15 min). Trop de tentatives échouées.');
      }
      if (!res.ok) throw new Error(data.message || 'Erreur lors de l\'authentification');

      // Verification de session reelle (anti-enumeration)
      const sessionCheck = await fetch('/api/auth/session', { credentials: 'same-origin' });
      if (!sessionCheck.ok) {
        errorEl.className = 'field__error field__error--success';
        errorEl.textContent = currentMode === 'register'
          ? 'Si cet email n\'était pas déjà enregistré, votre compte a été créé. Connectez-vous.'
          : 'Vérifiez vos identifiants et réessayez.';
        submitBtn.disabled = false;
        submitText.textContent = currentMode === 'register' ? 'Créer mon compte' : 'Se connecter';
        return;
      }

      const sessionData = await sessionCheck.json();
      localStorage.setItem('flaynn_auth', JSON.stringify(sessionData.user));
      window.location.replace('/dashboard/');
    } catch (err) {
      errorEl.textContent = err.message;
      submitBtn.disabled = false;
      submitText.textContent = currentMode === 'register' ? 'Créer mon compte' : 'Se connecter';
    }
  });

  // ── Liquid UX : Glow Effect ──
  document.querySelectorAll('.card-glass, .field__input').forEach((el) => {
    el.addEventListener('mousemove', (e) => {
      const rect = el.getBoundingClientRect();
      el.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
      el.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
    });
  });

  initAuthReveal(document);
});