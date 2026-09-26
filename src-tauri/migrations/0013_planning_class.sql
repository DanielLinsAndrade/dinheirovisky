ALTER TABLE recurrence_templates ADD COLUMN planning_class TEXT
 CHECK(planning_class IS NULL OR planning_class IN ('fixed','seasonal'));
