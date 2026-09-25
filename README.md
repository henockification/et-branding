# ET Branding

A pnpm + Turborepo monorepo: a TanStack Start web app on Cloudflare Workers,
Neon Postgres via Drizzle, and a provider-agnostic TypeScript agent layer.

## Layout

| Path              | What it is                                                                |
| ----------------- | ------------------------------------------------------------------------- |
| `apps/web`        | TanStack Start (React 19, Vite 8, Tailwind 4, shadcn/ui, TanStack Query)   |
| `packages/agents` | Agents on the Vercel AI SDK — model registry, tiers, cost accounting       |
| `packages/db`     | Drizzle schema and a Neon client built for Workers                         |
| `packages/auth`   | Better Auth config — email/password and Google, on the Drizzle adapter     |
| `packages/core`   | Branding constants plus shared domain types and Zod schemas                |

## Getting started

```bash
pnpm install
cp apps/web/.dev.vars.example apps/web/.env
pnpm --filter @et/db db:migrate
pnpm dev
```

Runs on http://localhost:3100. Fill in `apps/web/.env` first: `DATABASE_URL`
for Neon, `BETTER_AUTH_SECRET` (`openssl rand -base64 32`) and
`DEEPSEEK_API_KEY` for the agent tier. The dev server reads that file **at
startup**, so restart it after editing.

`.env` and `.dev.vars` are the same file: the Workers runtime only reads
`.dev.vars`, so `pnpm dev` links one to the other. Edit whichever name you
prefer — there is only ever one file.

`/dev/health` is scaffolding, not product: it runs an agent and pings the
database, printing the model, token counts and cost. Delete it once real
features cover the same ground.

In production these are Worker secrets, not files:

```bash
pnpm --filter @et/web exec wrangler secret put DATABASE_URL
pnpm --filter @et/web exec wrangler secret put BETTER_AUTH_SECRET
```

## Auth

Better Auth, self-hosted on the Drizzle/Neon setup. Email + password today,
with "Continue with Google" appearing on the sign-in page as soon as
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are both set (redirect URI
`<origin>/api/auth/callback/google`). Every endpoint lives under the splat
route `apps/web/src/routes/api/auth/$.ts`.

Better Auth was chosen over a custom session layer mainly for what comes next:
publishing to Instagram, LinkedIn and the rest means storing and refreshing
third-party OAuth tokens per user, and the `account` table plus the
account-linking machinery already handle that. Rolling our own sessions now
would mean building that part from scratch later too.

**The route guard is not the security boundary.** `_authed.tsx` only decides
which screens render; server functions and server routes are ordinary
endpoints reachable on their own. Every function that touches user data
re-checks the session itself and throws a 401 — see `requireUserId` in
`apps/web/src/server/brands.ts`, and copy that pattern for new ones.

Two deliberate settings: email verification is **off**, because no email sender
is wired up and a verification mail that never arrives would lock out every new
account — turn it on in the same change that adds the sender. And sign-in
failures say only "that email and password do not match an account", so the
form cannot be used to discover which addresses have accounts.

Auth tables mirror exactly what Better Auth's `getAuthTables()` reports, so the
adapter finds every field. Keep product columns out of them — application data
hangs off `user.id` from its own tables, which is why `brand` is separate.

## Branding

The identity comes from the ET Branding design system (vendored at
[docs/brand/brand-book.md](docs/brand/brand-book.md) and
[docs/brand/tokens.json](docs/brand/tokens.json)). Treat those as the source of
truth and copy values exactly rather than re-deriving them.

