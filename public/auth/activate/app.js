/**
 * Flaynn — auth/activate/app.js
 * Page d'activation : consomme ?token=xxx, pré-remplit l'email,
 * envoie POST /api/auth/register avec { name, password, activation_token }.
 */

document.addEventListener('DOMContentLoaded', () => {
  const subtitle = document.getElementById('auth-subtitle');
  const errorState = document.getElementById('activate-error-state');
  const errorText = document.getElementById('activate-error-text');
  const form = document.getElementById('activate-form');
  const formError = document.getElementById('activate-form-error');
  const emailInput = document.getElementById('email');
  const emailHint = document.getElementById('email-hint');
  const nameInput = document.getElementById('name');
  const pwInput = document.getElementById('password');
  const pwToggle = document.querySelector('.auth-toggle-pw');
  const submitBtn = document.getElementById('submit-btn');
  const submitText = submitBtn.querySelector('.btn__text');

  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');

  function showError(message) {
    subtitle.textContent = 'Ce lien d\'activation n\'est plus valide.';
    errorText.textContent = message;
    errorState.hidden = false;
    form.hidden = true;
  }

  function showForm(email, startupName) {
    emailInput.value = email;
    if (startupName) {
      emailHint.textContent = `Lié à la soumission de « ${startupName} ».`;
    }
    subtitle.textContent = 'Choisissez un mot de passe pour accéder à votre rapport.';
    errorState.hidden = true;
    form.hidden = false;
    nameInput.focus();
  }

  // ── Toggle password ──
  if (pwToggle && pwInput) {
    pwToggle.addEventListener('click', () => {
      const isPassword = pwInput.type === 'password';
      pwInput.type = isPassword ? 'text' : 'password';
      pwToggle.setAttribute('aria-label', isPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
      pwToggle.style.color = isPassword ? 'var(--text-primary)' : 'var(--text-tertiary)';
    });
  }

  // ── Étape 1 : lookup du token ──
  async function loadToken() {
    if (!token || token.length < 20) {
      showError('Lien d\'activation invalide ou incomplet. Vérifiez que vous avez copié l\'intégralité du lien reçu par email.');
      return;
    }
    try {
      const res = await fetch(`/api/auth/activation/${encodeURIComponent(token)}`, {
        credentials: 'same-origin',
        signal: AbortSignal.timeout(10000)
      });
      if (res.status === 429) {
        showError('Trop de tentatives. Patientez quelques minutes avant de réessayer.');
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === 'TOKEN_EXPIRED') {
          showError('Ce lien d\'activation a expiré (validité 72h). Contactez le support pour en recevoir un nouveau.');
        } else if (data.error === 'TOKEN_ALREADY_USED') {
          showError('Ce lien d\'activation a déjà été utilisé. Connectez-vous depuis l\'espace membre.');
        } else {
          showError('Lien d\'activation invalide. Vérifiez votre email ou contactez le support.');
        }
        return;
      }
      showForm(data.email, data.startup_name);
    } catch {
      showError('Impossible de vérifier le lien pour le moment. Réessayez dans quelques instants.');
    }
  }

  // ── Étape 2 : soumission du formulaire ──
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    formError.textContent = '';
    formError.className = 'field__error';

    const name = nameInput.value.trim();
    const password = pwInput.value;

    if (name.length < 2) {
      formError.textContent = 'Veuillez entrer votre nom (min. 2 caractères).';
      return;
    }
    if (password.length < 12) {
      formError.textContent = 'Le mot de passe doit contenir au moins 12 caractères.';
      return;
    }

    submitBtn.disabled = true;
    submitText.textContent = 'Création du compte...';

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ name, password, activation_token: token }),
        signal: AbortSignal.timeout(15000)
      });

      const data = await res.json().catch(() => ({}));

      if (res.status === 429) throw new Error('Trop de tentatives. Patientez quelques minutes.');
      if (res.status === 403) {
        if (data.error === 'TOKEN_EXPIRED') {
          showError('Ce lien d\'activation a expiré pendant votre saisie. Contactez le support.');
          return;
        }
        if (data.error === 'TOKEN_ALREADY_USED') {
          showError('Ce lien d\'activation a déjà été utilisé. Connectez-vous depuis l\'espace membre.');
          return;
        }
        throw new Error(data.message || 'Création de compte refusée.');
      }
      if (res.status === 409) {
        showError('Un compte existe déjà pour cet email. Connectez-vous depuis l\'espace membre.');
        return;
      }
      if (res.status === 422) throw new Error(data.message || 'Mot de passe trop faible. Essayez-en un autre.');
      if (!res.ok) throw new Error(data.message || 'Erreur lors de la création du compte.');

      const sessionCheck = await fetch('/api/auth/session', { credentials: 'same-origin' });
      if (!sessionCheck.ok) {
        formError.textContent = 'Compte créé, mais la session n\'a pas pu être ouverte. Connectez-vous.';
        setTimeout(() => window.location.replace('/auth/'), 1500);
        return;
      }
      const sessionData = await sessionCheck.json();
      localStorage.setItem('flaynn_auth', JSON.stringify(sessionData.user));
      window.location.replace('/dashboard/');
    } catch (err) {
      formError.textContent = err.message;
      submitBtn.disabled = false;
      submitText.textContent = 'Créer mon compte';
    }
  });

  // ── Liquid UX ──
  document.querySelectorAll('.card-glass, .field__input').forEach((el) => {
    el.addEventListener('mousemove', (e) => {
      const rect = el.getBoundingClientRect();
      el.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
      el.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
    });
  });

  loadToken();
});
