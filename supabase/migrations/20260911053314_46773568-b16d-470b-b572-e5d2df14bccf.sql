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

  if public.scan_qr_revoked_check(v_team) then
    return jsonb_build_object('status','logged_out','message','You have been signed out by the organiser.');
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