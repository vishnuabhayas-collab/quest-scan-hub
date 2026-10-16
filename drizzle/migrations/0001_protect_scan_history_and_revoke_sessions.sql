-- Keep issued team credentials from passing the revocation boundary even when issued in the same second.
CREATE OR REPLACE FUNCTION public.admin_force_logout_team(p_team_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;
  UPDATE public.teams SET sessions_revoked_at = clock_timestamp() WHERE id = p_team_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','error','message','Team not found.');
  END IF;
  RETURN jsonb_build_object('status','ok');
END;
$$;

CREATE OR REPLACE FUNCTION public.scan_qr_revoked_check(p_team_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rev timestamptz; v_iat timestamptz;
BEGIN
  SELECT sessions_revoked_at INTO v_rev FROM public.teams WHERE id = p_team_id;
  IF v_rev IS NULL THEN RETURN false; END IF;
  BEGIN
    v_iat := to_timestamp(((auth.jwt() ->> 'iat'))::numeric);
  EXCEPTION WHEN others THEN
    v_iat := NULL;
  END;
  RETURN v_iat IS NULL OR v_iat <= v_rev;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_qr_delete_with_scans()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.scans WHERE qr_id = OLD.id) THEN
    RAISE EXCEPTION 'This task has scan history. Remove or roll back its scans before deleting it.';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.prevent_qr_delete_with_scans() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER qr_codes_preserve_scans_before_delete
BEFORE DELETE ON public.qr_codes
FOR EACH ROW EXECUTE FUNCTION public.prevent_qr_delete_with_scans();

ALTER TABLE public.team_routes DROP CONSTRAINT team_routes_qr_id_fkey;
ALTER TABLE public.team_routes ADD CONSTRAINT team_routes_qr_id_fkey
  FOREIGN KEY (qr_id) REFERENCES public.qr_codes(id) ON DELETE CASCADE;