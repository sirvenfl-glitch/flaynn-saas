# Delta 13 — Migration stockage PDF Postgres → Cloudflare R2 — Progress

Suivi atomique des 9 étapes. Une étape = un commit.

## Contexte

DB Render expire le **4 mai 2026**. On libère la DB des PDF stockés en base64 JSONB pour pouvoir prendre un tier payant minimal. Aucun client en prod → aucune migration de données, aucune compat legacy. Les anciens dossiers de test seront purgés manuellement.

## Décisions architecture

- R2 bucket `flaynn-pdfs`, région EEUR, Public Access Disabled.
- Token scopé `Object Read & Write` sur ce bucket uniquement.
- SDK : `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (S3-compatible).
- Clés objets : `reports/{reference_id}.pdf`, `decks/{reference_id}.pdf`, `extras/{reference_id}/{index}.{ext}`.
- Serving : signed URL R2 + 302 redirect (TTL 5 min pour dashboard/view, 10 min pour OCR bypass).
- Ingestion : décodage base64 côté serveur → upload R2 immédiat → DB ne stocke que les métadonnées `{kind:'r2', key, size}`.
- Nouveau format DB : `scores.data.pdf_report_storage` (rapport n8n) et `scores.data.pitch_deck_storage` (deck founder). Extras : `scores.data.extra_docs[i] = {filename, key, size, kind:'r2'}`.
- bodyLimit `/api/score` : 90 MB → 25 MB. `/api/webhooks/n8n/pdf` reste 10 MB. `/api/checkout` : 16 MB → 25 MB (step 9, même Zod que /api/score).
- Uploads R2 en écrasement silencieux (comportement S3 natif), avec `HeadObject` préalable non-bloquant + `warn` si l'objet existe déjà.
- Helpers métier factorisés dans `lib/pdf-upload.js` (step 9) : `extractBase64Payload`, `sanitizeExtension`, `EXTRA_MIME_MAP`, `ALLOWED_EXTRA_EXTENSIONS`. Séparation de niveau vs `lib/r2-storage.js` (couche S3 bas-niveau).

## Checklist

| # | Étape | Statut | Commit |
|---|-------|--------|--------|
| 0 | Découverte + rapport | ✅ | (chat) |
| 1 | Tracker + deps AWS SDK + envSchema + render.yaml | ✅ | e7441e0 |
| 2 | `lib/r2-storage.js` : putObject / getSignedGetUrl / deleteObject + boot validation | ✅ | 19a9056 |
| 3 | Refactor `scoring.js` `POST /api/score` : upload R2 deck + extras | ✅ | fd42360 |
| 4 | Refactor `scoring.js` GET decks (`/:ref` + `/:ref/view` + `/:ref/extra/:index`) : signed URL + 302 | ✅ | c052362 |
| 5 | Refactor `webhooks.js` `POST /api/webhooks/n8n/pdf` : upload R2 | ✅ | 255e88d |
| 6 | Refactor `dashboard-api.js` GET `/:id/pdf` + `has_pdf`/`has_pitch_deck` | ✅ | 6b79721 |
| 7 | bodyLimit `/api/score` 90MB → 25MB | ✅ | 567280e |
| 8 | Smoke test E2E local (stub auth + vrai R2) | ✅ | 785938a |
| 9 | Refactor `stripe.js` `/api/checkout` + handler `checkout.session.completed` | ✅ | b91b743 |

## Env vars nouvelles (Render, `sync: false`)

- `R2_ACCOUNT_ID` — Cloudflare account ID (requis)
- `R2_ACCESS_KEY_ID` — Token R2 access key (requis)
- `R2_SECRET_ACCESS_KEY` — Token R2 secret key (requis)
- `R2_BUCKET` — Nom du bucket R2 (requis, `flaynn-pdfs`)
- `R2_ENDPOINT` — Optionnel, dérivé de `R2_ACCOUNT_ID` si absent : `https://{account_id}.r2.cloudflarestorage.com`

## Format DB cible (après Delta 13)

```json
{
  "status": "pending_analysis|completed|error",
  "pitch_deck_storage":  { "kind": "r2", "key": "decks/FLY-XXX.pdf", "size": 12345 },
  "pdf_report_storage":  { "kind": "r2", "key": "reports/FLY-XXX.pdf", "size": 67890 },
  "extra_docs": [
    { "filename": "original.pdf", "key": "extras/FLY-XXX/0.pdf", "size": 1234, "kind": "r2" }
  ],
  "payload": { /* parsed Zod SANS pitch_deck_base64 ni extra_docs[].base64 */ }
}
```

## Breaking changes assumés

- Anciens dossiers contenant `pitch_deck_base64`/`pdf_base64`/`extra_docs[].base64` deviennent illisibles. Purge manuelle prévue.
- `has_pdf`/`has_pitch_deck` calculés depuis `*_storage.kind === 'r2'`. Dashboard perd la visibilité sur les anciens dossiers.
- Schema Zod `ScoreSubmissionSchema` inchangé (accepte toujours `pitch_deck_base64` côté réseau, mais le base64 n'est plus persisté en DB).

## Sécurité — points à reviewer ligne par ligne

1. `lib/r2-storage.js` — validation config au boot, pas de leak credentials dans les logs, TTL signed URL respectés, `HeadObject` pré-upload non-bloquant.
2. Refactor `scoring.js` upload deck — pas de double écriture base64, purge `payload.pitch_deck_base64` + `payload.extra_docs[].base64` avant persist.
3. Refactor `webhooks.js` upload PDF — signature HMAC conservée, pas de path traversal sur la key (reference_id validé).

## API contract changes

- POST /api/score bodyLimit : 90 MB → 25 MB (step 7). Couvre le 95th percentile des decks + 4 extras. Les uploads au-delà renvoient 413 Payload Too Large — à gérer côté frontend en V2.
- POST /api/checkout bodyLimit : 16 MB → 25 MB (step 9). Alignement avec /api/score (même ScoreSubmissionSchema, même contrat). Les uploads au-delà renvoient 413 — à gérer côté frontend en V2.

## TODO / Dette connue

- Cleanup R2 orphelins sur échec partiel upload extra_docs : si le `putObject` échoue au milieu d'un array d'`extra_docs`, les uploads déjà faits restent dans R2 (orphelins). Acceptable v1 (coût R2 négligeable, zéro risque fonctionnel). V2 : wrapper transactionnel ou cleanup batch hebdomadaire.
- Webhook checkout.session.completed : assume payload sans base64 (format Delta 13+). Replay d'un event pré-Delta 13 en dev : base64 transmis inutilement à n8n, sans crash. Acceptable (Stripe en test actuellement, zéro session stale).

## Points hors scope Delta 13

- Migration des données existantes (aucune — purge manuelle des vieux dossiers de test).
- Validation anti-virus sur upload (à évaluer post-Delta 13).
- Quota / monitoring R2 (dashboard Cloudflare suffit).
- Remplacement des PDF déjà uploadés en cas de re-scoring (idempotence = écrasement silencieux + warn).
