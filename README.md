# Negarit Branding

A pnpm + Turborepo monorepo: a TanStack Start web app on Cloudflare Workers,
Neon Postgres via Drizzle, and a provider-agnostic TypeScript agent layer.

## Layout

| Path              | What it is                                                                |
| ----------------- | ------------------------------------------------------------------------- |
| `apps/web`        | TanStack Start (React 19, Vite 8, Tailwind 4, shadcn/ui, TanStack Query)   |
| `packages/agents` | Agents on the Vercel AI SDK — model registry, tiers, cost accounting       |
| `packages/db`     | Drizzle schema and a Neon client built for Workers                         |
| `packages/auth`   | Better Auth config — email/password and Google, on the Drizzle adapter     |
| `packages/email`  | Transactional email: Cloudflare Email Service, with a log-only fallback   |
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

Password reset is wired: `/forgot-password` → emailed link → `/reset-password`.
Tokens last an hour and are single-use. Sign-in failures say only "that email
and password do not match an account", and the reset form says "if that address
has an account" whether or not it does — neither can be used to discover which
addresses are registered.

Email verification is still **off**. Turn it on once real mail is sending,
in the same change — a verification mail that never arrives locks out every
new account.

Auth tables mirror exactly what Better Auth's `getAuthTables()` reports, so the
adapter finds every field. Keep product columns out of them — application data
hangs off `user.id` from its own tables, which is why `brand` is separate.

## Branding

The identity comes from the design system (vendored at
[docs/brand/brand-book.md](docs/brand/brand-book.md) and
[docs/brand/tokens.json](docs/brand/tokens.json)). Treat those as the source of
truth and copy values exactly rather than re-deriving them.

