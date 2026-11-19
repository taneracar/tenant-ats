-- Stage history. SECURITY DEFINER because users have no INSERT on
-- stage_events; actor comes from the JWT, not from anything the client sends.
create or replace function private.log_stage_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    insert into public.stage_events (agency_id, submission_id, from_stage, to_stage, actor_id)
    values (new.agency_id, new.id,
            case when tg_op = 'UPDATE' then old.stage end,
            new.stage, (select auth.uid()));
    new.updated_at := now();
  end if;
  return new;
end $$;

-- BEFORE so updated_at can be set; the event row references new.id, which
-- exists for INSERT only after the row is written, so INSERT uses AFTER.
create trigger submissions_stage_update
  before update of stage on public.submissions
  for each row execute function private.log_stage_change();

create or replace function private.log_stage_insert()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.stage_events (agency_id, submission_id, from_stage, to_stage, actor_id)
  values (new.agency_id, new.id, null, new.stage, (select auth.uid()));
  return null;
end $$;

create trigger submissions_stage_insert
  after insert on public.submissions
  for each row execute function private.log_stage_insert();

-- An agency must always keep at least one owner.
create or replace function private.keep_an_owner()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if old.role = 'owner'
     and (tg_op = 'DELETE' or new.role <> 'owner')
     and not exists (
       select 1 from public.memberships
       where agency_id = old.agency_id and role = 'owner' and user_id <> old.user_id
     )
     -- the agency itself is being deleted (cascade): allow
     and exists (select 1 from public.agencies where id = old.agency_id)
  then
    raise exception 'an agency needs at least one owner' using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end $$;

create trigger memberships_keep_owner
  before update or delete on public.memberships
  for each row execute function private.keep_an_owner();

-- Margin report. SECURITY INVOKER: it reads through the caller's RLS, so a
-- viewer gets no pay rates and therefore no margin; the explicit check turns
-- that silent empty result into a clear error.
create or replace function public.margin_report(p_agency uuid)
returns table (
  job_order_id uuid, title text, client text, placements bigint,
  avg_bill numeric, avg_pay numeric, margin_pct numeric
)
language plpgsql stable security invoker set search_path = ''
as $$
begin
  if not private.can_write(p_agency) then
    raise exception 'margin report needs owner or recruiter role' using errcode = 'insufficient_privilege';
  end if;
  return query
    select j.id, j.title, c.name, count(*),
           round(avg(j.bill_rate), 2), round(avg(r.pay_rate), 2),
           round(100 * (1 - avg(r.pay_rate) / avg(j.bill_rate)), 1)
    from public.submissions s
    join public.job_orders j on j.id = s.job_order_id
    join public.clients c on c.id = j.client_id
    join public.submission_rates r on r.submission_id = s.id
    where s.agency_id = p_agency and s.stage = 'placed'
    group by j.id, j.title, c.name
    order by 7 desc;
end $$;
grant execute on function public.margin_report(uuid) to authenticated;

-- Funnel + time-to-fill. Runs with the caller's rights, so it can only ever
-- count rows the caller could select anyway.
create or replace view public.agency_kpis with (security_invoker = true) as
select
  a.id as agency_id,
  (select count(*) from public.job_orders j where j.agency_id = a.id and j.status = 'open') as open_orders,
  (select count(*) from public.submissions s where s.agency_id = a.id
     and s.stage not in ('placed', 'rejected')) as active_pipeline,
  (select count(*) from public.submissions s where s.agency_id = a.id and s.stage = 'placed') as placements,
  (select count(*) from public.submissions s where s.agency_id = a.id and s.stage = 'interview') as interviewing,
  (select round(avg(extract(epoch from (e.at - j.opened_on::timestamptz)) / 86400), 1)
     from public.stage_events e
     join public.submissions s on s.id = e.submission_id
     join public.job_orders j on j.id = s.job_order_id
     where e.agency_id = a.id and e.to_stage = 'placed') as avg_days_to_fill
from public.agencies a;
grant select on public.agency_kpis to authenticated;
