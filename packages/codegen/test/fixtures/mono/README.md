# Monorepo fixture

`app/` imports two packages that the test links into `app/node_modules/` (they are not committed
there): `@fx/models`, a workspace package (symlinked, like pnpm does, and resolved to its source),
and `vendor-lib`, a published package (copied, `.d.ts` + `.js`). The router never imports the
schema classes it returns, so the generator has to find their package import paths itself.
