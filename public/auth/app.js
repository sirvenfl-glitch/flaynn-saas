/**
 * Flaynn — auth/app.js
 * Gestion de la connexion / inscription sans innerHTML, et application de la Liquid UX
 */

document.addEventListener('DOMContentLoaded', () => {
  const syncSession = async () => {
    try {
      const res = await fetch('/api/auth/session', { credentials: 'same-origin' });
      if (!res.ok) {
        localStorage.removeItem('flaynn_auth');
        return null;
      }
      const data = await res.json();
      localStorage.setItem('flaynn_auth', JSON.stringify(data.user));
      return data.user;
    } catch {
      return null;
    }
  };

  void syncSession().then((user) => {
    if (user) window.location.replace('/dashboard/');
  });

  const params = new URLSearchParams(window.location.search);
  if (params.get('register') === '1' || window.location.hash === '#register') {
    const regTab = document.querySelector('.auth-tab[data-tab="register"]');
    if (regTab) regTab.click();
  }

  const form = document.getElementById('auth-form');
  const nameField = document.getElementById('field-name');
  const nameInput = document.getElementById('name');
  const submitBtn = document.getElementById('submit-btn');
  const submitText = submitBtn.querySelector('.btn__text');
  const errorEl = document.getElementById('auth-error');
  const pwToggle = document.querySelector('.auth-toggle-pw');
  const pwInput = document.getElementById('password');
  const strengthContainer = document.getElementById('pw-strength-container');
  const strengthFill = document.getElementById('pw-strength-fill');
  const strengthLabel = document.getElementById('pw-strength-label');
  let currentMode = 'login';

  // Basculement des onglets
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      if (typeof navigator.vibrate === 'function') navigator.vibrate(10);
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('is-active'));
      e.target.classList.add('is-active');
      currentMode = e.target.dataset.tab;

      if (currentMode === 'register') {
        nameField.hidden = false;
        nameInput.required = true;
        if (strengthContainer) strengthContainer.hidden = false;
        submitText.textContent = "Créer mon compte";
      } else {
        nameField.hidden = true;
        nameInput.required = false;
        if (strengthContainer) strengthContainer.hidden = true;
        submitText.textContent = "Se connecter";
      }
      errorEl.textContent = '';
      form.classList.remove('field--error');
    });
  });

  // Toggle Mot de passe
  if (pwToggle && pwInput) {
    pwToggle.addEventListener('click', () => {
      const isPassword = pwInput.type === 'password';
      pwInput.type = isPassword ? 'text' : 'password';
      pwToggle.setAttribute('aria-label', isPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
      pwToggle.style.color = isPassword ? 'var(--text-primary)' : 'var(--text-tertiary)';
    });
  }

  // Indicateur de force du mot de passe
  if (pwInput && strengthFill && strengthLabel) {
    pwInput.addEventListener('input', () => {
      if (currentMode !== 'register') return;
      const val = pwInput.value;
      let score = 0;
      if (val.length >= 8) score++;
      if (/[A-Z]/.test(val)) score++;
      if (/[0-9]/.test(val)) score++;
      if (/[^a-zA-Z0-9]/.test(val)) score++;

      const levels = ['', 'weak', 'medium', 'strong', 'strong'];
      const labels = ['', 'Faible', 'Moyen', 'Fort', 'Fort'];

      strengthFill.className = `auth-pw-strength__fill auth-pw-strength__fill--${levels[score] || 'weak'}`;
      strengthLabel.textContent = val.length ? labels[score] || 'Faible' : '';
    });
  }

  // Soumission du formulaire
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
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
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Erreur lors de l\'authentification');

      localStorage.setItem('flaynn_auth', JSON.stringify(data.user));
      window.location.replace('/dashboard/');
    } catch (err) {
      errorEl.textContent = err.message;
      submitBtn.disabled = false;
      submitText.textContent = currentMode === 'register' ? 'Créer mon compte' : 'Se connecter';
    }
  });

  // Liquid UX : Glow Effect local à l'authentification
  document.querySelectorAll('.card-glass, .field__input').forEach((el) => {
    el.addEventListener('mousemove', (e) => {
      const rect = el.getBoundingClientRect();
      el.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
      el.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
    });
  });
  
  if (typeof navigator.serviceWorker !== 'undefined') {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  }
});
