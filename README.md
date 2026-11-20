# tenant-ats

**Live demo: [tenant-ats.vercel.app](https://tenant-ats.vercel.app)**

A multi-tenant applicant tracking system for staffing agencies, where **tenant isolation is enforced by Postgres row-level security, not by application code**.

The demo runs real Postgres 18 inside the browser tab ([PGlite](https://pglite.dev)), applies the same migrations a Supabase project would get, and lets you switch between five users to watch the database decide what each of them can see and do.

## What to try in the demo

| User | Membership | What Postgres allows |
|---|---|---|
| Ava Martinez | owner, Harbor Staffing | everything in Harbor, including pay rates and the margin report |
| Ben Okafor | recruiter at Harbor, **viewer** at Summit | writes in Harbor, read-only in Summit |
| Cara Nguyen | viewer at Harbor (a client's hiring manager) | reads the pipeline, sees **no pay rates**, margin report refused |
| Dev Patel | owner, Summit Talent | nothing from Harbor |
| Eli Brooks | no membership | zero rows from every table |

The **RLS lab** tab runs any SQL as the selected user (always rolled back). It has one-click probes: read another agency's candidates, insert into another agency, forge a stage-history event, mass-update the pipeline.

## Design

```
auth.users ──< memberships >── agencies ──< clients ──< job_orders ──< submissions >── candidates
                (role)                                                     │
                                                         submission_rates ─┤ (pay, policy-gated)
                                                             stage_events ─┘ (trigger-written)
```

- **Every tenant row carries `agency_id`.** Policies check membership through `private.*` helper functions (`SECURITY DEFINER`, empty `search_path`, in a schema the API does not expose), so the memberships lookup inside a policy does not recurse into the memberships policy.
- **Policy calls are wrapped in `(select …)`**, so Postgres evaluates them once per statement instead of once per row. A test fails if a policy skips the wrapper.
- **Composite foreign keys** (`(client_id, agency_id) → clients(id, agency_id)`) mean a row cannot point at another tenant's parent, even from a server path that bypasses RLS with the service role. Tested as superuser.
- **Pay rates live in their own table.** Viewers are kept away from them by a policy, rather than by trusting every query to leave a column out.
- **Stage history is written only by a trigger.** Users have `SELECT` on `stage_events` and no `INSERT`; the actor comes from the JWT, not the request body.
- **An agency always keeps one owner.** A trigger blocks demoting or removing the last owner, but allows the cascade when the agency itself is deleted.
- **Reports respect RLS.** `agency_kpis` is a `security_invoker` view; `margin_report()` is `SECURITY INVOKER` with an explicit role check so a viewer gets a clear error instead of a silently empty report.

## Tests

Two layers, both run in CI on every push.

### Database (Vitest, 34 tests)

`npm test` boots a fresh Postgres in-process, applies the migrations, seeds deterministic data, and checks isolation on every tenant table for every role, write rules, the composite FKs, history forging, the last-owner rule, cascade deletes, membership changes, and report access.

Checked against deliberate breakage: making `is_member()` always true fails 16 tests; opening the pay-rate read policy fails 2.

### End to end (Playwright, 48 runs)

`npm run e2e` builds the production bundle, serves it, and drives it in Chromium at desktop size and on a Pixel 7 profile.

| File | What it proves |
|---|---|
| `e2e/roles.spec.ts` | Owner, recruiter, viewer and no-membership users each get the UI their role allows; a Summit owner cannot find Harbor's clients; one person holds different roles in two agencies. |
| `e2e/pipeline.spec.ts` | Changing a stage records the right actor in history; a change by one user shows up for another; filters, search and funnel-order sorting work. |
| `e2e/rls-lab.spec.ts` | The SQL console runs as the selected JWT subject; cross-tenant insert fails with `42501`; history cannot be forged; an owner's mass update is rolled back. |
| `e2e/a11y.spec.ts` | axe-core finds no WCAG 2.1 A/AA violations in any view, for every role, in light and dark mode. |
| `e2e/smoke.spec.ts` | Boot, no console errors or failed requests, no horizontal scroll (also on mobile). |

Locators use roles and visible text through a small page object (`e2e/fixtures.ts`), no test ids and no fixed sleeps. The suite passed 3 repeated runs (144/144) with no flakes.

What the suite caught while being written: dark-mode secondary text at 3.6:1 contrast (below 4.5:1), and horizontally scrolling tables that keyboard users could not reach on mobile. Both were fixed. Deliberate breakage: showing edit controls to viewers fails 2 tests; dropping the actor from the history trigger fails 1.

The same suite runs against production daily (`npm run e2e:prod`, scheduled job `e2e-prod`). The HTML report is uploaded as a build artifact.

## Running it

```bash
npm install
npm test
npx playwright install chromium
npm run e2e
npm run dev
```

Using it with a real Supabase project: skip `supabase/migrations/0000_supabase_shim.sql` (it only stands in for the `auth` schema and roles Supabase already has) and apply the rest with `supabase db push`.

## Stack

React 19, TypeScript, Vite, Tailwind CSS 4, TanStack Table, PGlite (Postgres 18 in WebAssembly), Vitest, Playwright, axe-core, GitHub Actions.

## Limits

- Sign-in is simulated by setting `request.jwt.claims`, which is exactly what Supabase's API does after verifying a JWT. There is no real auth server here.
- The browser bundle is large (about 15 MB uncompressed, mostly the Postgres WebAssembly build). Fine for a demo, not how a production app would ship.
- Data is synthetic and resets on reload.
