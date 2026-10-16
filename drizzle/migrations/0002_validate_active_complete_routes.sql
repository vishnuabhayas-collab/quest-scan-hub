CREATE OR REPLACE FUNCTION public.prevent_qr_delete_with_scans()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.scans WHERE qr_id = OLD.id) THEN
    RAISE EXCEPTION 'This task has scan history. Remove or roll back its scans before deleting it.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.team_routes WHERE qr_id = OLD.id) THEN
    RAISE EXCEPTION 'This task is included in one or more team routes and cannot be deleted.';
  END IF;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_team_route(p_team_id uuid, p_qr_ids jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ids uuid[];
  v_total integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;
  IF p_qr_ids IS NULL OR jsonb_typeof(p_qr_ids) <> 'array' THEN
    RETURN jsonb_build_object('status','error','message','Choose a complete task route before publishing.');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_team_id::text, 0));
  IF NOT EXISTS (SELECT 1 FROM public.teams WHERE id = p_team_id) THEN
    RETURN jsonb_build_object('status','error','message','Team not found.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.scans WHERE team_id = p_team_id) THEN
    RETURN jsonb_build_object('status','locked','message','This route cannot be changed after the team has started scanning.');
  END IF;
  SELECT count(*) INTO v_total FROM public.qr_codes;
  IF v_total = 0 THEN
    RETURN jsonb_build_object('status','error','message','Create the shared QR tasks before publishing team routes.');
  END IF;
  BEGIN
    SELECT array_agg(value::uuid ORDER BY ordinality) INTO v_ids
    FROM jsonb_array_elements_text(p_qr_ids) WITH ORDINALITY AS items(value, ordinality);
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('status','error','message','The route contains an invalid task.');
  END;
  IF coalesce(array_length(v_ids, 1), 0) <> v_total
     OR (SELECT count(DISTINCT id) FROM unnest(v_ids) AS ids(id)) <> v_total
     OR EXISTS (SELECT 1 FROM unnest(v_ids) AS ids(id) LEFT JOIN public.qr_codes q ON q.id = ids.id WHERE q.id IS NULL)
     OR EXISTS (SELECT 1 FROM public.qr_codes q WHERE NOT (q.id = ANY(v_ids))) THEN
    RETURN jsonb_build_object('status','error','message','Every shared task must appear exactly once in the route.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.qr_codes q WHERE q.id = ANY(v_ids) AND NOT q.active) THEN
    RETURN jsonb_build_object('status','error','message','Activate every shared task before publishing the route.');
  END IF;
  DELETE FROM public.team_routes WHERE team_id = p_team_id;
  INSERT INTO public.team_routes (team_id, qr_id, position)
  SELECT p_team_id, ids.id, ids.position::integer FROM unnest(v_ids) WITH ORDINALITY AS ids(id, position);
  RETURN jsonb_build_object('status','ok');
END;
$$;

CREATE OR REPLACE FUNCTION public.get_team_dashboard()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_team public.teams%rowtype;
  v_current jsonb;
  v_history jsonb;
  v_iat timestamptz;
  v_total integer;
  v_completed integer;
  v_last_completed text;
BEGIN
  SELECT t.* INTO v_team FROM public.teams t WHERE t.id = public.current_team_id();
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','error','message','Your account is not linked to a team.');
  END IF;
  BEGIN
    v_iat := to_timestamp(((auth.jwt() ->> 'iat'))::numeric);
  EXCEPTION WHEN others THEN
    v_iat := NULL;
  END;
  IF v_team.sessions_revoked_at IS NOT NULL AND (v_iat IS NULL OR v_iat <= v_team.sessions_revoked_at) THEN
    RETURN jsonb_build_object('status','logged_out','message','You have been signed out by the organiser.');
  END IF;
  SELECT count(*) INTO v_total FROM public.team_routes WHERE team_id = v_team.id;
  IF v_total = 0 THEN
    RETURN jsonb_build_object('status','route_unassigned','message','Your team route has not been published yet. Please contact the organiser.');
  END IF;
  INSERT INTO public.team_activity (team_id, last_seen_at) VALUES (v_team.id, now())
  ON CONFLICT (team_id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at
  WHERE public.team_activity.last_seen_at < now() - interval '45 seconds';
  SELECT count(*) INTO v_completed FROM public.scans WHERE team_id = v_team.id;
  SELECT q.title INTO v_last_completed FROM public.team_routes tr
    JOIN public.qr_codes q ON q.id = tr.qr_id
    JOIN public.scans s ON s.team_id = tr.team_id AND s.qr_id = tr.qr_id
    WHERE tr.team_id = v_team.id ORDER BY tr.position DESC LIMIT 1;
  SELECT jsonb_build_object('title', q.title, 'clue', q.clue, 'position', tr.position)
  INTO v_current
  FROM public.team_routes tr JOIN public.qr_codes q ON q.id = tr.qr_id
  WHERE tr.team_id = v_team.id AND NOT EXISTS (
    SELECT 1 FROM public.scans s WHERE s.team_id = v_team.id AND s.qr_id = tr.qr_id
  ) ORDER BY tr.position LIMIT 1;
  SELECT coalesce(jsonb_agg(jsonb_build_object('title', q.title, 'scanned_at', s.scanned_at)
      ORDER BY tr.position DESC), '[]'::jsonb)
  INTO v_history
  FROM public.scans s JOIN public.qr_codes q ON q.id = s.qr_id
  JOIN public.team_routes tr ON tr.team_id = s.team_id AND tr.qr_id = s.qr_id
  WHERE s.team_id = v_team.id;
  RETURN jsonb_build_object(
    'status','ok', 'team_name',v_team.team_name, 'points',v_team.points,
    'current',v_current, 'history',v_history,
    'completed',v_completed, 'total',v_total,
    'last_completed_task',v_last_completed, 'is_complete',(v_completed >= v_total)
  );
END;
$$;