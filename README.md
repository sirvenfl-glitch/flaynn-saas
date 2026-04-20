# flaynn-saas

Monorepo Flaynn : API Fastify + frontend statique servi depuis `public/`.

Voir [CLAUDE.md](CLAUDE.md) pour la documentation technique complète (architecture,
contrats API, design tokens, protocole de modification).

## Contributing

### CSP Policy

Ce repo sert une CSP stricte **sans `'unsafe-inline'`** :

```
script-src 'self' https://cdn.jsdelivr.net https://js.stripe.com
```

Tout JavaScript doit être dans un fichier externe de `public/js/` et référencé via :

```html
<script src="/js/mon-script.js" defer></script>
```

Sont **interdits** (bloqués silencieusement par le navigateur et donc cassent les
fonctionnalités concernées) :
- `<script>...code...</script>` (inline exécutable)
- Handlers inline : `onclick="..."`, `onload="..."`, etc.
- URLs `javascript:...`

Seule exception autorisée : `<script type="application/ld+json">` (data block SEO,
non exécuté comme JS, non soumis à `script-src`).

Un pre-commit hook refuse automatiquement tout commit introduisant un script ou
handler inline. Pour l'activer après un clone :

```bash
git config core.hooksPath .githooks
```
