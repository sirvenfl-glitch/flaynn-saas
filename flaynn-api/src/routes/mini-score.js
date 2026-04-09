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
      const result = await callAI(idea, request);
      return reply.send(result);
    } catch (err) {
      request.log.error(err, '[MINI-SCORE] Analyse failed — using contextual fallback');
      return reply.send(buildContextualFallback(idea));
    }
  });
}

// ── Gemini AI call with model cascade ──────────────────────────
const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash-001'];

async function callAI(idea, request) {
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
        const errBody = await res.text();
        request.log.error({ model, status: res.status, body: errBody }, '[MINI-SCORE] Gemini API error');
        lastErr = new Error(`Gemini ${res.status} (${model})`);
        continue;
      }

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        request.log.warn({ model, data }, '[MINI-SCORE] Empty Gemini response');
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

// ── Contextual fallback (no AI) ────────────────────────────────
// ARCHITECT-PRIME: analyse des mots-clés pour produire un conseil
// pertinent même quand Gemini est indisponible.

const KEYWORD_RULES = [
  { keywords: ['freelance', 'freelances', 'indépendant', 'indépendants', 'independant'],
    conseil: 'Le marché du freelancing est en forte croissance mais très concurrentiel. Votre différenciation (niche sectorielle, matching intelligent, garanties) sera déterminante pour capter ce segment.',
    scoreBoost: 5 },
  { keywords: ['santé', 'sante', 'health', 'médical', 'medical', 'patient', 'patients', 'clinique'],
    conseil: 'Le secteur healthtech attire les investisseurs mais exige une conformité réglementaire forte. Identifiez tôt les certifications nécessaires et le parcours de remboursement.',
    scoreBoost: 8 },
  { keywords: ['ia', 'intelligence artificielle', 'machine learning', 'ml', 'llm', 'gpt', 'deep learning'],
    conseil: 'L\'IA est un levier puissant mais les investisseurs cherchent un avantage défendable (données propriétaires, expertise domaine). Montrez ce qui vous rend difficile à copier.',
    scoreBoost: 3 },
  { keywords: ['marketplace', 'plateforme', 'mise en relation', 'matching'],
    conseil: 'Les marketplaces doivent résoudre le problème de la poule et l\'œuf. Concentrez-vous sur un côté du marché d\'abord et prouvez la rétention avant de scaler.',
    scoreBoost: 4 },
  { keywords: ['fintech', 'paiement', 'banque', 'finance', 'crédit', 'credit', 'épargne', 'epargne'],
    conseil: 'La fintech requiert un cadre réglementaire solide (agrément, KYC). Les investisseurs valorisent les équipes qui maîtrisent la compliance dès le jour 1.',
    scoreBoost: 6 },
  { keywords: ['saas', 'logiciel', 'outil', 'dashboard', 'tableau de bord', 'crm', 'erp'],
    conseil: 'Le SaaS B2B se valorise sur le MRR et la rétention nette. Visez un segment précis, prouvez le product-market fit, puis élargissez.',
    scoreBoost: 5 },
  { keywords: ['livraison', 'logistique', 'transport', 'mobilité', 'mobilite', 'vélo', 'velo'],
    conseil: 'La logistique est un marché à forte intensité opérationnelle. Les unit economics (coût par livraison, densité de commandes) seront scrutés par les investisseurs.',
    scoreBoost: 3 },
  { keywords: ['education', 'éducation', 'formation', 'apprendre', 'cours', 'edtech', 'école', 'ecole'],
    conseil: 'L\'edtech doit prouver un impact mesurable sur l\'apprentissage. Les investisseurs regardent l\'engagement récurrent et le taux de complétion, pas juste l\'inscription.',
    scoreBoost: 4 },
  { keywords: ['green', 'climat', 'énergie', 'energie', 'durable', 'recyclage', 'carbone', 'écologie', 'ecologie'],
    conseil: 'La greentech bénéficie d\'un fort appétit investisseur et réglementaire. Quantifiez votre impact carbone et identifiez les subventions/crédits disponibles.',
    scoreBoost: 7 },
  { keywords: ['app', 'application', 'mobile'],
    conseil: 'Le marché des apps mobiles est saturé — le coût d\'acquisition est élevé. Misez sur la viralité organique ou un canal de distribution captif pour vous démarquer.',
    scoreBoost: 0 },
  { keywords: ['b2b', 'entreprise', 'entreprises', 'professionnel', 'professionnels', 'pro'],
    conseil: 'Le B2B offre des cycles de vente plus longs mais des revenus plus prévisibles. Un POC avec 2-3 clients pilotes vaut plus qu\'un pitch deck.',
    scoreBoost: 5 },
  { keywords: ['food', 'restaurant', 'cuisine', 'alimentation', 'repas', 'foodtech'],
    conseil: 'La foodtech exige des marges serrées et une logistique irréprochable. Les investisseurs veulent voir vos unit economics par commande dès le MVP.',
    scoreBoost: 2 },
];

function buildContextualFallback(idea) {
  const lower = idea.toLowerCase();
  const matched = KEYWORD_RULES.filter(rule =>
    rule.keywords.some(kw => lower.includes(kw))
  );

  // Score de base contextuel : plus l'idée est longue et détaillée, meilleur le signal
  const wordCount = idea.trim().split(/\s+/).length;
  const lengthBonus = Math.min(10, Math.floor(wordCount / 3));
  let baseScore = 45 + lengthBonus + Math.floor(Math.random() * 10);

  // Appliquer les boosts des domaines reconnus
  let bestConseil = '';
  for (const rule of matched) {
    baseScore += rule.scoreBoost;
    if (!bestConseil) bestConseil = rule.conseil;
  }

  // Si plusieurs domaines matchent, combiner le premier conseil avec un complément
  if (matched.length > 1) {
    bestConseil += ' Le croisement de plusieurs domaines peut être un atout différenciant.';
  }

  // Fallback générique si aucun mot-clé reconnu
  if (!bestConseil) {
    bestConseil = `Votre concept mérite d'être creusé. Précisez votre cible (qui paie ?), votre avantage concurrentiel et vos premières métriques pour obtenir un diagnostic complet.`;
  }

  return {
    score: Math.min(85, Math.max(35, baseScore)),
    conseil: bestConseil
  };
}
