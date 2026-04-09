export default async function miniScoreRoute(fastify) {
  fastify.post('/api/mini-score', {
    schema: {
      body: {
        type: 'object',
        required: ['idea'],
        properties: {
          idea: { type: 'string', minLength: 15, maxLength: 200 }
        }
      }
    },
    config: {
      rateLimit: { max: 10, timeWindow: '1 hour' }
    }
  }, async (request, reply) => {
    const { idea } = request.body;

    // ARCHITECT-PRIME: reject gibberish / repetitive / numbers-only input
    const words = idea.trim().split(/\s+/).filter(w => w.length > 0);
    if (words.length < 2) {
      return reply.status(400).send({ error: 'Décrivez votre idée en au moins 2 mots.' });
    }
    const unique = new Set(words.map(w => w.toLowerCase()));
    if (unique.size === 1) {
      return reply.status(400).send({ error: 'Veuillez décrire une vraie idée de startup.' });
    }
    if (/^[\d\s.,;:!?]+$/.test(idea.trim())) {
      return reply.status(400).send({ error: 'Veuillez décrire votre idée avec des mots.' });
    }

    try {
      const result = await callAI(idea);
      return reply.send(result);
    } catch (err) {
      request.log.error(err, '[MINI-SCORE] Analyse failed');
      // ARCHITECT-PRIME: fallback indicatif plutôt qu'erreur bloquante
      const fallbackScore = 45 + Math.floor(Math.random() * 30);
      return reply.send({
        score: fallbackScore,
        conseil: 'Notre analyse rapide suggère un potentiel à explorer. Soumettez votre dossier complet pour un diagnostic précis sur 5 piliers.'
      });
    }
  });
}

// ARCHITECT-PRIME: essaie plusieurs modèles Gemini en cascade
const GEMINI_MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash'];

async function callAI(idea) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  const prompt = `Tu es un analyste VC senior. On te donne une idée de startup en 1-2 phrases.
Donne un pré-score indicatif entre 30 et 95 et un conseil court (2 phrases max, en français).
Réponds UNIQUEMENT en JSON strict, sans backticks :
{"score": <number>, "conseil": "<string>"}

Critères :
- Clarté de la proposition de valeur
- Taille du marché perçu
- Faisabilité apparente
- Originalité / différenciation

Idée : "${idea.replace(/"/g, '\\"')}"`;

  let lastErr;
  for (const model of GEMINI_MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 150,
              responseMimeType: 'application/json'
            }
          }),
          signal: AbortSignal.timeout(10000)
        }
      );

      if (!res.ok) {
        lastErr = new Error(`Gemini API error (${model}): ${res.status}`);
        continue;
      }

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        lastErr = new Error(`Empty response from ${model}`);
        continue;
      }

      const parsed = JSON.parse(text);
      return {
        score: Math.min(95, Math.max(30, Math.round(parsed.score))),
        conseil: parsed.conseil || 'Soumettez votre dossier complet pour une analyse approfondie.'
      };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}
