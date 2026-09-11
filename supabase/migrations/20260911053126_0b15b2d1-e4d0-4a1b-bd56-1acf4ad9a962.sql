alter table public.teams add column if not exists sessions_revoked_at timestamptz;

create or replace function public.admin_force_logout_team(p_team_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(),'admin') then
    raise exception 'Not authorised';
  end if;
  update public.teams set sessions_revoked_at = now() where id = p_team_id;
  if not found then
    return jsonb_build_object('status','error','message','Team not found.');
  end if;
  return jsonb_build_object('status','ok');
end;
$$;

revoke all on function public.admin_force_logout_team(uuid) from public, anon;
grant execute on function public.admin_force_logout_team(uuid) to authenticated;

create or replace function public.get_team_dashboard()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_team public.teams%rowtype;
  v_current jsonb;
  v_history jsonb;
  v_iat timestamptz;
begin
  select t.* into v_team from public.teams t where t.id = public.current_team_id();
  if not found then
    return jsonb_build_object('status','error','message','Your account is not linked to a team.');
  end if;

  begin
    v_iat := to_timestamp(((auth.jwt() ->> 'iat'))::numeric);
  exception when others then
    v_iat := null;
  end;

  if v_team.sessions_revoked_at is not null and (v_iat is null or v_iat < v_team.sessions_revoked_at) then
    return jsonb_build_object('status','logged_out','message','You have been signed out by the organiser.');
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