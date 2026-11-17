-- Run in the CareBee remix database through Lovable.
-- Repairs the installed RPC in place and preserves its owner and grants.
DO $repair$
DECLARE
  rpc_oid regprocedure := to_regprocedure('public.save_box_medicine(uuid,jsonb,jsonb)');
  original_definition text;
  repaired_definition text;
  patch text[];
  old_count integer;
  new_count integer;
BEGIN
  IF rpc_oid IS NULL THEN
    RAISE EXCEPTION 'save_box_medicine is missing. Install the seven-round migration in Lovable first.';
  END IF;

  original_definition := replace(pg_get_functiondef(rpc_oid), E'\r\n', E'\n');
  repaired_definition := original_definition;

  -- Match the variable in context, so column names and the JSON key stay intact.
  FOREACH patch SLICE 1 IN ARRAY ARRAY[
    ARRAY['  owner_id uuid;', '  v_owner_id uuid;'],
    ARRAY['    owner_id := ', '    v_owner_id := '],
    ARRAY[
      'IF owner_id IS NULL OR NOT public.can_access(owner_id) THEN',
      'IF v_owner_id IS NULL OR NOT public.can_access(v_owner_id) THEN'
    ],
    ARRAY['d.owner_id = owner_id AND', 'd.owner_id = v_owner_id AND'],
    ARRAY[
      $old$      owner_id, btrim(_medicine ->> 'name')$old$,
      $new$      v_owner_id, btrim(_medicine ->> 'name')$new$
    ],
    ARRAY[
      'existing_owner IS DISTINCT FROM owner_id OR',
      'existing_owner IS DISTINCT FROM v_owner_id OR'
    ],
    ARRAY['WHERE p.id = owner_id;', 'WHERE p.id = v_owner_id;'],
    ARRAY['        owner_id, saved_id, mapped_slot', '        v_owner_id, saved_id, mapped_slot']
  ]
  LOOP
    old_count := (length(original_definition) - length(replace(original_definition, patch[1], '')))
                 / length(patch[1]);
    new_count := (length(original_definition) - length(replace(original_definition, patch[2], '')))
                 / length(patch[2]);
    IF old_count = 1 AND new_count = 0 THEN
      repaired_definition := replace(repaired_definition, patch[1], patch[2]);
    ELSIF old_count <> 0 OR new_count <> 1 THEN
      RAISE EXCEPTION 'Unexpected save_box_medicine definition near "%". No changes applied.', patch[1];
    END IF;
  END LOOP;

  IF repaired_definition IS DISTINCT FROM original_definition THEN
    EXECUTE repaired_definition;
    RAISE NOTICE 'save_box_medicine repaired.';
  ELSE
    RAISE NOTICE 'save_box_medicine already repaired.';
  END IF;
END;
$repair$;
