
create type public.app_role as enum ('admin','team');

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  team_name text not null unique,
  points integer not null default 0,
  created_at timestamptz not null default now()
);
grant select on public.teams to authenticated;
grant all on public.teams to service_role;
alter table public.teams enable row level security;

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  team_id uuid references public.teams(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index profiles_team_id_idx on public.profiles(team_id);
grant select on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create table public.qr_codes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  points integer not null default 0,
  clue text not null,
  token text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.qr_codes to authenticated;
grant all on public.qr_codes to service_role;
alter table public.qr_codes enable row level security;

create table public.scans (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  qr_id uuid not null references public.qr_codes(id) on delete cascade,
  points_awarded integer not null default 0,
  scanned_at timestamptz not null default now(),
  unique (team_id, qr_id)
);
create index scans_team_id_idx on public.scans(team_id);
create index scans_qr_id_idx on public.scans(qr_id);
grant select, delete on public.scans to authenticated;
grant all on public.scans to service_role;
alter table public.scans enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create or replace function public.current_team_id()
returns uuid language sql stable security definer set search_path = public as $$
  select team_id from public.profiles where user_id = auth.uid()
$$;

create policy "teams readable by admin or owner" on public.teams for select to authenticated
  using (public.has_role(auth.uid(),'admin') or id = public.current_team_id());
create policy "teams admin insert" on public.teams for insert to authenticated
  with check (public.has_role(auth.uid(),'admin'));
create policy "teams admin update" on public.teams for update to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
create policy "teams admin delete" on public.teams for delete to authenticated
  using (public.has_role(auth.uid(),'admin'));

create policy "profiles readable by admin or self" on public.profiles for select to authenticated
  using (public.has_role(auth.uid(),'admin') or user_id = auth.uid());

create policy "roles readable by admin or self" on public.user_roles for select to authenticated
  using (public.has_role(auth.uid(),'admin') or user_id = auth.uid());

create policy "qr admin select" on public.qr_codes for select to authenticated
  using (public.has_role(auth.uid(),'admin'));
create policy "qr admin insert" on public.qr_codes for insert to authenticated
  with check (public.has_role(auth.uid(),'admin'));
create policy "qr admin update" on public.qr_codes for update to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
create policy "qr admin delete" on public.qr_codes for delete to authenticated
  using (public.has_role(auth.uid(),'admin'));

create policy "scans admin select" on public.scans for select to authenticated
  using (public.has_role(auth.uid(),'admin'));
create policy "scans admin delete" on public.scans for delete to authenticated
  using (public.has_role(auth.uid(),'admin'));

-- Team scanning: validates, awards points, returns clue only
create or replace function public.scan_qr(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_team uuid;
  v_qr public.qr_codes%rowtype;
begin
  v_team := public.current_team_id();
  if v_team is null then
    return jsonb_build_object('status','error','message','Your account is not linked to a team.');
  end if;

  select * into v_qr from public.qr_codes where token = p_token;
  if not found then
    return jsonb_build_object('status','invalid','message','This QR code is not recognised.');
  end if;
  if not v_qr.active then
    return jsonb_build_object('status','inactive','message','This QR code is no longer active.');
  end if;

  begin
    insert into public.scans (team_id, qr_id, points_awarded)
    values (v_team, v_qr.id, v_qr.points);
  exception when unique_violation then
    return jsonb_build_object('status','duplicate','message','You have already scanned this QR code.');
  end;

  update public.teams set points = points + v_qr.points where id = v_team;

  return jsonb_build_object('status','success','title',v_qr.title,'clue',v_qr.clue);
end;
$$;

create or replace function public.get_team_dashboard()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_team public.teams%rowtype;
  v_current jsonb;
  v_history jsonb;
begin
  select t.* into v_team from public.teams t where t.id = public.current_team_id();
  if not found then
    return jsonb_build_object('status','error','message','Your account is not linked to a team.');
  end if;

  select jsonb_build_object('title', q.title, 'clue', q.clue, 'scanned_at', s.scanned_at)
    into v_current
  from public.scans s join public.qr_codes q on q.id = s.qr_id
  where s.team_id = v_team.id
  order by s.scanned_at desc limit 1;

  select coalesce(jsonb_agg(jsonb_build_object('title', q.title, 'scanned_at', s.scanned_at)
           order by s.scanned_at desc), '[]'::jsonb)
    into v_history
  from public.scans s join public.qr_codes q on q.id = s.qr_id
  where s.team_id = v_team.id;

  return jsonb_build_object('status','ok','team_name',v_team.team_name,'points',v_team.points,
                            'current', v_current, 'history', v_history);
end;
$$;

-- Admin: delete a scan and roll back the points atomically
create or replace function public.admin_delete_scan(p_scan_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_scan public.scans%rowtype;
begin
  if not public.has_role(auth.uid(),'admin') then
    raise exception 'Not authorised';
  end if;
  delete from public.scans where id = p_scan_id returning * into v_scan;
  if not found then
    return jsonb_build_object('status','error','message','Scan not found.');
  end if;
  update public.teams set points = greatest(points - v_scan.points_awarded, 0) where id = v_scan.team_id;
  return jsonb_build_object('status','ok');
end;
$$;

-- First signed-in user can claim the admin role while no admin exists
create or replace function public.claim_first_admin()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if exists (select 1 from public.user_roles where role = 'admin') then
    return jsonb_build_object('status','taken');
  end if;
  insert into public.user_roles (user_id, role) values (auth.uid(),'admin')
    on conflict do nothing;
  return jsonb_build_object('status','ok');
end;
$$;

revoke all on function public.scan_qr(text) from public, anon;
revoke all on function public.get_team_dashboard() from public, anon;
revoke all on function public.admin_delete_scan(uuid) from public, anon;
revoke all on function public.claim_first_admin() from public, anon;
grant execute on function public.scan_qr(text) to authenticated;
grant execute on function public.get_team_dashboard() to authenticated;
grant execute on function public.admin_delete_scan(uuid) to authenticated;
grant execute on function public.claim_first_admin() to authenticated;
grant execute on function public.has_role(uuid, public.app_role) to authenticated;
grant execute on function public.current_team_id() to authenticated;
