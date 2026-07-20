-- Data migration (expand-migrate): the schedule now validates that an assigned
-- coach is *set up to coach* — role `coach`, or an owner/admin explicitly granted
-- the `can_coach` capability. Before this rule ANY non-student could be assigned,
-- so an owner/admin may already be teaching. Grant the capability to exactly those
-- people, so every pre-existing assignment stays valid (and keeps showing in the
-- coach picker) instead of silently becoming un-editable.
--
-- Idempotent: safe to re-run. Only `lesson_series_rule.coach_member_id` and
-- `lesson_session.coach_member_id` are considered — those are the columns
-- requireCoach() guards; `lesson_series.assistant_coach_member_id` is an unused
-- seam that is not validated.
INSERT INTO "member_profile" ("member_id", "organization_id", "can_coach")
SELECT DISTINCT m."id", m."organization_id", true
FROM "member" m
WHERE m."role" IN ('owner', 'admin')
  AND (
    EXISTS (SELECT 1 FROM "lesson_series_rule" r WHERE r."coach_member_id" = m."id")
    OR EXISTS (SELECT 1 FROM "lesson_session" s WHERE s."coach_member_id" = m."id")
  )
ON CONFLICT ("member_id") DO UPDATE SET "can_coach" = true;
