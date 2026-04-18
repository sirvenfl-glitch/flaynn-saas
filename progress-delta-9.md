# Delta 9 — Flaynn Score Card publique partageable — Progress

Suivi atomique des étapes du plan d'exécution (section 11 du doc d'architecture V2).
Stack réelle : table `scores(reference_id VARCHAR, data JSONB)`, dashboard SPA vanilla,
Fastify 5 ESM. Voir rapport de découverte pour divergences avec le doc.

| # | Étape | Statut | Commit |
|---|-------|--------|--------|
| 1 | DB + slug + route SSR stub `/score/:slug` | ✅ | 15ecede |
| 2 | API `POST/DELETE` publish/unpublish | ✅ | feb7e63 |
| 3 | OG image Satori + route `/og/:slug.png` + warm-up boot | ✅ | 3825865 |
| 4 | Meta OG/Twitter/JSON-LD + sitemap dynamique + CSP nonce/hash JSON-LD | ✅ | e7f8527 |
| 5 | CSS card publique (`public/css/score-card.css`) + responsive | ✅ | a25077c |
| 6 | Toggle dashboard (3 états) injecté dans `app.js` (el() helper) | ✅ | e2c3f05 |
| 7 | Polish copywriting + A11y + smoke test end-to-end 14/14 | ✅ | 0236825 |

## Décisions prises (validées phase 1)

- **Table des reports** : `scores(reference_id VARCHAR(50), data JSONB)`, pas `reports(id INTEGER)`.
- **FK** : `public_cards.reference_id VARCHAR(50) REFERENCES scores(reference_id) ON DELETE RESTRICT`.
  `public_cards.id SERIAL` conservé pour la FK future de `intro_requests.card_id` (delta 12).
- **Endpoints** : `POST /api/dashboard/:id/publish` + `DELETE /api/dashboard/:id/publish/:cardId`
  (`:id` = `reference_id`, pattern `/api/dashboard/:id/pdf` existant).
- **Verdicts publiables** : `{'Ready', 'Almost', 'Yes', 'Strong Yes'}`. Seul `'Not yet'` refusé.
- **noindex** : `verdict === 'Almost' && score < 70`. `score` = `data->>'score'`, fallback `data->>'overall_score'`.
- **Piliers** : clés EN en DB (`market, solution_product, traction, team, execution_ask`), labels FR à l'affichage.
- **Forces/challenges** : `data.top_3_strengths[]` et `data.top_3_risks[]`. Publish bloqué si < 3.
- **UI dashboard** : injectée dans `public/dashboard/app.js` via `el()` helper, pas dans HTML statique.
- **Starfield** : réutilisation du script existant (`public/js/starfield.js`), `defer` + check CWV post-deploy.
- **Warm-up Satori** : render fantôme 100×100 jeté au boot (loadFonts + render) pour éviter cold path.
- **Sitemap** : route dynamique enregistrée AVANT `fastifyStatic`. Suppression `public/sitemap.xml` en J4.
- **BA CTA** : simple `<a href="https://flaynn.com/rejoindre">`, site statique Vercel séparé. Zéro cross-origin.
- **Migrations** : extension de `initDB()` (pattern delta 12), pas de runner externe.

## TODO / Dette connue

- **FK `intro_requests.card_id → public_cards(id)`** : la table `public_cards` existe dès J1, mais l'ALTER
  d'ajout de la FK est laissé à une étape d'intégration explicite (séparée) pour éviter de modifier un schéma
  delta 12 sans accord. TODO restera jusqu'à décision.
- ~~**CSP + JSON-LD**~~ : tranché en J4 — hash SHA-256 par card calculé dans `renderCardPage`, header CSP scoped
  à la réponse `/score/:slug` via `buildCspHeader([jsonLdHash])` dans `config/security.js`. `reply.header()` en
  handler écrase le header helmet (last-write-wins). Policy globale conservée stricte.
- **OG PNG sur filesystem Render éphémère** : accepté. Lazy re-render dans `GET /og/:slug.png` (J3).
- ~~**Trailing slash canonical**~~ : traité en J4 — route explicite `/score/:slug/` renvoie 301 vers la version
  sans slash.

## Points sensibles à relire ligne par ligne (rappel user)

1. Génération slug — escape + unicité : [flaynn-api/src/lib/slug.js](flaynn-api/src/lib/slug.js)
2. Génération OG Satori : [flaynn-api/src/lib/og-render.js](flaynn-api/src/lib/og-render.js) (J3)
3. Warm-up Satori au boot : [flaynn-api/src/server.js](flaynn-api/src/server.js) (J3)

## Smoke test end-to-end (J7)

[flaynn-api/scripts/smoke-delta-9.mjs](flaynn-api/scripts/smoke-delta-9.mjs) — `npm run test:smoke-delta-9`

Mocke `pool.query` (pattern-match SQL), monte une Fastify isolée avec helmet + routes
+ stub `authenticate`, exécute 14 scénarios via `fastify.inject()`. Le warm-up Satori
et le render OG tournent en vrai (PNG 126 KB généré). Durée : ~3s incluant warm-up.

Couverture : 403 Not yet, 403 insufficient content, 201 publish, 200 idempotent, 404
slug inconnu, 200 HTML + CSP hash + JSON-LD, 301 trailing slash, 200 OG PNG,
200 sitemap, 200 dashboard enrichi, 200 DELETE, 410 après unpublish, 200 DELETE
idempotent, sitemap après unpublish.

## Checklist post-deploy (à cocher après premier deploy Render)

- [ ] [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/) — 0 warning, image OG détectée
- [ ] [Twitter Card Validator](https://cards-dev.twitter.com/validator) — summary_large_image rend correctement
- [ ] [LinkedIn Post Inspector](https://www.linkedin.com/post-inspector/) — preview complet
- [ ] Test partage réel WhatsApp mobile — rich preview
- [ ] Test partage réel Slack — unfurl complet
- [ ] Test partage réel Discord — embed
- [ ] Lighthouse mobile sur `/score/<slug>` — Perf ≥ 90, A11y ≥ 95, SEO ≥ 95
- [ ] Google Search Console — sitemap soumis, première card indexée sous 7 jours
- [ ] Vérifier CSP header en prod : `curl -I https://flaynn.tech/score/<slug>` contient `'sha256-...'`
- [ ] Lien CTA `https://flaynn.com/rejoindre` actif (dépendance delta 12)
