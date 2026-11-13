create extension if not exists pgcrypto;

create type public.app_role as enum ('parent','driver','admin');
create type public.pickup_status as enum ('Waiting','Called to Gate','Ready for Pickup','Handed Over');

create table public.schools (id uuid primary key default gen_random_uuid(), name text not null, created_at timestamptz not null default now());
create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, school_id uuid references public.schools(id), full_name text not null default '', role public.app_role not null default 'parent', created_at timestamptz not null default now());
create table public.students (id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade, full_name text not null, grade text not null default '', synthetic boolean not null default true, created_at timestamptz not null default now());
create table public.parent_student_relationships (parent_id uuid not null references public.profiles(id) on delete cascade, student_id uuid not null references public.students(id) on delete cascade, relationship text not null default 'guardian', primary key(parent_id,student_id));
create table public.buses (id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade, name text not null, registration_label text not null, capacity integer not null default 32, created_at timestamptz not null default now());
create table public.drivers (id uuid primary key references public.profiles(id) on delete cascade, school_id uuid not null references public.schools(id) on delete cascade, license_label text not null default '');
create table public.routes (id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade, name text not null, destination text not null, path jsonb not null default '[]', created_at timestamptz not null default now());
create table public.bus_assignments (id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade, student_id uuid not null references public.students(id) on delete cascade, bus_id uuid not null references public.buses(id) on delete cascade, route_id uuid not null references public.routes(id) on delete cascade, active boolean not null default true, created_at timestamptz not null default now(), unique(student_id,bus_id,route_id));
alter table public.drivers add column bus_id uuid references public.buses(id);
alter table public.drivers add column route_id uuid references public.routes(id);
create table public.trips (id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade, bus_id uuid not null references public.buses(id), driver_id uuid not null references public.drivers(id), route_id uuid not null references public.routes(id), status text not null default 'active' check(status in ('active','completed')), started_at timestamptz not null default now(), ended_at timestamptz);
create unique index one_active_trip_per_bus on public.trips(bus_id) where status='active';
create table public.bus_locations (id bigint generated always as identity primary key, school_id uuid not null references public.schools(id) on delete cascade, trip_id uuid not null references public.trips(id) on delete cascade, latitude double precision not null check(latitude between -90 and 90), longitude double precision not null check(longitude between -180 and 180), recorded_at timestamptz not null default now());
create index bus_locations_trip_recorded on public.bus_locations(trip_id,recorded_at desc);
create table public.pickup_requests (id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade, student_id uuid not null references public.students(id), requested_by uuid not null references public.profiles(id), queue_number bigint not null, status public.pickup_status not null default 'Waiting', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create unique index one_open_pickup_per_student on public.pickup_requests(student_id) where status <> 'Handed Over';
create index pickup_queue_order on public.pickup_requests(school_id,status,queue_number);
create table public.notifications (id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade, profile_id uuid not null references public.profiles(id) on delete cascade, student_id uuid references public.students(id) on delete cascade, title text not null, body text not null, read_at timestamptz, created_at timestamptz not null default now());
create table public.handover_records (id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade, pickup_request_id uuid not null unique references public.pickup_requests(id), student_id uuid not null references public.students(id), guardian_id uuid not null references public.profiles(id), confirmed_by uuid not null references public.profiles(id), confirmed_at timestamptz not null default now());

insert into public.schools(id,name) values('11111111-1111-4111-8111-111111111111','Horizon Academy (Synthetic Demo)') on conflict do nothing;
insert into public.students(id,school_id,full_name,grade,synthetic) values
 ('22222222-2222-4222-8222-222222222221','11111111-1111-4111-8111-111111111111','Maya Chen','Grade 4 · Class B',true),
 ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','Leo Chen','Grade 1 · Class A',true) on conflict do nothing;
insert into public.buses(id,school_id,name,registration_label,capacity) values('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','Bus 12','Bluebird · DEMO',32) on conflict do nothing;
insert into public.routes(id,school_id,name,destination,path) values('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','North Loop','Horizon Academy · Main gate','[[12.963,77.585],[12.966,77.589],[12.968,77.594],[12.971,77.598],[12.974,77.602],[12.978,77.604]]'::jsonb) on conflict do nothing;
insert into public.bus_assignments(school_id,student_id,bus_id,route_id) values
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222221','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444'),
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444') on conflict do nothing;

create or replace function public.create_school_profile() returns trigger language plpgsql security definer set search_path=public as $$
declare chosen_role public.app_role;
begin
 chosen_role := 'parent'::public.app_role;
 insert into public.profiles(id,school_id,full_name,role) values(new.id,'11111111-1111-4111-8111-111111111111',coalesce(new.raw_user_meta_data->>'name',''),chosen_role);
 -- Elevated roles and driver records are provisioned by a school administrator.
 return new;
end $$;
create trigger on_auth_user_created_pingme after insert on auth.users for each row execute function public.create_school_profile();

create or replace function public.my_role() returns public.app_role language sql stable security definer set search_path=public as $$ select role from profiles where id=auth.uid() $$;
create or replace function public.my_school() returns uuid language sql stable security definer set search_path=public as $$ select school_id from profiles where id=auth.uid() $$;
create or replace function public.can_access_student(target uuid) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from parent_student_relationships where parent_id=auth.uid() and student_id=target) or (select role from profiles where id=auth.uid())='admin' or exists(select 1 from drivers d join bus_assignments a on a.bus_id=d.bus_id and a.route_id=d.route_id where d.id=auth.uid() and a.student_id=target and a.active) $$;
create or replace function public.prevent_self_role_change() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if (new.role is distinct from old.role or new.school_id is distinct from old.school_id) and auth.uid()=old.id and public.my_role()<>'admin' then
   raise exception 'Only a school administrator can change roles or school membership';
 end if;
 return new;
