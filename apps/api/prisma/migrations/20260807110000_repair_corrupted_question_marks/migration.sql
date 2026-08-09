-- Repair text corrupted when UTF-8 em-dash (U+2014, 3 bytes) was stored as "???"
-- during earlier seed runs. Also collapse leftover "????" emoji mojibake in free text.

UPDATE "JobPost"
SET
  title = trim(both FROM regexp_replace(replace(title, '???', ' - '), '\s+-\s+', ' - ', 'g')),
  description = replace(description, '???', ' - ')
WHERE title LIKE '%???%' OR description LIKE '%???%';

UPDATE "EmployeeProfile"
SET
  headline = replace(headline, '???', ' - '),
  summary = replace(summary, '???', ' - '),
  "desiredPosition" = replace("desiredPosition", '???', ' - ')
WHERE
  headline LIKE '%???%'
  OR summary LIKE '%???%'
  OR "desiredPosition" LIKE '%???%';

UPDATE "WorkExperience"
SET
  title = replace(title, '???', ' - '),
  description = replace(description, '???', ' - ')
WHERE title LIKE '%???%' OR description LIKE '%???%';
