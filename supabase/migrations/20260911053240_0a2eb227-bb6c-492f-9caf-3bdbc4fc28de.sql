create or replace function public.scan_qr_revoked_check(p_team_id uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_rev timestamptz; v_iat timestamptz;
begin
  select sessions_revoked_at into v_rev from public.teams where id = p_team_id;
  if v_rev is null then return false; end if;
  begin
    v_iat := to_timestamp(((auth.jwt() ->> 'iat'))::numeric);
  exception when others then
    v_iat := null;
  end;
  return v_iat is null or v_iat < v_rev;
end;
$$;

revoke all on function public.scan_qr_revoked_check(uuid) from public, anon, authenticated;