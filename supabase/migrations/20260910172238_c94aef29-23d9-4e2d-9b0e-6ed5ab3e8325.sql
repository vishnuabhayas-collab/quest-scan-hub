
revoke all on function public.has_role(uuid, public.app_role) from public, anon;
revoke all on function public.current_team_id() from public, anon;
grant execute on function public.has_role(uuid, public.app_role) to authenticated;
grant execute on function public.current_team_id() to authenticated;
