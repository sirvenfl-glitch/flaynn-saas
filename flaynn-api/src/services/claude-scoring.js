import { IntegrationError } from '../utils/errors.js';

export const claudeScoringService = {
  /**
   * Évalue une startup via Claude 3.5 Sonnet et retourne un JSON structuré.
   * @param {Object} payload Les données du formulaire soumises par l'utilisateur
   * @returns {Promise<Object>} Le score et l'analyse complète
   */
  async evaluateStartup(payload) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new IntegrationError('Clé API Anthropic non configurée.');
    }

    const prompt = `Tu es "Architect-Prime", un investisseur VC Senior très analytique et intransigeant.
Analyse la startup suivante et génère un scoring strict au format JSON.

DONNÉES STARTUP :
- Nom : ${payload.startup_name}
- Secteur : ${payload.sector}
- Stade : ${payload.stage}
- Pitch : ${payload.pitch}
- MRR approx. : ${payload.revenue_monthly ? payload.revenue_monthly + ' €' : 'Non communiqué'}
- Taille de l'équipe : ${payload.team_size || 'Non communiqué'}

RÈGLES D'ÉVALUATION :
1. Sois sévère et réaliste. Un score de 90+ est extrêmement rare.
2. Rédige des "insights" incisifs de 1 à 2 phrases max pour chaque pilier.
3. Fournis 3 recommandations actionnables.

FORMAT DE SORTIE ATTENDU (Renvoie UNIQUEMENT un objet JSON valide, sans aucun texte ou markdown autour) :
{
  "score": 0,
  "level": "Potentiel ...",
  "stage": "${payload.stage}",
  "sector": "${payload.sector}",
  "pillars": [
    { "name": "Market", "score": 0, "color": "var(--accent-violet)", "insight": "..." },
    { "name": "Product", "score": 0, "color": "var(--accent-blue)", "insight": "..." },
    { "name": "Traction", "score": 0, "color": "var(--accent-emerald)", "insight": "..." },
    { "name": "Team", "score": 0, "color": "var(--accent-violet)", "insight": "..." },
    { "name": "Execution", "score": 0, "color": "var(--accent-amber)", "insight": "..." }
  ],
  "recommendations": [
    { "priority": "high|medium|low", "pillar": "...", "title": "...", "desc": "..." }
  ],
  "investorReadiness": [
    { "status": "ok|warn|missing", "label": "..." }
  ],
  "market": { "tam": "...", "sam": "...", "som": "..." }
}`;

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 2000,
          temperature: 0.3, // Température basse pour garantir une structure JSON stable
          system: "Tu es un évaluateur algorithmique. Tu réponds TOUJOURS par du JSON valide et strictement rien d'autre.",
          messages: [{ role: 'user', content: prompt }]
        })
      });

      if (!response.ok) throw new Error(`HTTP ${response.status} - ${await response.text()}`);
      
      const data = await response.json();
      const cleanJson = data.content[0].text.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(cleanJson);
    } catch (err) {
      throw new IntegrationError('Échec de l\'analyse IA par Claude', err.message);
    }
  }
};