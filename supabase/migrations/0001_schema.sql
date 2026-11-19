-- Multi-tenant ATS for staffing agencies.
-- Every tenant-owned row carries agency_id. Child rows reference parents with
-- a composite (id, agency_id) foreign key, so the database itself refuses a
-- row that points at another agency's data, even for a buggy server path
-- that bypasses RLS.

create type public.member_role as enum ('owner', 'recruiter', 'viewer');
create type public.pipeline_stage as enum
  ('sourced', 'screen', 'submitted', 'interview', 'offer', 'placed', 'rejected');

create table public.agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null
);

create table public.memberships (
  agency_id uuid not null references public.agencies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null,
  primary key (agency_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  name text not null,
  unique (id, agency_id)
);
create index clients_agency_idx on public.clients (agency_id);

create table public.job_orders (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  client_id uuid not null,
  title text not null,
  location text not null,
  openings int not null default 1 check (openings > 0),
  bill_rate numeric(10, 2) not null check (bill_rate > 0),
  status text not null default 'open' check (status in ('open', 'filled', 'closed')),
  opened_on date not null default current_date,
  unique (id, agency_id),
  foreign key (client_id, agency_id) references public.clients (id, agency_id)
);
create index job_orders_agency_idx on public.job_orders (agency_id);

create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  full_name text not null,
  email text not null,
  skills text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (id, agency_id),
  unique (agency_id, email)
);
create index candidates_agency_idx on public.candidates (agency_id);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  job_order_id uuid not null,
  candidate_id uuid not null,
  stage public.pipeline_stage not null default 'sourced',
  recruiter_id uuid references auth.users (id),
  updated_at timestamptz not null default now(),
  unique (id, agency_id),
  unique (job_order_id, candidate_id),
  foreign key (job_order_id, agency_id) references public.job_orders (id, agency_id) on delete cascade,
  foreign key (candidate_id, agency_id) references public.candidates (id, agency_id) on delete cascade
);
create index submissions_agency_idx on public.submissions (agency_id);

-- Pay rates live in their own table so a whole role can be kept away from
-- them with a policy, instead of hoping every query leaves the column out.
create table public.submission_rates (
  submission_id uuid primary key,
  agency_id uuid not null,
  pay_rate numeric(10, 2) not null check (pay_rate > 0),
  foreign key (submission_id, agency_id) references public.submissions (id, agency_id) on delete cascade
);
create index submission_rates_agency_idx on public.submission_rates (agency_id);

-- Written only by a trigger; users can read it but never insert into it.
create table public.stage_events (
  id bigint generated always as identity primary key,
  agency_id uuid not null,
  submission_id uuid not null,
  from_stage public.pipeline_stage,
  to_stage public.pipeline_stage not null,
  actor_id uuid,
  at timestamptz not null default now(),
  foreign key (submission_id, agency_id) references public.submissions (id, agency_id) on delete cascade
);
create index stage_events_agency_idx on public.stage_events (agency_id);
create index stage_events_submission_idx on public.stage_events (submission_id);
