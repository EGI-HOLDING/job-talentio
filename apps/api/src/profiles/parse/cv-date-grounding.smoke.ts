import assert from "node:assert/strict";
import { parseCvText } from "../cv-parser";
const sourceText =
  "Jane Doe\nExperience\nFrontend Developer at Apex Soft\nJanuary 2024 - Present\nEducation\nNational University\nBachelor 2015 2019\nSkills: React";
const local = parseCvText(sourceText, [{ name: "React", slug: "react" }]);
assert.equal(local.educations.length, 1);
assert.equal(local.educations[0].school, "National University");
assert.equal(local.educations[0].endDate, "2019-01-01");
assert.equal(local.educations[0].startDate, "2015-01-01");
assert.equal(local.experiences[0].startDate, "2024-01-01");
assert.equal(local.experiences[0].isCurrent, true);
assert.equal(local.experiences[0].endDate, null);
const undated = parseCvText(
  "Jane Doe\nExperience\nFrontend Developer at Apex Soft\nBuilt accessible web applications.\nSkills: React",
  [],
);
for (const experience of undated.experiences) {
  assert.equal(
    experience.startDate ?? null,
    null,
    "Missing dates must not be invented",
  );
  assert.equal(
    experience.endDate ?? null,
    null,
    "Missing dates must not become today",
  );
}
console.log(
  "CV local dates: source years, grouped education and unknown dates passed",
);
