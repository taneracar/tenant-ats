-- Local stand-in for what Supabase already provides (auth schema, auth.uid(),
-- the anon/authenticated roles). Skip this file when applying to a real
-- Supabase project; the other migrations run there unchanged.
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text unique not null
);

create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
$$;

do $$ begin
  create role anon nologin;
exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticated nologin;
exception when duplicate_object then null; end $$;

grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
