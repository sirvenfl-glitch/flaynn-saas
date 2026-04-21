// Delta 14 — révèle la bannière invite-only sur /scoring/ si ?invite_only=1.
(function () {
  try {
    var p = new URLSearchParams(window.location.search);
    if (p.get('invite_only') === '1') {
      var el = document.getElementById('invite-only-banner');
      if (el) el.hidden = false;
    }
  } catch (_) { /* no-op */ }
})();