end $$;
create trigger profiles_protect_role before update on public.profiles for each row execute function public.prevent_self_role_change();

create or replace function public.request_student_pickup(target_student uuid) returns public.pickup_requests language plpgsql security invoker set search_path=public as $$
declare result public.pickup_requests; school uuid; next_number bigint;
begin
 if not exists(select 1 from parent_student_relationships where parent_id=auth.uid() and student_id=target_student) and public.my_role()<>'admin' then raise exception 'Not authorized for this student'; end if;
 select school_id into school from students where id=target_student;
 perform pg_advisory_xact_lock(hashtext(school::text));
 if exists(select 1 from pickup_requests where student_id=target_student and status<>'Handed Over') then raise exception 'Active pickup already exists'; end if;
 select coalesce(max(queue_number),0)+1 into next_number from pickup_requests where school_id=school and created_at::date=current_date;
 insert into pickup_requests(school_id,student_id,requested_by,queue_number,status) values(school,target_student,auth.uid(),next_number,'Waiting') returning * into result;
 return result;
end $$;

create or replace function public.confirm_pickup_handover(target_request uuid) returns public.pickup_requests language plpgsql security definer set search_path=public as $$
declare req public.pickup_requests; guardian uuid;
begin
 if public.my_role() not in ('admin','driver') then raise exception 'Only school staff can confirm handover'; end if;
 select * into req from pickup_requests where id=target_request for update;
 if req.id is null or req.school_id<>public.my_school() then raise exception 'Pickup request not found'; end if;
 if req.status<>'Ready for Pickup' then raise exception 'Student must be at the gate before handover'; end if;
 select parent_id into guardian from parent_student_relationships where student_id=req.student_id order by parent_id limit 1;
 if guardian is null then raise exception 'No authorized guardian is linked to the student'; end if;
 update pickup_requests set status='Handed Over',updated_at=now() where id=req.id returning * into req;
 insert into handover_records(school_id,pickup_request_id,student_id,guardian_id,confirmed_by) values(req.school_id,req.id,req.student_id,guardian,auth.uid());
 return req;
end $$;

alter table public.schools enable row level security;
alter table public.profiles enable row level security;
alter table public.students enable row level security;
alter table public.parent_student_relationships enable row level security;
alter table public.buses enable row level security;
alter table public.drivers enable row level security;
alter table public.routes enable row level security;
alter table public.bus_assignments enable row level security;
alter table public.trips enable row level security;
alter table public.bus_locations enable row level security;
alter table public.pickup_requests enable row level security;
alter table public.notifications enable row level security;
alter table public.handover_records enable row level security;

