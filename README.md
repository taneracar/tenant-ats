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

`npm test` boots a fresh Postgres in-process, applies the migrations, seeds deterministic data, and runs **34 tests**: isolation on every tenant table for every role, write rules, the composite FKs, history forging, the last-owner rule, cascade deletes, membership changes, and report access.

The suite was checked against deliberate breakage: making `is_member()` always true fails 16 tests; opening the pay-rate read policy fails 2.

## Running it

```bash
npm install
npm test
npm run dev
```

Using it with a real Supabase project: skip `supabase/migrations/0000_supabase_shim.sql` (it only stands in for the `auth` schema and roles Supabase already has) and apply the rest with `supabase db push`.

## Stack

React 19, TypeScript, Vite, Tailwind CSS 4, TanStack Table, PGlite (Postgres 18 in WebAssembly), Vitest, GitHub Actions.

## Limits

- Sign-in is simulated by setting `request.jwt.claims`, which is exactly what Supabase's API does after verifying a JWT. There is no real auth server here.
- The browser bundle is large (about 15 MB uncompressed, mostly the Postgres WebAssembly build). Fine for a demo, not how a production app would ship.
- Data is synthetic and resets on reload.
