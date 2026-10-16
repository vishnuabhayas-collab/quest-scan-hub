DROP POLICY "teams readable by admin or owner" ON public.teams;
CREATE POLICY "teams readable by admin or active owner" ON public.teams FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR (
    id = public.current_team_id()
    AND NOT public.scan_qr_revoked_check(id)
  )
);