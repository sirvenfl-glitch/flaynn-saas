(function() {
  var input = document.getElementById('mini-scoring-input');
  var btn = document.getElementById('mini-scoring-btn');
  var resultEl = document.getElementById('mini-scoring-result');
  var scoreVal = document.getElementById('mini-score-value');
  var bar = document.getElementById('mini-score-bar');
  var advice = document.getElementById('mini-score-advice');
  if (!input || !btn) return;

  var btnText = btn.querySelector('.mini-scoring__btn-text');
  var btnLoader = btn.querySelector('.mini-scoring__btn-loader');

  input.addEventListener('input', function() {
    btn.disabled = input.value.trim().length < 10;
  });

  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !btn.disabled) btn.click();
  });

  btn.addEventListener('click', async function() {
    var idea = input.value.trim();
    if (idea.length < 10) return;

    btnText.hidden = true;
    btnLoader.hidden = false;
    btn.disabled = true;
    resultEl.hidden = true;

    try {
      var res = await fetch('/api/mini-score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idea: idea })
      });

      if (!res.ok) throw new Error('API error');
      var data = await res.json();
      var score = data.score;
      var colorClass = score >= 70 ? '--high' : score >= 50 ? '--mid' : '--low';

      scoreVal.textContent = score + '/100';
      scoreVal.className = 'mini-scoring__score mini-scoring__score' + colorClass;
      advice.textContent = data.conseil;
      resultEl.hidden = false;

      requestAnimationFrame(function() {
        bar.style.width = score + '%';
        if (score >= 70) bar.style.background = 'linear-gradient(90deg, #7B2D8E, #E8651A)';
        else if (score >= 50) bar.style.background = 'linear-gradient(90deg, #7B2D8E, #FACC15)';
        else bar.style.background = 'rgba(255,255,255,0.2)';
      });
    } catch (err) {
      advice.textContent = 'Service temporairement indisponible. Tentez le scoring complet.';
      scoreVal.textContent = '--';
      bar.style.width = '0%';
      resultEl.hidden = false;
    } finally {
      btnText.hidden = false;
      btnLoader.hidden = true;
      btn.disabled = input.value.trim().length < 10;
    }
  });
})();
