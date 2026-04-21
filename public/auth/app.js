/**
 * Flaynn — auth/app.js
 * Connexion uniquement (Delta 14 : la création de compte passe par /auth/activate
 * avec un token reçu par email après scoring certifié).
 */

document.addEventListener('DOMContentLoaded', () => {
  // ── Redirige vers /scoring/ si l'utilisateur arrive sur une ancienne URL d'inscription ──
  const params = new URLSearchParams(window.location.search);
  const hash = (window.location.hash || '').toLowerCase();
  const wantsSignup = params.get('mode') === 'signup' || hash === '#inscription' || hash === '#register';
  if (wantsSignup) {
    window.location.replace('/scoring/?invite_only=1');
    return;
  }

  // ── Reveal animations ──
  const initAuthReveal = (root = document) => {
    const targets = [...root.querySelectorAll('.auth-card, .auth-title, .auth-subtitle, .field, .form-actions')];
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

  // ── Session check — redirect si déjà connecté ──
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
  const submitBtn = document.getElementById('submit-btn');
  const submitText = submitBtn.querySelector('.btn__text');
  const errorEl = document.getElementById('auth-error');
  const pwToggle = document.querySelector('.auth-toggle-pw');
  const pwInput = document.getElementById('password');
  const forgotBtn = document.getElementById('forgot-pw-btn');
  const forgotPanel = document.getElementById('forgot-panel');
  const forgotBackBtn = document.getElementById('forgot-back-btn');
  const forgotForm = document.getElementById('forgot-form');
  const forgotMessage = document.getElementById('forgot-message');

  // ── URL params ──
  const urlEmail = params.get('email') || '';

  if (params.get('expired') === '1') {
    errorEl.textContent = 'Votre session a expiré. Veuillez vous reconnecter.';
    window.history.replaceState(null, '', '/auth/');
  }

  if (urlEmail) {
    form.email.value = urlEmail;
  }

  // ── Toggle password visibility ──
  if (pwToggle && pwInput) {
    pwToggle.addEventListener('click', () => {
      const isPassword = pwInput.type === 'password';
      pwInput.type = isPassword ? 'text' : 'password';
      pwToggle.setAttribute('aria-label', isPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
      pwToggle.style.color = isPassword ? 'var(--text-primary)' : 'var(--text-tertiary)';
    });
  }

  // ── Forgot password ──
  if (forgotBtn && forgotPanel) {
    forgotBtn.addEventListener('click', () => {
      form.hidden = true;
      forgotPanel.hidden = false;
      forgotMessage.textContent = '';
      forgotMessage.className = 'field__error';
      document.getElementById('forgot-email').focus();
    });
  }
  if (forgotBackBtn) {
    forgotBackBtn.addEventListener('click', () => {
      forgotPanel.hidden = true;
      form.hidden = false;
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
      await new Promise(r => setTimeout(r, Math.random() * 500 + 500));
      forgotMessage.className = 'field__error field__error--success';
      forgotMessage.textContent = 'Si un compte est associé à cet email, un lien de réinitialisation a été envoyé.';
      btn.disabled = false;
      btnText.textContent = 'Envoyer le lien';
    });
  }

  // ── Form submit (login uniquement) ──
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    errorEl.className = 'field__error';
    submitBtn.disabled = true;
    submitText.textContent = 'Authentification...';

    const email = form.email.value.trim();
    const password = form.password.value;

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email, password }),
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

      const sessionCheck = await fetch('/api/auth/session', { credentials: 'same-origin' });
      if (!sessionCheck.ok) {
        errorEl.textContent = 'Vérifiez vos identifiants et réessayez.';
        submitBtn.disabled = false;
        submitText.textContent = 'Se connecter';
        return;
      }

      const sessionData = await sessionCheck.json();
      localStorage.setItem('flaynn_auth', JSON.stringify(sessionData.user));
      if (window.navigateTo) { window.navigateTo('/dashboard/'); }
      else { window.location.replace('/dashboard/'); }
    } catch (err) {
      errorEl.textContent = err.message;
      submitBtn.disabled = false;
      submitText.textContent = 'Se connecter';
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
