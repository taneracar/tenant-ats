-- Role checks live in a schema the API does not expose. They are SECURITY
-- DEFINER so the memberships lookup inside a policy does not itself go
-- through the memberships policy (which would recurse).
create schema if not exists private;
grant usage on schema private to authenticated;

create or replace function private.role_in(p_agency uuid)
returns public.member_role
language sql stable security definer
set search_path = ''
as $$
  select m.role from public.memberships m
  where m.agency_id = p_agency and m.user_id = (select auth.uid())
$$;

create or replace function private.is_member(p_agency uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select private.role_in(p_agency) is not null $$;

create or replace function private.can_write(p_agency uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce(private.role_in(p_agency) in ('owner', 'recruiter'), false) $$;

create or replace function private.is_owner(p_agency uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce(private.role_in(p_agency) = 'owner', false) $$;

revoke all on function private.role_in(uuid), private.is_member(uuid),
  private.can_write(uuid), private.is_owner(uuid) from public;
grant execute on function private.role_in(uuid), private.is_member(uuid),
  private.can_write(uuid), private.is_owner(uuid) to authenticated;

alter table public.agencies enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.clients enable row level security;
alter table public.job_orders enable row level security;
alter table public.candidates enable row level security;
alter table public.submissions enable row level security;
alter table public.submission_rates enable row level security;
alter table public.stage_events enable row level security;

-- anon gets nothing. authenticated gets table privileges; RLS decides rows.
grant usage on schema public to authenticated;
grant select on public.agencies, public.profiles, public.memberships,
  public.stage_events to authenticated;
grant select, insert, update, delete on public.clients, public.job_orders,
  public.candidates, public.submissions, public.submission_rates to authenticated;
grant insert, update, delete on public.memberships to authenticated;
grant update (name) on public.agencies to authenticated;
grant update (full_name) on public.profiles to authenticated;

-- agencies
create policy agencies_read on public.agencies for select to authenticated
  using ((select private.is_member(id)));
create policy agencies_rename on public.agencies for update to authenticated
  using ((select private.is_owner(id))) with check ((select private.is_owner(id)));

-- profiles: yourself, plus people who share an agency with you
create policy profiles_read on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.memberships theirs
      where theirs.user_id = profiles.id and private.is_member(theirs.agency_id)
    )
  );
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- memberships: members see the roster, only owners change it
create policy memberships_read on public.memberships for select to authenticated
  using ((select private.is_member(agency_id)));
create policy memberships_owner_insert on public.memberships for insert to authenticated
  with check ((select private.is_owner(agency_id)));
create policy memberships_owner_update on public.memberships for update to authenticated
  using ((select private.is_owner(agency_id))) with check ((select private.is_owner(agency_id)));
create policy memberships_owner_delete on public.memberships for delete to authenticated
  using ((select private.is_owner(agency_id)));

-- The same four policies for each plain tenant table:
-- members read, owners and recruiters write, owners delete.
do $$
declare t text;
begin
  foreach t in array array['clients', 'job_orders', 'candidates', 'submissions'] loop
    execute format($f$
      create policy %1$s_read on public.%1$I for select to authenticated
        using ((select private.is_member(agency_id)));
      create policy %1$s_insert on public.%1$I for insert to authenticated
        with check ((select private.can_write(agency_id)));
      create policy %1$s_update on public.%1$I for update to authenticated
        using ((select private.can_write(agency_id))) with check ((select private.can_write(agency_id)));
      create policy %1$s_delete on public.%1$I for delete to authenticated
        using ((select private.is_owner(agency_id)));
    $f$, t);
  end loop;
end $$;

-- pay rates: viewers (e.g. a client's hiring manager) never see them
create policy rates_read on public.submission_rates for select to authenticated
  using ((select private.can_write(agency_id)));
create policy rates_insert on public.submission_rates for insert to authenticated
  with check ((select private.can_write(agency_id)));
create policy rates_update on public.submission_rates for update to authenticated
  using ((select private.can_write(agency_id))) with check ((select private.can_write(agency_id)));
create policy rates_delete on public.submission_rates for delete to authenticated
  using ((select private.is_owner(agency_id)));

-- stage history: read-only for members
create policy stage_events_read on public.stage_events for select to authenticated
  using ((select private.is_member(agency_id)));
