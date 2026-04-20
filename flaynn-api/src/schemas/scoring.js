import { z } from 'zod';

// tam_amount / levee_amount : string normalisée EUR (ex: "200K", "15M", "2Md")
// Format : /^\d+(\.\d+)?(K|M|Md)?€?$/
const EUR_AMOUNT_REGEX = /^\d+(?:\.\d+)?(?:K|M|Md)?€?$/;

export const ScoreSubmissionSchema = z.object({
  previous_ref: z.string().trim().max(50).optional(),
  nom_fondateur: z.string().trim().min(2).max(100),
  email: z.string().email().max(254),
  pays: z.string().trim().min(2).max(100),
  ville: z.string().trim().min(2).max(100),
  nom_startup: z.string().trim().min(2).max(100).regex(/^[\p{L}\p{N}\s\-'.&]+$/u),
  pitch_une_phrase: z.string().trim().min(5).max(300),
  probleme: z.string().trim().min(20).max(2000),
  solution: z.string().trim().min(20).max(2000),
  // Secteur : texte libre normalisé (slug ASCII minuscule-tirets, transliteré côté front).
  secteur: z.string().trim().min(2).max(100).regex(/^[a-z0-9-]+$/, 'Secteur : caractères ASCII minuscules, chiffres et tirets uniquement.'),
  type_client: z.enum(['b2b', 'b2c', 'b2b2c', 'b2g', 'other']),
  // Segment clientèle : précision libre (PME industrielles, fonds VC francophones, etc.).
  // Requis min 3 caractères quand type_client === 'other' (cf. superRefine).
  segment_clientele: z.string().trim().max(200).optional(),
  // ATTENTION : le moteur n8n V6 lit b.tam_usd via le bridge rétro-compat
  // (scoring.js:232). Si renommage futur, mettre à jour les nodes n8n
  // Prep Gemini, Format Data, Prep Sonar Benchmark.
  tam_amount: z.string().trim().min(1).max(32).regex(EUR_AMOUNT_REGEX, 'TAM : format attendu ex. 200K, 15M, 2Md.'),
  estimation_tam: z.string().trim().min(20).max(2000),
  acquisition_clients: z.string().trim().min(20).max(2000),
  concurrents: z.string().trim().min(20).max(2000),
  moat: z.string().trim().min(20).max(2000),
  stade: z.enum(['idea', 'pre-seed', 'mvp', 'seed', 'serieA', 'serieB_plus']),
  revenus: z.enum(['oui', 'non']),
  mrr: z.number().nonnegative().max(100_000_000).optional(),
  clients_payants: z.number().int().nonnegative().max(1_000_000).optional(),
  pourquoi_vous: z.string().trim().min(20).max(2000),
  equipe_temps_plein: z.enum(['oui', 'non']),
  priorite_6_mois: z.string().trim().min(10).max(1000),
  // Rétro-compat n8n : même contrat que tam_amount (voir note ci-dessus).
  // b.montant_leve est aliasé par le bridge (scoring.js:232, stripe.js:331).
  levee_amount: z.string().trim().min(1).max(32).regex(EUR_AMOUNT_REGEX, 'Levée : format attendu ex. 500K, 1.5M, 2Md.'),
  jalons_18_mois: z.string().trim().min(10).max(2000),
  utilisation_fonds: z.string().trim().min(10).max(2000),
  vision_5_ans: z.string().trim().min(20).max(2000),
  autres_informations: z.string().trim().max(3000).optional(),
  linkedin_url: z.string().url().max(500).optional(),
  site_url: z.string().url().max(500).optional(),
  pitch_deck_base64: z.string().min(1).max(15_000_000),
  pitch_deck_filename: z.string().max(200).regex(/\.pdf$/i, 'Le pitch deck doit être au format PDF.'),
  doc_supplementaire_url: z.string().url().max(500).optional(),
  extra_docs: z.array(
    z.object({
      filename: z.string().max(200).regex(/\.(pdf|pptx|docx)$/i, 'Format autorisé : PDF, PPTX ou DOCX.'),
      base64: z.string().min(1).max(14_000_000),
    })
  ).max(5).optional(),
}).strip().superRefine((data, ctx) => {
  if (data.type_client === 'other') {
    const seg = (data.segment_clientele ?? '').trim();
    if (seg.length < 3) {
      ctx.addIssue({
        code: 'custom',
        path: ['segment_clientele'],
        message: 'Segment clientèle requis (min 3 caractères) quand Type de client = Autre.',
      });
    }
  }
});
