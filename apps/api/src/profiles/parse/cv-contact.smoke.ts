import assert from "node:assert/strict";
import { extractPhone, normalizeCvPhone, parseCvText } from "../cv-parser";
import { scoreProfileCompleteness } from "@job-talentio/shared";
import {
  employeeOnboardingSchema,
  profileUpdateSchema,
} from "@job-talentio/shared";
for (const schema of [employeeOnboardingSchema, profileUpdateSchema]) {
  assert.equal(schema.safeParse({ desiredSalaryMin: 2500.25 }).success, true);
  assert.equal(
    schema.safeParse({ desiredSalaryMin: 1.000001 }).success,
    false,
    "Money must have at most two decimals",
  );
}
assert.equal(extractPhone("Bachelor 2015 2019"), undefined);
assert.equal(extractPhone("2015 - 2019\n2024 - Present"), undefined);
assert.equal(extractPhone("jane@example.test\nEducation 2015 2019"), undefined);
assert.equal(extractPhone("Phone: +998 90 111 22 33"), "+998901112233");
assert.equal(extractPhone("Phone: +62 812 1234 5678"), "+6281212345678");
assert.equal(
  normalizeCvPhone("8 900 123 45 67"),
  "89001234567",
  "Do not invent a country prefix",
);
assert.equal(normalizeCvPhone("0152019"), undefined);
const parsed = parseCvText("Bachelor 2015 2019", []);
assert.equal(parsed.phone, undefined);
const completeness = scoreProfileCompleteness({
  residenceCountryId: "country",
  noExperience: true,
});
assert.equal(completeness.checks.find((c) => c.id === "city")?.ok, true);
assert.equal(completeness.checks.find((c) => c.id === "experience")?.ok, true);
console.log("CV contacts and country/no-experience completeness passed");
