-- Schemas are documentation until enforcement is switched on.
ALTER TABLE forms ADD COLUMN schema_enforced INTEGER NOT NULL DEFAULT 0;

-- Forms that already had a schema were validating before this column existed: keep that behaviour.
UPDATE forms SET schema_enforced = 1 WHERE fields != '[]';
