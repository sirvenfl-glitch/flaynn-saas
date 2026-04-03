/**
 * Flaynn — auth/app.js
 * Gestion de la connexion / inscription sans innerHTML, et application de la Liquid UX
 */

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('auth-form');
  const nameField = document.getElementById('field-name');
  const nameInput = document.getElementById('name');
  const submitBtn = document.getElementById('submit-btn');
  const submitText = submitBtn.querySelector('.btn__text');
  const errorEl = document.getElementById('auth-error');
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
        submitText.textContent = "Créer mon compte";
      } else {
        nameField.hidden = true;
        nameInput.required = false;
        submitText.textContent = "Se connecter";
      }
      errorEl.textContent = '';
      form.classList.remove('field--error');
    });
  });

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
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Erreur lors de l\'authentification');

      // Stockage de l'authentification et redirection vers le dashboard
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