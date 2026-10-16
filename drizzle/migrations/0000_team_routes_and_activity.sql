CREATE TABLE public.team_routes (
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  qr_id uuid NOT NULL REFERENCES public.qr_codes(id) ON DELETE RESTRICT,
  position integer NOT NULL CHECK (position > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_routes_team_position_key UNIQUE (team_id, position),
  CONSTRAINT team_routes_team_qr_key UNIQUE (team_id, qr_id)
);
GRANT SELECT ON public.team_routes TO authenticated;
GRANT ALL ON public.team_routes TO service_role;
ALTER TABLE public.team_routes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team routes admin read" ON public.team_routes FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE INDEX team_routes_qr_id_idx ON public.team_routes(qr_id);

CREATE TABLE public.team_activity (
  team_id uuid PRIMARY KEY REFERENCES public.teams(id) ON DELETE CASCADE,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.team_activity TO authenticated;
GRANT ALL ON public.team_activity TO service_role;
ALTER TABLE public.team_activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "team activity admin read" ON public.team_activity FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE INDEX team_activity_last_seen_at_idx ON public.team_activity(last_seen_at);

-- Preserve all existing scan records and use their original scan order as each current team's route prefix.
INSERT INTO public.team_routes (team_id, qr_id, position)
SELECT ranked.team_id, ranked.qr_id, ranked.position::integer
FROM (
  SELECT t.id AS team_id, q.id AS qr_id,
         row_number() OVER (
           PARTITION BY t.id
           ORDER BY CASE WHEN s.scanned_at IS NULL THEN 1 ELSE 0 END,
                    s.scanned_at ASC NULLS LAST, q.created_at ASC, q.id ASC
         ) AS position
  FROM public.teams t
  CROSS JOIN public.qr_codes q
  LEFT JOIN public.scans s ON s.team_id = t.id AND s.qr_id = q.id
) ranked;

CREATE OR REPLACE FUNCTION public.save_team_route(p_team_id uuid, p_qr_ids jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ids uuid[];
  v_total integer;
  v_existing integer;
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
  SELECT count(*) INTO v_existing FROM public.team_routes WHERE team_id = p_team_id;
  IF v_existing > 0 THEN
    DELETE FROM public.team_routes WHERE team_id = p_team_id;
  END IF;
  INSERT INTO public.team_routes (team_id, qr_id, position)
  SELECT p_team_id, ids.id, ids.position::integer FROM unnest(v_ids) WITH ORDINALITY AS ids(id, position);
  RETURN jsonb_build_object('status','ok');
END;
$$;
REVOKE ALL ON FUNCTION public.save_team_route(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_team_route(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_admin_team_route(p_team_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tasks jsonb;
  v_total integer;
  v_assigned integer;
  v_expected text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.teams WHERE id = p_team_id) THEN
    RETURN jsonb_build_object('status','error','message','Team not found.');
  END IF;
  SELECT count(*) INTO v_total FROM public.qr_codes;
  SELECT count(*) INTO v_assigned FROM public.team_routes WHERE team_id = p_team_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'qr_id', q.id, 'position', tr.position, 'title', q.title,
      'active', q.active, 'completed', (s.id IS NOT NULL)
    ) ORDER BY coalesce(tr.position, 2147483647), q.title, q.id), '[]'::jsonb)
    INTO v_tasks
  FROM public.qr_codes q
  LEFT JOIN public.team_routes tr ON tr.qr_id = q.id AND tr.team_id = p_team_id
  LEFT JOIN public.scans s ON s.qr_id = q.id AND s.team_id = p_team_id;
  SELECT q.title INTO v_expected
  FROM public.team_routes tr JOIN public.qr_codes q ON q.id = tr.qr_id
  WHERE tr.team_id = p_team_id
    AND NOT EXISTS (SELECT 1 FROM public.scans s WHERE s.team_id = p_team_id AND s.qr_id = tr.qr_id)
  ORDER BY tr.position LIMIT 1;
  RETURN jsonb_build_object(
    'status','ok', 'tasks',v_tasks,
    'published',(v_total > 0 AND v_assigned = v_total),
    'locked',EXISTS (SELECT 1 FROM public.scans WHERE team_id = p_team_id),
    'expected_task',v_expected
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_admin_team_route(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_team_route(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_team_activity()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_activity jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'team_id', t.id,
    'team_name', t.team_name,
    'online', coalesce(a.last_seen_at > now() - interval '2 minutes', false),
    'last_activity', a.last_seen_at,
    'completed', progress.completed,
    'total', progress.total,
    'last_completed_task', progress.last_completed_task,
    'next_expected_task', progress.next_expected_task
  ) ORDER BY t.team_name), '[]'::jsonb)
  INTO v_activity
  FROM public.teams t
  LEFT JOIN public.team_activity a ON a.team_id = t.id
  LEFT JOIN LATERAL (
    SELECT count(s.id)::integer AS completed,
           (SELECT count(*)::integer FROM public.team_routes all_routes WHERE all_routes.team_id = t.id) AS total,
           (SELECT q.title FROM public.team_routes last_route JOIN public.qr_codes q ON q.id = last_route.qr_id
            JOIN public.scans last_scan ON last_scan.team_id = last_route.team_id AND last_scan.qr_id = last_route.qr_id
            WHERE last_route.team_id = t.id ORDER BY last_route.position DESC LIMIT 1) AS last_completed_task,
           (SELECT q.title FROM public.team_routes next_route JOIN public.qr_codes q ON q.id = next_route.qr_id
            WHERE next_route.team_id = t.id AND NOT EXISTS
              (SELECT 1 FROM public.scans next_scan WHERE next_scan.team_id = t.id AND next_scan.qr_id = next_route.qr_id)
            ORDER BY next_route.position LIMIT 1) AS next_expected_task
    FROM public.team_routes r LEFT JOIN public.scans s ON s.team_id = t.id AND s.qr_id = r.qr_id
    WHERE r.team_id = t.id
  ) progress ON true;
  RETURN v_activity;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_team_activity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_team_activity() TO authenticated;

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
  IF v_team.sessions_revoked_at IS NOT NULL AND (v_iat IS NULL OR v_iat < v_team.sessions_revoked_at) THEN
    RETURN jsonb_build_object('status','logged_out','message','You have been signed out by the organiser.');
  END IF;
  SELECT count(*) INTO v_total FROM public.team_routes WHERE team_id = v_team.id;
  IF v_total = 0 THEN
    RETURN jsonb_build_object('status','route_unassigned','message','Your team route has not been published yet. Please contact the organiser.');
  END IF;
  INSERT INTO public.team_activity (team_id, last_seen_at) VALUES (v_team.id, now())
  ON CONFLICT (team_id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at;
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
REVOKE ALL ON FUNCTION public.get_team_dashboard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_team_dashboard() TO authenticated;

CREATE OR REPLACE FUNCTION public.scan_qr(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_team uuid;
  v_qr public.qr_codes%rowtype;
  v_expected uuid;
  v_next_title text;
  v_next_clue text;
  v_total integer;
  v_completed integer;
BEGIN
  v_team := public.current_team_id();
  IF v_team IS NULL THEN
    RETURN jsonb_build_object('status','error','message','Your account is not linked to a team.');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_team::text, 0));
  IF public.scan_qr_revoked_check(v_team) THEN
    RETURN jsonb_build_object('status','logged_out','message','You have been signed out by the organiser.');
  END IF;
  SELECT * INTO v_qr FROM public.qr_codes WHERE token = p_token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','invalid','message','This QR code is not recognised.');
  END IF;
  IF NOT v_qr.active THEN
    RETURN jsonb_build_object('status','inactive','message','This QR code is no longer active.');
  END IF;
  SELECT count(*) INTO v_total FROM public.team_routes WHERE team_id = v_team;
  IF v_total = 0 THEN
    RETURN jsonb_build_object('status','route_unassigned','message','Your team route has not been published yet.');
  END IF;
  IF EXISTS (SELECT 1 FROM public.scans WHERE team_id = v_team AND qr_id = v_qr.id) THEN
    RETURN jsonb_build_object('status','duplicate','message','You have already completed this task.');
  END IF;
  SELECT tr.qr_id INTO v_expected FROM public.team_routes tr
  WHERE tr.team_id = v_team AND NOT EXISTS (
    SELECT 1 FROM public.scans s WHERE s.team_id = v_team AND s.qr_id = tr.qr_id
  ) ORDER BY tr.position LIMIT 1;
  IF v_expected IS NULL THEN
    RETURN jsonb_build_object('status','completed','message','Your route is complete.');
  END IF;
  IF v_qr.id <> v_expected THEN
    SELECT q.title INTO v_next_title FROM public.qr_codes q WHERE q.id = v_expected;
    RETURN jsonb_build_object('status','out_of_order','message','That is not the next task in your team route.','next_task_title',v_next_title);
  END IF;
  BEGIN
    INSERT INTO public.scans (team_id, qr_id, points_awarded) VALUES (v_team, v_qr.id, v_qr.points);
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('status','duplicate','message','You have already completed this task.');
  END;
  UPDATE public.teams SET points = points + v_qr.points WHERE id = v_team;
  INSERT INTO public.team_activity (team_id, last_seen_at) VALUES (v_team, now())
  ON CONFLICT (team_id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at;
  SELECT count(*) INTO v_completed FROM public.scans WHERE team_id = v_team;
  IF v_completed >= v_total THEN
    RETURN jsonb_build_object('status','completed','title',v_qr.title,'message','Congratulations — your route is complete.');
  END IF;
  SELECT q.title, q.clue INTO v_next_title, v_next_clue
  FROM public.team_routes tr JOIN public.qr_codes q ON q.id = tr.qr_id
  WHERE tr.team_id = v_team AND NOT EXISTS (
    SELECT 1 FROM public.scans s WHERE s.team_id = v_team AND s.qr_id = tr.qr_id
  ) ORDER BY tr.position LIMIT 1;
  RETURN jsonb_build_object('status','success','title',v_qr.title,'next_task_title',v_next_title,'clue',v_next_clue);
END;
$$;
REVOKE ALL ON FUNCTION public.scan_qr(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scan_qr(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_delete_scan(p_scan_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_scan public.scans%rowtype;
  v_position integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;
  SELECT * INTO v_scan FROM public.scans WHERE id = p_scan_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','error','message','Scan not found.');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_scan.team_id::text, 0));
  SELECT position INTO v_position FROM public.team_routes WHERE team_id = v_scan.team_id AND qr_id = v_scan.qr_id;
  IF v_position IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.scans s JOIN public.team_routes later ON later.team_id = s.team_id AND later.qr_id = s.qr_id
    WHERE s.team_id = v_scan.team_id AND later.position > v_position
  ) THEN
    RETURN jsonb_build_object('status','error','message','Remove later completed tasks first to preserve this team’s route progress.');
  END IF;
  DELETE FROM public.scans WHERE id = p_scan_id RETURNING * INTO v_scan;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','error','message','Scan not found.');
  END IF;
  UPDATE public.teams SET points = greatest(points - v_scan.points_awarded, 0) WHERE id = v_scan.team_id;
  RETURN jsonb_build_object('status','ok');
END;
$$;
REVOKE ALL ON FUNCTION public.admin_delete_scan(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_scan(uuid) TO authenticated;