create policy school_member_read on public.schools for select using(id=public.my_school());
create policy profile_school_read on public.profiles for select using(id=auth.uid() or (school_id=public.my_school() and public.my_role()='admin'));
create policy profile_self_update on public.profiles for update using(id=auth.uid()) with check(id=auth.uid());
create policy students_authorized_read on public.students for select using(school_id=public.my_school() and public.can_access_student(id));
create policy students_admin_manage on public.students for all using(school_id=public.my_school() and public.my_role()='admin') with check(school_id=public.my_school() and public.my_role()='admin');
create policy relationships_guardian_or_admin_read on public.parent_student_relationships for select using(parent_id=auth.uid() or (public.my_role()='admin' and exists(select 1 from students s where s.id=student_id and s.school_id=public.my_school())));
create policy school_admin_manage_relationships on public.parent_student_relationships for all using(public.my_role()='admin' and exists(select 1 from students s where s.id=student_id and s.school_id=public.my_school())) with check(public.my_role()='admin');
create policy school_fleet_read on public.buses for select using(school_id=public.my_school());
create policy admin_manage_buses on public.buses for all using(school_id=public.my_school() and public.my_role()='admin') with check(school_id=public.my_school() and public.my_role()='admin');
create policy driver_self_read on public.drivers for select using(id=auth.uid() or (school_id=public.my_school() and public.my_role()='admin'));
create policy admin_manage_drivers on public.drivers for all using(school_id=public.my_school() and public.my_role()='admin') with check(school_id=public.my_school() and public.my_role()='admin');
create policy school_routes_read on public.routes for select using(school_id=public.my_school());
create policy admin_manage_routes on public.routes for all using(school_id=public.my_school() and public.my_role()='admin') with check(school_id=public.my_school() and public.my_role()='admin');
create policy assignment_authorized_read on public.bus_assignments for select using(school_id=public.my_school() and (public.my_role() in ('admin','driver') or exists(select 1 from parent_student_relationships r where r.parent_id=auth.uid() and r.student_id=bus_assignments.student_id)));
create policy admin_manage_assignments on public.bus_assignments for all using(school_id=public.my_school() and public.my_role()='admin') with check(school_id=public.my_school() and public.my_role()='admin');
create policy trip_assigned_read on public.trips for select using(school_id=public.my_school() and (public.my_role()='admin' or driver_id=auth.uid() or exists(select 1 from bus_assignments a join parent_student_relationships r on r.student_id=a.student_id where a.bus_id=trips.bus_id and r.parent_id=auth.uid() and a.active)));
create policy driver_start_trip on public.trips for insert with check(school_id=public.my_school() and public.my_role()='driver' and driver_id=auth.uid());
create policy driver_end_trip on public.trips for update using(driver_id=auth.uid() or (school_id=public.my_school() and public.my_role()='admin')) with check(school_id=public.my_school());
create policy location_authorized_read on public.bus_locations for select using(school_id=public.my_school() and exists(select 1 from trips t where t.id=trip_id and (public.my_role()='admin' or t.driver_id=auth.uid() or exists(select 1 from bus_assignments a join parent_student_relationships r on r.student_id=a.student_id where a.bus_id=t.bus_id and a.active and r.parent_id=auth.uid()))));
create policy driver_location_write on public.bus_locations for insert with check(school_id=public.my_school() and exists(select 1 from trips t where t.id=trip_id and t.driver_id=auth.uid() and t.status='active'));
create policy pickup_authorized_read on public.pickup_requests for select using(school_id=public.my_school() and (public.my_role() in ('admin','driver') or exists(select 1 from parent_student_relationships r where r.parent_id=auth.uid() and r.student_id=pickup_requests.student_id)));
create policy pickup_guardian_create on public.pickup_requests for insert with check(school_id=public.my_school() and requested_by=auth.uid() and (public.my_role()='admin' or exists(select 1 from parent_student_relationships r where r.parent_id=auth.uid() and r.student_id=pickup_requests.student_id)));
create policy pickup_staff_update on public.pickup_requests for update using(school_id=public.my_school() and public.my_role() in ('admin','driver')) with check(school_id=public.my_school());
create policy notification_owner_read on public.notifications for select using(profile_id=auth.uid());
create policy notification_owner_update on public.notifications for update using(profile_id=auth.uid()) with check(profile_id=auth.uid());
create policy handover_authorized_read on public.handover_records for select using(school_id=public.my_school() and (guardian_id=auth.uid() or public.my_role()='admin' or public.my_role()='driver'));
create policy handover_staff_create on public.handover_records for insert with check(school_id=public.my_school() and public.my_role() in ('admin','driver') and exists(select 1 from parent_student_relationships r where r.parent_id=guardian_id and r.student_id=student_id));

alter publication supabase_realtime add table public.bus_locations, public.pickup_requests, public.notifications;