`packages/core/src/branding.ts` holds the name, tagline, description, theme
colour and the logo paths. "ET Branding" is a working name — the mark contains
no letters precisely so the name can change without redrawing it. A rename is
that file plus the `name` in `apps/web/wrangler.jsonc` (the Worker's identity).

The mark is **Social Brain**: two hemispheres (the AI), a speech-bubble tail
(the conversation), a three-node share shape and a lime notification dot
(social). Variants live in `apps/web/public/brand/` — `mark-primary.svg` on
light grounds, `mark-reverse.svg` on the dark surface, `app-icon.svg` for the
favicon. The system forbids recolouring, mirroring or rotating the mark, so
`BrandMark` swaps files per theme rather than filtering one.

`apps/web/src/styles.css` carries the tokens verbatim: Ultraviolet `--brand`
(#6A2BE0 light, #8F5CFF dark) as the base, `--spark` lime (#C8F03C) as the
counterpoint, and violet-tinted neutrals. Two rules from the brand book that
are easy to break:

- **Spark is rationed to one element per screen**, and always carries ink text
  at 14:1 — never white on lime.
- **`brand-soft` and `brand-deep` are decorative**, not body text.

Type is Space Grotesk (display) and Inter (text), both from Google Fonts. The
named styles ship as classes — `type-display-xl`, `type-heading`, `type-body`,
`type-label` and the rest — so a heading carries the system's size, weight and
tracking together instead of a stack of ad-hoc utilities. Spacing and radius
steps are `brand-2/4/6/12` and `rounded-sm/md/lg` (6/12/24px).

Chart tokens are placeholders. Design a real palette alongside the first chart.

## How agents pick a model

Agents never name a model. They declare a **tier** — `cheap`, `balanced` or
`premium` — and `packages/agents/src/models/registry.ts` resolves it through the
catalog in `models/catalog.ts`. That is the only file that knows DeepSeek,
OpenAI or Anthropic exist, so adding a provider or re-pointing a tier at a
cheaper model is a one-file change with no edits to agent code.

```ts
import { defineAgent } from '@et/agents'

const namer = defineAgent({
  id: 'namer',
  tier: 'cheap',
  instructions: 'Propose brand names. One per line.',
})

const { output, cost } = await namer.run('A coffee roaster in Addis Ababa.')
console.log(output, cost.usd)
```

Cost control, in order of leverage:

1. **Tier defaults are cheap-first.** `cheap` and `balanced` both resolve to
   DeepSeek; only `premium` reaches for a frontier model. Promote an agent to
   `premium` only after a cheaper tier has visibly failed at the job.
2. **Every call reports its own cost.** `run()` returns a `CallCost`, so spend
   is measurable per agent rather than guessed at from a monthly invoice.
3. **Keep instructions stable.** Cached input tokens bill at the provider's
   cache-read rate, which the cost estimator accounts for.
4. **`ET_DEFAULT_MODEL`** overrides every tier at once — the quick way to price
   a whole workflow on a different provider without touching code.

Catalog prices are indicative and stamped with `pricedOn`. Check them against
the provider's pricing page before quoting a number to anyone.

## Database

Neon over Drizzle, using the **HTTP** driver rather than the WebSocket pool:
on Workers each query is a stateless fetch, so there is no connection to hold
open across an isolate's life and no pool to exhaust. The tradeoff is that
interactive transactions are unavailable — use `db.batch()` instead.

```bash
pnpm --filter @et/db db:generate   # write a migration from schema changes
pnpm --filter @et/db db:migrate    # apply migrations
pnpm --filter @et/db db:studio     # browse the data
```

`packages/db/src/schema/` holds Better Auth's tables plus `brand`. Ownership is
a plain `ownerId` on `brand`: one user owns many brands, and adding teams later
means adding a `brand_member` table alongside it rather than reworking what a
brand belongs to. Neon branches are cheap — give each environment its own.

## Deployment

```bash
pnpm --filter @et/web deploy
```

Cloudflare Workers via `wrangler.jsonc`. The Cloudflare Vite plugin owns the
`ssr` environment, which is why the generic Nitro adapter is deliberately
absent — running both leaves Nitro's SSR renderer unable to reach the server
environment and every page 404s.

## Commands

```bash
pnpm dev         # turbo run dev
pnpm build       # turbo run build
pnpm typecheck   # tsc --noEmit across packages
pnpm check       # biome check
```

## Not yet decided

- **Email.** No sender, so no password reset and no email verification.
  Cloudflare Email Service fits the stack.
- **The domain itself.** The brand book says what the product is — a team of
  agents doing strategy, content, design and distribution — but not how it
  works: no user flows, no data model, no agent hand-offs.
  `packages/db/src/schema.ts` stays close to empty until that lands.
