(function () {
  // ARCHITECT-PRIME: deux sources possibles — session_id (depuis Stripe) ou ref/email directs
  var params = new URLSearchParams(window.location.search);
  var sessionId = params.get('session_id');
  var directRef = params.get('ref');
  var directEmail = params.get('email');

  function applyData(ref, email) {
    if (ref) {
      document.getElementById('ref-display').textContent = ref;
      document.getElementById('ref-inline').textContent = ref;
      document.title = ref + ' · Scoring confirmé · Flaynn';
      startPolling(ref);
    }
    if (email) {
      document.getElementById('email-display').textContent = decodeURIComponent(email);
    }
  }

  function startPolling(ref) {
    var attempts = 0;
    var maxAttempts = 180;
    var icons = document.querySelectorAll('.timeline-icon');
    var titles = document.querySelectorAll('.timeline-title');
    var descs = document.querySelectorAll('.timeline-desc');
    var lastStatus = '';
    var checkSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

    var interval = setInterval(function() {
      attempts++;
      if (attempts > maxAttempts) { clearInterval(interval); return; }

      fetch('/api/scoring/status/' + encodeURIComponent(ref))
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.status === lastStatus) return;
          lastStatus = data.status;

          if (data.status === 'pending_payment') {
            // Stripe webhook pas encore arrive, paiement OK cote user
            if (descs[1]) { descs[1].textContent = 'Confirmation du paiement en cours... Votre analyse demarrera dans quelques secondes.'; }
          }

          if (data.status === 'pending_analysis') {
            // n8n declenche, scoring en cours
            if (descs[1]) { descs[1].textContent = 'Notre IA analyse votre dossier sur les 5 piliers : Market, Product, Traction, Team, Execution. Un analyste valide la synthese.'; }
            if (icons[1]) { icons[1].className = 'timeline-icon active'; }
          }

          if (data.status === 'completed') {
            clearInterval(interval);
            // Item 1 : done
            if (icons[1]) { icons[1].className = 'timeline-icon done'; icons[1].innerHTML = checkSvg; }
            if (titles[1]) { titles[1].textContent = 'Analyse terminee \u2014 Flaynn Intelligence'; }
            if (descs[1]) { descs[1].textContent = 'Votre scoring est pret. Creez votre compte pour acceder a votre rapport detaille.'; }
            // Item 2 : active
            if (icons[2]) { icons[2].className = 'timeline-icon active'; }
            if (titles[2]) { titles[2].textContent = 'Votre rapport est pret'; }
            if (descs[2]) { descs[2].textContent = 'Creez votre espace fondateur pour consulter votre Flaynn Card, vos scores par pilier, et vos recommandations.'; }
            // CTA deja present en bas de page, juste update le banner
            var banner = document.querySelector('.email-banner-text');
            if (banner) {
              banner.textContent = 'Votre scoring est termine ! Cliquez sur le bouton ci-dessous pour creer votre espace fondateur et consulter votre rapport.';
            }
          }

          if (data.status === 'error') {
            clearInterval(interval);
            if (icons[1]) { icons[1].className = 'timeline-icon'; icons[1].style.borderColor = '#C13584'; icons[1].style.background = 'rgba(193,53,132,0.1)'; }
            if (titles[1]) { titles[1].textContent = 'Erreur lors de l\'analyse'; }
            if (descs[1]) { descs[1].textContent = 'Notre equipe a ete notifiee et votre dossier sera reanalyse. Vous recevrez un email des que le scoring sera pret.'; }
          }
        })
        .catch(function() { /* silencieux */ });
    }, 10000);
  }

  if (sessionId) {
    fetch('/api/checkout/session/' + encodeURIComponent(sessionId))
      .then(function(r) { return r.json(); })
      .then(function(data) {
        applyData(data.reference || '', data.email || '');
      })
      .catch(function() { /* Fallback silencieux */ });
  } else if (directRef || directEmail) {
    applyData(directRef || '', directEmail || '');
  }
})();
