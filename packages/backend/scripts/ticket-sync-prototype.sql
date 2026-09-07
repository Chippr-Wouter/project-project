BEGIN;
DO $$
BEGIN
  IF current_database() <> 'measure' THEN
    RAISE EXCEPTION 'Run only against the disposable measure database';
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS prototype_ticket_sync_head (
  project_id uuid PRIMARY KEY,
  epoch text NOT NULL DEFAULT gen_random_uuid()::text,
  revision integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS prototype_ticket_sync_log (
  project_id uuid NOT NULL,
  revision integer NOT NULL,
  ticket_id text NOT NULL,
  PRIMARY KEY (project_id, revision)
);
INSERT INTO prototype_ticket_sync_head(project_id)
VALUES ('00000000-0000-4000-8000-000000000010')
ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION prototype_record_ticket_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  affected_project uuid;
  affected_ticket text;
  next_revision integer;
BEGIN
  affected_project := COALESCE(NEW.project_id, OLD.project_id);
  affected_ticket := COALESCE(NEW.ticket_id, OLD.ticket_id);
  IF affected_project <> '00000000-0000-4000-8000-000000000010' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW IS NOT DISTINCT FROM OLD THEN
    RETURN NULL;
  END IF;
  UPDATE prototype_ticket_sync_head SET revision = revision + 1
    WHERE project_id = affected_project RETURNING revision INTO next_revision;
  IF next_revision IS NULL THEN
    RAISE EXCEPTION 'Missing prototype sync head';
  END IF;
  INSERT INTO prototype_ticket_sync_log VALUES (affected_project, next_revision, affected_ticket);
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS prototype_ticket_sync ON ticket_index;
CREATE TRIGGER prototype_ticket_sync AFTER INSERT OR UPDATE OR DELETE ON ticket_index
FOR EACH ROW EXECUTE FUNCTION prototype_record_ticket_change();
COMMIT;
