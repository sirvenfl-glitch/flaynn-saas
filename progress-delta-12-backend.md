# Delta 12 — Backend (flaynn-saas) — Progress

Suivi atomique des étapes de la checklist 9.A du doc d'architecture V2.

| # | Étape | Statut | Commit |
|---|-------|--------|--------|
| 0 | Découverte + rapport | ✅ | (chat) |
| 1 | Tracker de progression | ✅ | `afe1c73` |
| 2 | Migration DB : `business_angels`, `intro_requests`, `ba_digests` | ✅ | `0453f79` |
| 3 | CORS : autoriser `https://flaynn.com` | ✅ | `a2ae803` |
| 4 | `src/lib/intro-token.js` (HMAC sign/verify) | ✅ | `10dc004` |
| 5 | Env vars (`STRIPE_PRICE_BA_SUBSCRIPTION`, `INTRO_TOKEN_SECRET`, `ADMIN_EMAILS`, `BA_PUBLIC_BASE_URL`) | ✅ | `8d01741` |
| 6 | `routes/ba-apply.js` (Zod strict, dedup, Stripe Checkout subscription) | ✅ | `128cc6a` |
| 7 | Extension `/api/webhooks/stripe` pour 3 events BA | ✅ | `b3da346` |
| 8 | `routes/ba-intro-request.js` (verify token + n8n bridge) | ✅ | `22ab68e` |
| 9 | `routes/admin-ba.js` (validation manuelle + refund) | ✅ | `86b9947` |
| 10 | Wiring server.js + `.env.example` + `render.yaml` | ✅ | (ce commit) |

## Endpoints livrés

| Méthode | Route | Auth | Rate limit |
|---------|-------|------|------------|
| POST    | `/api/ba/apply`             | Public | 5/h/IP |
| POST    | `/api/ba/intro-request`     | HMAC token | 20/h/IP |
| POST    | `/api/webhooks/stripe`      | Stripe signature | 100/min |
| GET     | `/api/admin/ba`             | Cookie + ADMIN_EMAILS | 60/min |
| GET     | `/api/admin/ba/:id`         | Cookie + ADMIN_EMAILS | 60/min |
| PATCH   | `/api/admin/ba/:id/validate`| Cookie + ADMIN_EMAILS | 30/min |
| PATCH   | `/api/admin/ba/:id/reject`  | Cookie + ADMIN_EMAILS | 30/min |

## Vars Render à set manuellement (sync: false)

- `STRIPE_PRICE_BA_SUBSCRIPTION` — créer un product Stripe "Flaynn BA" 350€/mois recurring, copier le `price_*`
- `INTRO_TOKEN_SECRET` — générer : `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- `ADMIN_EMAILS` — CSV des emails admin (lowercased)

## Reste à faire (hors scope backend Delta 12)

- Frontend `flaynn-investors/rejoindre/` (autre repo)
- Workflows n8n `Flaynn_Matching_BA_V1` et `Flaynn_Intro_Request_V1` (à importer dans l'instance n8n)
- FK `intro_requests.card_id → public_cards(id)` quand le delta 9 sera livré
- Endpoint `DELETE /api/ba/:id/rgpd-erase` (purge complète sur demande RGPD) — V2

## Décisions prises (défauts validés)

- **Auth admin** : whitelist email via env `ADMIN_EMAILS=email1,email2` + check sur `request.user.email` après `fastify.authenticate`.
- **Stripe webhook** : extension de `/api/webhooks/stripe` existant (un seul endpoint Stripe), routage par `client_reference_id`/metadata `source`.
- **n8n** : workflows JSON non versionnés dans le repo. Notif admin + email welcome délégués à n8n via `n8nBridge`.
- **`public_cards` (delta 9)** absent → table `intro_requests` créée **sans FK** vers `public_cards`, avec check applicatif. TODO comment laissé.
- **DB migrations** : extension de `initDB` (option A) — pas de runner externe.
- **CORS** : ajout de `https://flaynn.com`. `credentials: true` conservé (compat existant) ; les requêtes BA n'envoient pas de cookies de toute façon.

## Sécurité — points à reviewer ligne par ligne (rappel)

1. Webhook Stripe — signature verification (rawBody buffer + `stripe.webhooks.constructEvent`)
2. Intro token HMAC — `timingSafeEqual` côté verify, expiration 30j, secret env ≥ 32 chars
3. Validation server-side du formulaire BA — Zod `.strict()`, regex LinkedIn, `ticket_min ≤ ticket_max`, dedup email
4. CORS — pas de `origin: '*'`, méthodes restreintes, allowlist explicite
