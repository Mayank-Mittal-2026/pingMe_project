-- PingME Smart Society Visitor Management
-- Synthetic Maple Grove records only. Provision auth users and role links before real use.
create extension if not exists pgcrypto;

create table public.societies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'Asia/Kolkata',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.society_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  society_id uuid not null references public.societies(id) on delete cascade,
  role text not null check(role in ('resident','guard','society_admin')),
  full_name text not null,
  created_at timestamptz not null default now()
);
create index society_profiles_scope on public.society_profiles(society_id,role);
create table public.society_apartments (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.societies(id) on delete cascade,
  block text not null,
  number text not null,
  resident_name text,
  created_at timestamptz not null default now(),
  unique(society_id,block,number)
);
create table public.resident_apartments (
  society_id uuid not null references public.societies(id) on delete cascade,
  resident_id uuid not null references public.society_profiles(id) on delete cascade,
  apartment_id uuid not null references public.society_apartments(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(resident_id,apartment_id)
);
create index resident_apartment_scope on public.resident_apartments(society_id,apartment_id);
create table public.society_gates (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.societies(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(society_id,name)
);
create table public.security_guards (
  id uuid primary key references public.society_profiles(id) on delete cascade,
  society_id uuid not null references public.societies(id) on delete cascade,
  gate_id uuid references public.society_gates(id),
  created_at timestamptz not null default now()
);
create table public.visitor_categories (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.societies(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  unique(society_id,name)
);
create table public.society_visitors (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.societies(id) on delete cascade,
  apartment_id uuid not null references public.society_apartments(id),
  resident_id uuid not null references public.society_profiles(id),
  name text not null check(length(trim(name)) between 2 and 100),
  phone text check(phone is null or length(phone)<=30),
  category text not null,
  visit_at timestamptz not null,
  approval_status text not null default 'approved' check(approval_status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index society_visitors_household_time on public.society_visitors(society_id,resident_id,visit_at desc);
create index society_visitors_apartment on public.society_visitors(society_id,apartment_id,created_at desc);
create table public.visitor_passes (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.societies(id) on delete cascade,
  visitor_id uuid not null references public.society_visitors(id) on delete cascade,
  token_hash text not null unique check(length(token_hash)=64),
  expires_at timestamptz not null,
  max_uses integer not null default 1 check(max_uses between 1 and 20),
  uses integer not null default 0 check(uses>=0 and uses<=max_uses),
  approval_status text not null default 'approved' check(approval_status in ('pending','approved','rejected')),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index visitor_pass_validity on public.visitor_passes(society_id,expires_at) where revoked_at is null;
create table public.visitor_approvals (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.societies(id) on delete cascade,
  visitor_id uuid not null references public.society_visitors(id) on delete cascade,
  resident_id uuid not null references public.society_profiles(id),
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique(visitor_id)
);
create index visitor_approval_queue on public.visitor_approvals(society_id,status,created_at);
create table public.visitor_entries (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.societies(id) on delete cascade,
  visitor_id uuid not null references public.society_visitors(id),
  pass_id uuid not null references public.visitor_passes(id),
  gate_id uuid not null references public.society_gates(id),
  guard_id uuid not null references public.society_profiles(id),
  checked_in_at timestamptz not null default now(),
  checked_out_at timestamptz,
  check(checked_out_at is null or checked_out_at>=checked_in_at)
);
create unique index only_one_active_visitor_entry on public.visitor_entries(visitor_id) where checked_out_at is null;
create index visitor_entries_timeline on public.visitor_entries(society_id,checked_in_at desc);
create table public.visitor_scan_logs (
  id bigint generated always as identity primary key,
  society_id uuid references public.societies(id) on delete cascade,
  gate_id uuid references public.society_gates(id),
  guard_id uuid references public.society_profiles(id),
  visitor_id uuid references public.society_visitors(id),
  result text not null check(result in ('Valid Pass','Expired Pass','Already Used','Revoked Pass','Approval Required','Invalid QR Code','Rejected')),
  attempted_at timestamptz not null default now()
);
create index visitor_scan_log_recent on public.visitor_scan_logs(society_id,attempted_at desc);
create table public.society_notifications (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.societies(id) on delete cascade,
  profile_id uuid not null references public.society_profiles(id) on delete cascade,
  visitor_id uuid references public.society_visitors(id) on delete set null,
  title text not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.flagged_visitors (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.societies(id) on delete cascade,
  visitor_id uuid not null references public.society_visitors(id) on delete cascade,
  reason text not null check(length(trim(reason)) between 5 and 500),
  created_by uuid not null references public.society_profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index flagged_visitors_scope on public.flagged_visitors(society_id,created_at desc);
create table public.society_audit_logs (
  id bigint generated always as identity primary key,
  society_id uuid not null references public.societies(id) on delete cascade,
  actor_id uuid references public.society_profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index society_audit_recent on public.society_audit_logs(society_id,created_at desc);

create or replace function public.society_my_id() returns uuid language sql stable security definer set search_path=public as $$ select society_id from public.society_profiles where id=auth.uid() $$;
create or replace function public.society_my_role() returns text language sql stable security definer set search_path=public as $$ select role from public.society_profiles where id=auth.uid() $$;
create or replace function public.society_has_apartment(target uuid) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.resident_apartments where resident_id=auth.uid() and apartment_id=target and society_id=public.society_my_id()) $$;

create or replace function public.create_society_visitor_pass(p_actor uuid,p_apartment uuid,p_name text,p_phone text,p_category text,p_visit_at timestamptz,p_expires_at timestamptz,p_max_uses integer,p_token_hash text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare profile public.society_profiles; visitor public.society_visitors; pass public.visitor_passes;
begin
 select * into profile from public.society_profiles where id=p_actor and role='resident';
 if profile.id is null or not exists(select 1 from public.resident_apartments where resident_id=p_actor and apartment_id=p_apartment and society_id=profile.society_id) then raise exception 'You can only issue passes for an authorized apartment'; end if;
 if length(trim(p_name))<2 or length(trim(p_name))>100 or p_max_uses not between 1 and 20 or p_visit_at<now()-interval '1 minute' or p_expires_at<=p_visit_at or p_expires_at<=now() or length(p_token_hash)<>64 then raise exception 'Invalid visitor pass details'; end if;
 if not exists(select 1 from public.visitor_categories where society_id=profile.society_id and name=p_category and active) then raise exception 'Visitor category is unavailable'; end if;
 insert into public.society_visitors(society_id,apartment_id,resident_id,name,phone,category,visit_at) values(profile.society_id,p_apartment,p_actor,trim(p_name),nullif(trim(p_phone),''),p_category,p_visit_at) returning * into visitor;
 insert into public.visitor_passes(society_id,visitor_id,token_hash,expires_at,max_uses,approval_status) values(profile.society_id,visitor.id,p_token_hash,p_expires_at,p_max_uses,'approved') returning * into pass;
 insert into public.society_notifications(society_id,profile_id,visitor_id,title,body) values(profile.society_id,p_actor,visitor.id,'Visitor pass ready','Pass created for '||visitor.name||'.');
 insert into public.society_audit_logs(society_id,actor_id,action,entity_type,entity_id) values(profile.society_id,p_actor,'visitor.pass_created','visitor_pass',pass.id);
 return jsonb_build_object('visitor',to_jsonb(visitor),'pass',jsonb_build_object('id',pass.id,'expires_at',pass.expires_at,'max_uses',pass.max_uses));
end $$;

create or replace function public.record_visitor_checkout(p_entry uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare profile public.society_profiles; visit public.visitor_entries; visitor public.society_visitors;
begin
 select * into profile from public.society_profiles where id=p_actor and role in ('guard','society_admin');
 if profile.id is null then raise exception 'Only authorized gate staff may check visitors out'; end if;
 update public.visitor_entries set checked_out_at=now() where id=p_entry and society_id=profile.society_id and checked_out_at is null returning * into visit;
 if visit.id is null then raise exception 'Active visit not found'; end if;
 select * into visitor from public.society_visitors where id=visit.visitor_id;
 insert into public.society_notifications(society_id,profile_id,visitor_id,title,body) values(profile.society_id,visitor.resident_id,visitor.id,'Visitor checked out',visitor.name||' has left the society.');
 insert into public.society_audit_logs(society_id,actor_id,action,entity_type,entity_id) values(profile.society_id,p_actor,'visitor.checked_out','visitor_entry',visit.id);
 return to_jsonb(visit);
end $$;

-- Atomic server-side QR verification. It serializes use of a pass, logs every attempt,
-- prevents simultaneous open entries, and never returns a raw token.
create or replace function public.verify_and_check_in_visitor(p_token_hash text,p_actor uuid,p_gate uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare p public.visitor_passes; v public.society_visitors; who public.society_profiles; gate public.society_gates; result text; entry public.visitor_entries;
begin
 select * into who from public.society_profiles where id=p_actor and role in ('guard','society_admin');
 if who.id is null then raise exception 'Only authorized gate staff may verify a pass'; end if;
 if who.role='guard' and not exists(select 1 from public.security_guards where id=p_actor and society_id=who.society_id and gate_id=p_gate) then raise exception 'This guard is not assigned to the selected gate'; end if;
 select * into gate from public.society_gates where id=p_gate and society_id=who.society_id and active;
 if gate.id is null then raise exception 'The selected gate is not authorized'; end if;
 select * into p from public.visitor_passes where token_hash=p_token_hash and society_id=who.society_id for update;
 if p.id is null then
   result := 'Invalid QR Code';
 else
   select * into v from public.society_visitors where id=p.visitor_id and society_id=who.society_id;
   if p.revoked_at is not null then result := 'Revoked Pass';
   elsif p.expires_at<=now() then result := 'Expired Pass';
   elsif p.approval_status='pending' or v.approval_status='pending' then result := 'Approval Required';
   elsif p.approval_status='rejected' or v.approval_status='rejected' then result := 'Rejected';
   elsif p.uses>=p.max_uses or exists(select 1 from public.visitor_entries where visitor_id=v.id and checked_out_at is null) then result := 'Already Used';
   else
     begin
       insert into public.visitor_entries(society_id,visitor_id,pass_id,gate_id,guard_id) values(who.society_id,v.id,p.id,gate.id,p_actor) returning * into entry;
       update public.visitor_passes set uses=uses+1,updated_at=now() where id=p.id;
       result := 'Valid Pass';
       insert into public.society_notifications(society_id,profile_id,visitor_id,title,body) values(who.society_id,v.resident_id,v.id,'Visitor checked in',v.name||' has entered at '||gate.name||'.');
       insert into public.society_audit_logs(society_id,actor_id,action,entity_type,entity_id) values(who.society_id,p_actor,'visitor.checked_in','visitor_entry',entry.id);
     exception when unique_violation then result := 'Already Used';
     end;
   end if;
 end if;
 insert into public.visitor_scan_logs(society_id,gate_id,guard_id,visitor_id,result) values(who.society_id,gate.id,p_actor,v.id,result);
 return jsonb_build_object('status',result,'allowed',result='Valid Pass','visitor',case when v.id is null then null else jsonb_build_object('id',v.id,'name',v.name,'category',v.category,'apartment',(select block||'-'||number from public.society_apartments where id=v.apartment_id),'resident_name',(select full_name from public.society_profiles where id=v.resident_id),'visit_at',v.visit_at) end,'entry',case when entry.id is null then null else to_jsonb(entry) end);
end $$;

create or replace function public.decide_visitor_approval(p_approval uuid,p_approve boolean,p_actor uuid,p_token_hash text default null,p_expires_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a public.visitor_approvals; v public.society_visitors; p public.visitor_passes;
begin
 select * into a from public.visitor_approvals where id=p_approval for update;
 if a.id is null or a.resident_id<>p_actor then raise exception 'Approval request not found'; end if;
 if a.status<>'pending' then raise exception 'This request has already been decided'; end if;
 if (select role from public.society_profiles where id=p_actor)<>'resident' then raise exception 'Only the household resident may decide this request'; end if;
 update public.visitor_approvals set status=case when p_approve then 'approved' else 'rejected' end,decided_at=now() where id=a.id;
 update public.society_visitors set approval_status=case when p_approve then 'approved' else 'rejected' end,updated_at=now() where id=a.visitor_id returning * into v;
 if p_approve then
   if p_token_hash is null or p_expires_at is null or p_expires_at<=now() then raise exception 'An expiry and secure token hash are required'; end if;
   insert into public.visitor_passes(society_id,visitor_id,token_hash,expires_at,max_uses,approval_status) values(a.society_id,v.id,p_token_hash,p_expires_at,1,'approved') returning * into p;
 end if;
 insert into public.society_notifications(society_id,profile_id,visitor_id,title,body) values(a.society_id,a.resident_id,v.id,'Visitor '||case when p_approve then 'approved' else 'declined' end,v.name||' gate request was '||case when p_approve then 'approved' else 'declined' end||'.');
 insert into public.society_audit_logs(society_id,actor_id,action,entity_type,entity_id) values(a.society_id,p_actor,'visitor.approval_'||case when p_approve then 'approved' else 'rejected' end,'visitor_approval',a.id);
 return jsonb_build_object('id',a.id,'status',case when p_approve then 'approved' else 'rejected' end,'visitor_name',v.name,'expires_at',p.expires_at);
end $$;
revoke all on function public.verify_and_check_in_visitor(text,uuid,uuid) from public,anon,authenticated;
revoke all on function public.decide_visitor_approval(uuid,boolean,uuid,text,timestamptz) from public,anon,authenticated;
revoke all on function public.create_society_visitor_pass(uuid,uuid,text,text,text,timestamptz,timestamptz,integer,text) from public,anon,authenticated;
revoke all on function public.record_visitor_checkout(uuid,uuid) from public,anon,authenticated;
grant execute on function public.verify_and_check_in_visitor(text,uuid,uuid) to service_role;
grant execute on function public.decide_visitor_approval(uuid,boolean,uuid,text,timestamptz) to service_role;
grant execute on function public.create_society_visitor_pass(uuid,uuid,text,text,text,timestamptz,timestamptz,integer,text) to service_role;
grant execute on function public.record_visitor_checkout(uuid,uuid) to service_role;

do $$ declare t text; begin
 foreach t in array array['societies','society_profiles','society_apartments','resident_apartments','society_gates','security_guards','visitor_categories','society_visitors','visitor_passes','visitor_approvals','visitor_entries','visitor_scan_logs','society_notifications','flagged_visitors','society_audit_logs'] loop
   execute format('alter table public.%I enable row level security',t);
 end loop;
end $$;
create policy society_read on public.societies for select to authenticated using(id=public.society_my_id());
create policy society_profile_self on public.society_profiles for select to authenticated using(id=auth.uid() or (society_id=public.society_my_id() and public.society_my_role()='society_admin'));
create policy society_apartment_read on public.society_apartments for select to authenticated using(society_id=public.society_my_id() and (public.society_my_role() in ('guard','society_admin') or public.society_has_apartment(id)));
create policy resident_apartment_read on public.resident_apartments for select to authenticated using(society_id=public.society_my_id() and (resident_id=auth.uid() or public.society_my_role() in ('guard','society_admin')));
create policy society_gate_read on public.society_gates for select to authenticated using(society_id=public.society_my_id());
create policy guard_roster_admin_read on public.security_guards for select to authenticated using(society_id=public.society_my_id() and public.society_my_role()='society_admin');
create policy visitor_category_read on public.visitor_categories for select to authenticated using(society_id=public.society_my_id() and active);
create policy resident_visitors_read on public.society_visitors for select to authenticated using(society_id=public.society_my_id() and (resident_id=auth.uid() or public.society_my_role() in ('guard','society_admin')));
create policy resident_visitors_insert on public.society_visitors for insert to authenticated with check(society_id=public.society_my_id() and resident_id=auth.uid() and public.society_my_role()='resident' and public.society_has_apartment(apartment_id));
create policy resident_passes_read on public.visitor_passes for select to authenticated using(society_id=public.society_my_id() and exists(select 1 from public.society_visitors v where v.id=visitor_id and (v.resident_id=auth.uid() or public.society_my_role() in ('guard','society_admin'))));
create policy resident_pass_insert on public.visitor_passes for insert to authenticated with check(society_id=public.society_my_id() and exists(select 1 from public.society_visitors v where v.id=visitor_id and v.resident_id=auth.uid()));
create policy resident_approval_read on public.visitor_approvals for select to authenticated using(society_id=public.society_my_id() and (resident_id=auth.uid() or public.society_my_role() in ('guard','society_admin')));
create policy guard_entry_read on public.visitor_entries for select to authenticated using(society_id=public.society_my_id() and (public.society_my_role() in ('guard','society_admin') or exists(select 1 from public.society_visitors v where v.id=visitor_id and v.resident_id=auth.uid())));
create policy admin_flag_management on public.flagged_visitors for all to authenticated using(society_id=public.society_my_id() and public.society_my_role()='society_admin') with check(society_id=public.society_my_id() and public.society_my_role()='society_admin');
create policy resident_notifications_read on public.society_notifications for select to authenticated using(profile_id=auth.uid() and society_id=public.society_my_id());
create policy guard_scanlog_read on public.visitor_scan_logs for select to authenticated using(society_id=public.society_my_id() and public.society_my_role() in ('guard','society_admin'));
create policy audit_log_admin_read on public.society_audit_logs for select to authenticated using(society_id=public.society_my_id() and public.society_my_role()='society_admin');

insert into public.societies(id,name) values('a1000000-0000-4000-8000-000000000001','Maple Grove Residences') on conflict do nothing;
create or replace function public.create_society_resident_profile() returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.society_profiles(id,society_id,role,full_name) values(new.id,'a1000000-0000-4000-8000-000000000001','resident',coalesce(new.raw_user_meta_data->>'full_name','Resident')) on conflict(id) do nothing;
 return new;
end $$;
drop trigger if exists on_auth_user_created_society on auth.users;
create trigger on_auth_user_created_society after insert on auth.users for each row execute function public.create_society_resident_profile();
revoke all on function public.create_society_resident_profile() from public,anon,authenticated;
insert into public.society_apartments(id,society_id,block,number,resident_name) values
 ('a3000000-0000-4000-8000-000000000101','a1000000-0000-4000-8000-000000000001','B','1204','Aarav Mehta'),
 ('a3000000-0000-4000-8000-000000000102','a1000000-0000-4000-8000-000000000001','A','803','Diya Shah'),
 ('a3000000-0000-4000-8000-000000000103','a1000000-0000-4000-8000-000000000001','C','502','Kabir Singh') on conflict do nothing;
insert into public.society_gates(id,society_id,name) values
 ('a4000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','Main Gate'),
 ('a4000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000001','East Gate') on conflict do nothing;
insert into public.visitor_categories(society_id,name) values
 ('a1000000-0000-4000-8000-000000000001','Guest'),('a1000000-0000-4000-8000-000000000001','Food delivery'),('a1000000-0000-4000-8000-000000000001','Courier delivery'),('a1000000-0000-4000-8000-000000000001','Maintenance technician'),('a1000000-0000-4000-8000-000000000001','Domestic helper'),('a1000000-0000-4000-8000-000000000001','Other service provider') on conflict do nothing;

do $$ declare t text; begin
 foreach t in array array['society_visitors','visitor_passes','visitor_approvals','visitor_entries','society_notifications','visitor_scan_logs','flagged_visitors'] loop
   begin execute format('alter publication supabase_realtime add table public.%I',t); exception when duplicate_object then null; end;
 end loop;
end $$;
