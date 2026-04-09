export default async function miniScoreRoute(fastify) {
  fastify.post('/api/mini-score', {
    schema: {
      body: {
        type: 'object',
        required: ['idea'],
        properties: {
          idea: { type: 'string', minLength: 10, maxLength: 200 }
        }
      }
    },
    config: {
      rateLimit: { max: 10, timeWindow: '1 hour' }
    }
  }, async (request, reply) => {
    const { idea } = request.body;
    try {
      const result = await callAI(idea);
      return reply.send(result);
    } catch (err) {
      request.log.error(err, '[MINI-SCORE] Analyse failed');
      return reply.status(500).send({ error: 'Analyse indisponible' });
    }
  });
}

async function callAI(idea) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  const model = 'gemini-2.0-flash';

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
      })
    }
  );

  if (!res.ok) throw new Error('Gemini API error: ' + res.status);

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty response');

  const parsed = JSON.parse(text);
  return {
    score: Math.min(95, Math.max(30, Math.round(parsed.score))),
    conseil: parsed.conseil || 'Soumettez votre dossier complet pour une analyse approfondie.'
  };
}