`packages/core/src/branding.ts` holds the name, tagline, description, theme
colour and the logo paths. The product was renamed from "ET Branding" to
"Negarit Branding" by editing that file and the `name` in
`apps/web/wrangler.jsonc` (the Worker's identity) — the mark itself needed no
change, because it contains no letters. The vendored `docs/brand/` snapshot
still carries the old working name; update it at the design-system source.

The internal package scope is still `@et/*` and the repository is still
`et-branding`. Both are private to the codebase and can be renamed whenever
it's convenient.

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

Every model call goes through **OpenRouter** — one key, one bill, any vendor.
`OPENROUTER_API_KEY` is the only model credential.

Agents never name a model. They declare a **tier** — `free`, `cheap`,
`balanced` or `premium` — and `packages/agents/src/models/registry.ts` resolves
it through the catalog in `models/catalog.ts`. That is the only file that names
a model, so re-pointing a tier is a one-file change with no edits to agent code.

Measured on 2026-09-26, `cheap` (`deepseek/deepseek-v4-flash`) answers a short
caption request for about **$0.00001** — roughly 100,000 calls per dollar. The
`free` tier exists but is rate-limited upstream and failed outright in testing;
at those prices it is not worth the unreliability.

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

1. **Tier defaults are cheap-first.** `cheap` and `balanced` are both DeepSeek
   models; only `premium` reaches for a frontier model. Promote an agent to
   `premium` only after a cheaper tier has visibly failed at the job.
2. **Every call reports its own cost.** `run()` returns a `CallCost`, so spend
   is measurable per agent rather than guessed at from a monthly invoice.
3. **Keep instructions stable.** Cached input tokens bill at the provider's
   cache-read rate, which the cost estimator accounts for.
4. **`ET_DEFAULT_MODEL`** overrides every tier at once — the quick way to price
   a whole workflow on a different provider without touching code.

Catalog prices come from OpenRouter's live catalogue and are stamped with
`pricedOn`. They move — re-check `https://openrouter.ai/api/v1/models` before
quoting a figure to anyone.

### Amharic is switched off

`packages/core/src/languages.ts` decides which languages agents may write in.
Amharic is `enabled: false` pending a quality review with the client and a
decision on its cost. Turning it on is that one flag — the database's
`content_language` enum already accepts `"am"`, so no migration is needed, and
every surface reads the list rather than hard-coding a language.

### Amharic costs more than English

The same request in Amharic used **3.6x the input tokens** and produced far more
output than its English twin, making a bilingual post roughly **6–8x** the cost
of an English one on the same model. Ge'ez script tokenizes poorly, so this is
structural, not a one-off. It is still fractions of a cent per post, but it
compounds at volume and should inform any per-client budget.

### Embeddings are not on OpenRouter

OpenRouter serves no embedding models — zero of 458 in its catalogue. The Brand
Brain's document search needs a separate provider: OpenAI directly, or
Cloudflare Workers AI through a Worker binding, which adds no new vendor and has
multilingual models. Not wired up yet; the choice changes the embedding column
width, so it is cheaper to settle before loading documents.

## The Brand Brain

`brand_profiles` is the structured half — name, summary, voice, audience,
services — edited at `/workspace/$orgId` and handed to every agent before it
writes a word. The shapes live in `packages/core/src/brand-profile.ts` because
they are the contract between the form and the prompt; they are JSON columns,
so adding a field needs no migration, but it also needs a line in the prompt
builder to have any effect.

How much this matters, measured on the same brief with the same model:

> **Empty profile:** "The first sip tastes like a clear morning in the
> highlands… a finish that lingers like a deep breath. Slow down, taste the
> difference."
>
> **Filled profile:** "New roast on the shelf. Yirgacheffe. Clean, bright,
> floral. Tastes like the highlands it comes from. Available now for wholesale
> and home subscription."

The second one obeys every rule the profile set — short sentences, names the
region, no exclamation marks, none of the banned jargon — and mentions the
actual sales channels. The extra context cost 158 input tokens, about
$0.000007. Filling the profile is the cheapest quality improvement available.

## The Telegram bot

The bot is the product's main interface — Ethiopian businesses live on
Telegram, and the web app is the admin surface, not the daily one.

```bash
# once you have a token from @BotFather, in apps/web:
pnpm --filter @et/web telegram:webhook https://your-deployment-url
```

Telegram requires HTTPS, so the webhook cannot point at localhost. Develop
against a deployed preview, or drive the endpoint directly — every handler is
reachable by POSTing an Update to `/api/telegram/webhook` with the right
secret header, which is how the flows below were verified without a bot.

**Answering fast.** The webhook claims the `update_id` (a primary key in
`telegram_updates`, insert-on-conflict-do-nothing), answers 200, and does the
work in `ctx.waitUntil`. Before this it awaited a 6–15 second draft inside the
request, and Telegram retries deliveries it considers failed — so a slow draft
could be generated twice. Telegram does not document its retry rules, which is
exactly why the claim exists rather than trusting a fast response. The
`ExecutionContext` reaches the route through async-local storage set in
`src/worker.ts`, since Start passes only the request through.

**Security.** The webhook URL is public, so the shared secret Telegram echoes
in `X-Telegram-Bot-Api-Secret-Token` is the only thing separating real updates
from anyone who guesses the path. It is compared in constant time, and falls
back to `BETTER_AUTH_SECRET` so the bot is never accidentally left open. The
handler always answers 200 once the secret checks out: a non-200 makes Telegram
retry, and retrying an update that triggered a bug just repeats the bug.

**Linking.** `/start <invite>` attaches a Telegram account to a workspace. The
invite is a signed token, not a database row — Telegram caps deep-link payloads
at 64 characters, so it packs the org id, an expiry and a truncated HMAC into
30 bytes of base64url (40 characters). That means no invite table, no cleanup
job, and no forging a link by guessing an org id. Owners and approvers mint
them from the dashboard; they last 24 hours.

**Capturing past posts.** Forward a post to the bot and it is saved as a
`brand_document` — no command, because a forward is an unambiguous "learn from
this". Typed text needs `/remember`, otherwise every "ok" in the chat becomes
training data. Photo captions are captured (the words, not yet the image),
duplicates are refused, and anything under 40 characters is rejected as a
remark rather than a post. `/brain` reports what the brain holds.

### What a draft learns from

Three sources, each capped separately, all replayed into the prompt:

| Source | Cap | Why |
| --- | --- | --- |
| Past posts (`brand_documents`) | 50 | What the brand sounds like |
| Approved drafts, untouched | 20 | The agent got these right — capped lower, since they are its own output and it can reinforce its own habits |
| Corrections (`original_body` → `body`) | 10 | Exactly where it went wrong — capped tightest, so old mistakes do not drown out the voice |
| Explained rejections | 10 | What to avoid, and why — unexplained ones are skipped |

Corrections come last in the prompt, closest to the brief.

**Measured:** with three consistent corrections stripping hashtags, emoji and
hype, the same brief went from

> "Capture your corporate story with precision… #CorporatePhotography
> #EventProduction"

to

> "We now offer photography for corporate events. Contact us for details."

One correction nudges; three change the behaviour decisively.

**The limit worth knowing:** corrections teach *style*, not *facts*. When a
human's rewrite adds information the agent never had — a time, a price, a venue
— there is nothing there to learn, and the next draft will not invent it. That
is the prompt working as intended, but it means corrections are not a substitute
for putting facts in the brief.

Every draft is sent the **whole corpus**, newest first, up to 50 posts — not a
retrieved subset. Fifty posts is roughly 6,000 tokens, a fraction of a cent on
the cheap tier, so embeddings would be machinery bought for a problem this size
does not have. Revisit when one brand has thousands of posts; the schema
already supports it.

**Just say what you want.** Plain text is a brief — "we are hiring two camera
operators" drafts a post, no command required. Slash commands still work as
aliases, and a persistent button keyboard (Write a post / This week / What you
know / Help) means nobody has to learn one. The commands are registered with
`setMyCommands`, so Telegram's Menu button lists them instead of being empty.

Messages that are entirely pleasantries ("ok thanks") are ignored, matched per
word rather than per phrase — a phrase list let "ok thanks" through and turned
an acknowledgement into a paid model call. Non-text messages get an honest
reply rather than the silence they used to get.

**Refinements.** Under every draft: Try again / Shorter / Add a CTA, and you can
reply to a draft with free text ("mention it is full time"). A refinement
rewrites the same `content_items` row, logs its own `agent_runs` entry, and
never touches `original_body` — that field means "what the agent wrote before a
*human* replaced it", and machine iterations must not be mistaken for human
signal.

Replying to a draft used to be read as a human rewrite, because draft footers
and edit prompts both carried `Ref:`. That silently approved the draft and
recorded a correction nobody made — poisoning the strongest training signal in
the system. Footers now carry `Draft:` and only the Edit prompt carries `Ref:`.

**Drafting.** `/draft <brief>` writes a post in the brand's voice, stores it at
status `draft`, and sends it with Approve / Edit / Reject buttons. Nothing is
published — a human moves every item forward. Each run opens a row in
`agent_runs` *before* the model is called, so failures are logged too; an
action log containing only successes is not an action log.

Generation and delivery are separate steps. A draft is written, saved, and the
run marked succeeded *before* any Telegram send — so a delivery failure cannot
relabel work that was actually done, and the draft is not lost. The typing
indicator is best-effort for the same reason: losing a draft because a cosmetic
call hiccuped would be absurd.

**Editing.** Tapping Edit asks for a rewrite; replying with it replaces the
body, approves the item, and keeps the agent's original in `feedback`. That
pair — what was written, and what a person changed it to — is the most
informative signal the system produces: a rejection says something was wrong,
an edit says exactly what.

Linking a reply back to its draft is stateless. Telegram carries no payload on
a reply, only the text of the message being replied to, so the draft's id is
written into that text as `Ref: xxxxxxxx` and read back out. No pending-edit
column, no expiry to manage, and two drafts can be edited at once without one
clobbering the other. Lookups are scoped by organization, so an eight-character
prefix is unambiguous.

**Rejections.** Reject records the decision immediately, then asks why — and
the answer is optional. Making an explanation mandatory would make rejecting
feel expensive, and people would approve mediocre drafts to avoid the friction,
which is the one outcome that poisons everything downstream.

Only rejections with a stated reason reach later prompts. A bare "no" says
something was wrong without saying what, and a list of unexplained rejections
would teach the model to avoid their *subjects* rather than their faults.

Both follow-ups use the same stateless reply mechanism, and the label carries
the intent: `Ref:` after Edit, `Why:` after Reject. Inferring intent from the
item's status would be guesswork, since the same reply shape means different
things.

**Approvals.** Inline Approve / Reject buttons write to `content_items` with
who decided and when, then the buttons are removed so a decision cannot be
double-submitted. Callback payloads are client-supplied, so every lookup is
scoped by `org_id` as well as id — otherwise one workspace could act on
another's draft.

## The content queue

`/content/$orgId` shows every draft, approval, edit and rejection for a
workspace, filtered by status, with the learning pair visible: what the agent
wrote and what a human changed it to, side by side.

Items are classified by **origin** — proposed by the weekly plan, or asked for
with `/draft` — and the two filter independently of status, so "planned posts
still waiting" is one click. Planned items show the date they were intended for
and the angle the planner gave them.

That classification is a column, not prose. The weekly plan used to record
itself in `feedback`, which is the same field rejection reasons use: rejecting
a planned post would either lose the plan or hand "Planned for Wednesday…" to
the model as the reason the post was thrown out. `origin`, `planned_for` and
`angle` are their own columns now, and `feedback` belongs to humans.

Above the list is what the *next* draft will learn from — past posts, clean
approvals, corrections, explained rejections — because the caps are not
obvious from the list itself, and four numbers are the quickest way to see why
drafts are or are not improving. Rejections with no reason are counted
separately and called out, since they teach nothing.

Read-only on purpose. Approving, editing and rejecting stay in Telegram, where
whoever is reviewing already is; duplicating those decisions on the web would
mean two paths to the same state and buttons in Telegram that silently act on
an item already decided elsewhere.

**Page loaders return, they do not throw.** A thrown `Response` is right for a
mutation, but a loader that throws one escapes as an unhandled 500 and the
visitor sees raw JSON instead of the app — which is exactly what happened here
before it was caught. Read paths return `{ found: false }` and the route turns
that into the app's own not-found page. "Not a member" and "no such workspace"
are the same answer, so a response never confirms an id is real.

## The weekly plan

Every Monday at 06:00 UTC (09:00 in Addis) a Cloudflare Cron Trigger wakes the
Worker, and each organization gets three to five posts planned for the week,
delivered to Telegram as individual drafts with the usual buttons. `/plan` runs
it on demand.

`main` in `wrangler.jsonc` points at `src/worker.ts` rather than Start's default
entry: Start exports only `fetch`, and Cloudflare delivers cron to `scheduled`,
so the two are composed by hand instead of running a second Worker for it.

The plan is **idempotent per week**. A cron that fires twice, or a retry after a
partial failure, finds the successful `weekly_plan` run already in `agent_runs`
and skips — the action log is the source of truth for what has run, which is
cheaper and more honest than a lock. `/plan` passes `force` so a human asking
is never refused.

It refuses to plan for a brand with an empty profile. Five generic adverts are
worse than no plan: they teach people to ignore the Monday message.

Organizations are planned one at a time, and one tenant's failure never stops
the rest.

## Email

Cloudflare Email Service through the Workers `send_email` binding — no API key,
since the binding carries the account's own authority. `resolveEmailSender`
picks it when both the binding and `EMAIL_FROM` are present, and otherwise
falls back to a sender that prints the message to the log.

That fallback is deliberate, not a stub: Email Service will only accept a
`from` on a domain onboarded with `wrangler email sending enable`, which a
local machine does not have. Printing the mail keeps password reset testable
offline, and makes it obvious in the log that nothing was delivered. To send
for real:

```bash
pnpm --filter @et/web exec wrangler email sending enable yourdomain.com
```

then set `EMAIL_FROM` to an address on that domain.

Templates are plain HTML with inline styles — mail clients strip stylesheets,
and CSS variables do not survive the trip, so the brand colour is inlined.
Every message ships `html` and `text`; some clients show only the latter, and
it helps spam scores.

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

`packages/db/src/schema/` holds Better Auth's tables plus the domain model:
`organizations`, `org_members`, `brand_profiles`, `brand_documents` +
`brand_document_chunks`, `events`, `content_items`, `agent_runs` and
`integrations`.

**Every domain table carries `org_id`**, with one client and from day one.
Retrofitting multi-tenancy once there is real data means touching every query
and every index at the same time. Reads start from who is asking — membership
first, never an org id handed over by the client.

`org_members` carries two identities, either or both: `user_id` is a Better
Auth account (the admin page), `telegram_user_id` is how the client's team
actually shows up. Someone who starts on Telegram and later gets a web login
keeps one membership row instead of becoming two people.

`agent_runs` is the action log and the cost ledger at once — spend is
attributable per organization from the first run instead of reconstructed from
a provider invoice. `usd` is `numeric`, not a float: sub-cent amounts summed
over thousands of runs is exactly where binary floating point drifts.

Neon branches are cheap — give each environment its own.

### The Brand Brain

`brand_profiles` is the structured half (voice, audience, services);
`brand_documents` + `brand_document_chunks` is the unstructured half — the
client's best past posts, guidelines and press releases, which is what makes
the voice sound like them rather than like a model.

Chunks are embedded, not whole documents: a press release is far longer than
the span that answers a retrieval query. `org_id` is denormalised onto chunks
so a similarity search filters by tenant without joining back. The index is
HNSW with cosine distance, which can be built before there are enough rows for
ivfflat to train.

Embeddings are OpenAI `text-embedding-3-small` at 1536 dimensions. That number
is part of the column type — changing model means changing the column and
re-embedding everything.

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

- **A sending domain.** Reset mail is written to the log until one is
  onboarded (see Email above), and email verification stays off until then.
- **The domain itself.** The brand book says what the product is — a team of
  agents doing strategy, content, design and distribution — but not how it
  works: no user flows, no data model, no agent hand-offs.
  `packages/db/src/schema.ts` stays close to empty until that lands.
