import { randomBytes } from 'node:crypto';

// ARCHITECT-PRIME — Delta 9 : génération de slug public pour public_cards.
// Sensibilité haute : l'output alimente une URL publique (/score/:slug) ET une clé
// unique en DB. Deux invariants tenus par ce module :
//   1. Le slug sortant appartient strictement à [a-z0-9-]{1,80} (URL-safe + SQL-safe
//      via paramétrisation $1, aucun risque d'injection).
//   2. L'unicité est garantie par round-trip SELECT avant l'INSERT (race théorique
//      résolue par la contrainte UNIQUE côté DB qui remontera une erreur PG
//      à l'INSERT si collision entre SELECT et INSERT).

const MAX_BASE_LENGTH = 60;           // + 1 hyphen + 4 hex = 65 chars, sous le VARCHAR(80)
const SUFFIX_HEX_BYTES = 2;           // 4 chars hex = 65 536 combinaisons par base
const MAX_ATTEMPTS = 5;
const FALLBACK_BASE = 'flaynn-card';

export function slugify(input) {
  if (typeof input !== 'string') return '';
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')          // retire les diacritiques (é → e)
    .replace(/[^a-z0-9\s-]/g, '')             // retire tout char hors [a-z0-9 -]
    .replace(/\s+/g, '-')                     // espaces → hyphens
    .replace(/-+/g, '-')                      // collapse hyphens
    .replace(/^-+|-+$/g, '')                  // trim hyphens
    .slice(0, MAX_BASE_LENGTH);
}

export async function generateUniqueSlug(startupName, db) {
  const base = slugify(startupName) || FALLBACK_BASE;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const suffix = randomBytes(SUFFIX_HEX_BYTES).toString('hex');
    const slug = `${base}-${suffix}`;
    const { rows } = await db.query(
      'SELECT 1 FROM public_cards WHERE slug = $1 LIMIT 1',
      [slug]
    );
    if (rows.length === 0) return slug;
  }
  const err = new Error('Slug generation failed after 5 attempts');
  err.code = 'SLUG_GENERATION_FAILED';
  throw err;
}
