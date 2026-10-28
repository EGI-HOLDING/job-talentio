// Local integration test: real HTTP, authentication, storage, queue and database.
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const origin = "http://localhost:4000/api",
  cache = path.resolve("node_modules/.cache/employee-onboarding");
const password = "Local-onboarding-2026!";
async function request(route, method = "GET", body, session, status = 200) {
  const headers = {};
  if (session) headers.Authorization = "Bearer " + session.accessToken;
  if (body && !(body instanceof FormData))
    headers["Content-Type"] = "application/json";
  const response = await fetch(origin + route, {
    method,
    headers,
    body:
      body instanceof FormData
        ? body
        : body == null
          ? undefined
          : JSON.stringify(body),
  });
  const data = await response.json();
  if (response.status !== status)
    throw Error(
      method +
        " " +
        route +
        " expected " +
        status +
        " got " +
        response.status +
        ": " +
        JSON.stringify(data),
    );
  return data;
}
async function register(suffix) {
  return request(
    "/auth/register",
    "POST",
    {
      email: `onboarding-${Date.now()}-${suffix}@example.test`,
      password,
      fullName: "Onboarding Local Test",
      locale: "id",
      role: "EMPLOYEE",
      acceptTerms: true,
    },
    null,
    201,
  );
}
async function upload(session, filename, bytes) {
  const body = new FormData();
  const type = filename.endsWith(".pdf")
    ? "application/pdf"
    : filename.endsWith(".docx")
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : "application/msword";
  body.append("file", new Blob([bytes], { type }), filename);
  body.append("title", filename);
  body.append("parse", "true");
  return request("/profiles/me/resumes/upload", "POST", body, session, 201);
}
async function parsed(session, id) {
  const end = Date.now() + 180000;
  while (Date.now() < end) {
    const result = await request(
      `/profiles/me/resumes/${id}/parse-status`,
      "GET",
      null,
      session,
    );
    if (result.parseStatus === "READY") {
      assert.equal(
        result.parsedData.meta?.provider,
        "local",
        "Every real CV parse must use the local provider",
      );
      assert.equal(
        result.parsedData.meta?.llmUsed,
        false,
        "GPT must never parse a CV",
      );
      return result;
    }
    if (result.parseStatus === "FAILED") return result;
    await new Promise((r) => setTimeout(r, 750));
  }
  throw Error("Parsing timed out: " + id);
}
function review(data) {
  return {
    replaceExisting: false,
    headline: data.headline,
    summary: data.summary,
    phone: data.phone,
    skills: data.skillNames,
    experiences: data.experiences,
    educations: data.educations,
    languages: data.languages,
  };
}
async function main() {
  const countries = await request("/meta/countries");
  assert.ok(countries.length);
  const country = countries.find((c) => c.iso2 === "UZ") || countries[0];
  const session = await register("cv");
  assert.equal(session.user.employeeOnboarding.status, "IN_PROGRESS");
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(
    path.join(cache, "ui-account.json"),
    JSON.stringify({ email: session.user.email, password }),
  );
  await request("/profiles/me/onboarding", "PATCH", { step: 2 }, session, 400);
  await request(
    "/profiles/me/onboarding",
    "PATCH",
    { desiredPositions: ["Frontend Developer", "UI Designer"], step: 2 },
    session,
  );
  await request(
    "/profiles/me/onboarding",
    "PATCH",
    { preferredCountryIds: [country.id], step: 3 },
    session,
  );
  await request(
    "/profiles/me/onboarding",
    "PATCH",
    {
      desiredSalaryMin: 2000.25,
      desiredSalaryCurrency: "USD",
      desiredSalaryPeriod: "MONTHLY",
      salaryNegotiable: true,
      step: 4,
    },
    session,
  );
  await request(
    "/profiles/me/onboarding",
    "PATCH",
    {
      fullName: "Jane Doe Test",
      residenceCountryId: country.id,
      visibility: "PRIVATE",
      step: 5,
    },
    session,
  );
  const progress = await request(
    "/profiles/me/onboarding",
    "GET",
    null,
    session,
  );
  assert.equal(progress.step, 5);
  assert.equal(progress.profile.desiredSalaryMin, 2000.25);
  assert.equal(progress.profile.desiredPosition, "Frontend Developer");
  const login = await request(
    "/auth/login",
    "POST",
    { email: session.user.email, password, expectedRole: "EMPLOYEE" },
    null,
    201,
  );
  assert.equal(login.user.employeeOnboarding.step, 5);
  const file = fs.readFileSync(path.join(cache, "fixtures/employee-cv.pdf"));
  const resume = await upload(session, "employee-cv.pdf", file);
  const result = await parsed(session, resume.id);
  assert.equal(result.parseStatus, "READY", result.parseError);
  assert.equal(
    result.parsedData.phone,
    undefined,
    "Year ranges must not become a phone number",
  );
  assert.ok(
    result.parsedData.experiences.some((e) => /Apex Soft/.test(e.companyName)),
  );
  assert.ok(
    result.parsedData.educations.some(
      (e) => e.school === "National University" && e.endDate === "2019-01-01",
    ),
    "Education must keep the years in the uploaded file",
  );
  let profile = await request("/profiles/me", "GET", null, session);
  assert.equal(
    profile.experiences.length,
    0,
    "Upload must never import automatically",
  );
  const chosen = review(result.parsedData);
  chosen.skills = chosen.skills.filter((s) => s !== "TypeScript");
  chosen.experiences[0].title = "Reviewed Frontend Developer";
  chosen.experiences[0].countryId = country.id;
  const input = {
    resumeId: resume.id,
    resumeGeneration: result.parseGeneration,
    review: chosen,
    reviewState: {
      data: { ...chosen, skills: result.parsedData.skillNames },
      basics: true,
      skills: result.parsedData.skillNames.map((s) => s !== "TypeScript"),
      experiences: chosen.experiences.map(() => true),
      educations: chosen.educations.map(() => true),
      languages: chosen.languages.map(() => true),
    },
    manualExperiences: [
      {
        title: "UI Designer",
        companyName: "Manual Studio",
        startDate: "2020-02-01",
        endDate: "2021-01-01",
        isCurrent: false,
        countryId: country.id,
      },
    ],
  };
  await request("/profiles/me/onboarding", "PATCH", input, session);
  await request(
    "/profiles/me/onboarding/complete",
    "POST",
    {
      ...input,
      resumeGeneration: result.parseGeneration - 1,
      fullName: "Must Roll Back",
    },
    session,
    400,
  );
  assert.equal(
    (await request("/profiles/me/onboarding", "GET", null, session)).profile
      .user.fullName,
    "Jane Doe Test",
    "Failed completion must roll back every profile change",
  );
  const saved = await request("/profiles/me/onboarding", "GET", null, session);
  assert.equal(
    saved.draft.review.experiences[0].title,
    "Reviewed Frontend Developer",
  );
  await request(
    "/profiles/me/onboarding/complete",
    "POST",
    {
      ...input,
      fullName: "Must Roll Back",
      manualExperiences: [
        { title: "Invalid", companyName: "Must not persist", startDate: null },
      ],
    },
    session,
    400,
  );
  const rolledBack = await request(
    "/profiles/me/onboarding",
    "GET",
    null,
    session,
  );
  assert.equal(rolledBack.profile.user.fullName, "Jane Doe Test");
  assert.equal(
    rolledBack.profile.experiences.length,
    0,
    "A late validation failure must roll back the CV import",
  );
  const completed = await request(
    "/profiles/me/onboarding/complete",
    "POST",
    input,
    session,
    201,
  );
  assert.equal(completed.status, "COMPLETED");
  await request(
    "/profiles/me/onboarding",
    "PATCH",
    { desiredPositions: ["Stale tab role"] },
    session,
  );
  await Promise.all([
    request("/profiles/me/onboarding/complete", "POST", input, session, 201),
    request("/profiles/me/onboarding/complete", "POST", input, session, 201),
  ]);
  profile = await request("/profiles/me", "GET", null, session);
  assert.equal(
    profile.experiences.filter((e) => e.companyName === "Manual Studio").length,
    1,
  );
  assert.equal(
    profile.experiences.filter((e) => e.title === "Reviewed Frontend Developer")
      .length,
    1,
  );
  assert.ok(!profile.skills.some((s) => s.skill.name === "TypeScript"));
  assert.equal(profile.desiredSalaryCurrency, "USD");
  assert.equal(profile.phone, null);
  assert.equal(
    profile.desiredPosition,
    "Frontend Developer",
    "A stale wizard must not overwrite a completed profile",
  );
  assert.equal(
    profile.onboardingDraft,
    undefined,
    "Private CV drafts are not part of general profile payloads",
  );
  assert.equal(profile.desiredSalaryMin, 2000.25);
  assert.equal(profile.preferredCountries[0].id, country.id);
  assert.equal(
    profile.experiences.find((e) => e.title === "Reviewed Frontend Developer")
      .country.id,
    country.id,
  );
  await request(
    `/profiles/me/resumes/${resume.id}/import`,
    "POST",
    { ...chosen, resumeGeneration: result.parseGeneration },
    session,
    201,
  );
  const again = await request("/profiles/me", "GET", null, session);
  assert.equal(
    again.experiences.length,
    profile.experiences.length,
    "Repeated CV import must dedupe",
  );
  const me = await request("/auth/me", "GET", null, session);
  assert.equal(me.user.employeeOnboarding.status, "COMPLETED");
  console.log(
    "HTTP onboarding: new account, resume, fractional salary, reviewed import, exclusion, manual experience, replay/dedupe passed",
  );
  const skipped = await register("skip");
  await request(
    "/profiles/me/onboarding/complete",
    "POST",
    {
      desiredPositions: ["Free Text Role"],
      preferredCountryIds: [country.id],
      residenceCountryId: country.id,
      fullName: "No CV Test",
      desiredSalaryMin: null,
      noExperience: true,
      step: 5,
    },
    skipped,
    201,
  );
  const noCv = await request("/profiles/me", "GET", null, skipped);
  assert.equal(noCv.desiredSalaryMin, null);
  assert.equal(noCv.experiences.length, 0);
  assert.equal(noCv.noExperience, true);
  console.log("HTTP onboarding: completion without CV or salary passed");
  for (const filename of [
    "employee-cv.docx",
    "employee-cv-scanned.pdf",
    "employee-cv.doc",
  ]) {
    const bytes = fs.readFileSync(
      path.join(cache, "fixtures", filename),
    );
    const cv = await upload(session, filename, bytes),
      status = await parsed(session, cv.id);
    assert.equal(
      status.parseStatus,
      "READY",
      filename + ": " + status.parseError,
    );
    assert.ok(status.parsedData.textPreview.trim());
    assert.ok(
        status.parsedData.experiences.some((e) =>
          /Apex Soft/i.test(e.companyName),
        ),
        filename + " structured experience",
      );
    console.log("HTTP upload/storage/queue/parse: " + filename + " passed");
  }
  const unrelated = await upload(session, 'unrelated.doc', fs.readFileSync(path.resolve('scripts/fixtures/cv/word-extractor-sample.doc')));
  const unrelatedResult = await parsed(session, unrelated.id);
  assert.equal(unrelatedResult.parseStatus, 'FAILED', 'Readable non-CV document is not a successful structured parse');
  console.log('HTTP readable non-CV document rejected without fabricated profile fields');
  const broken = await upload(session, "broken.docx", Buffer.from("broken"));
  const failure = await parsed(session, broken.id);
  assert.equal(failure.parseStatus, "FAILED");
  profile = await request("/profiles/me", "GET", null, session);
  assert.ok(
    profile.resumes.find((r) => r.id === broken.id)?.hasFile,
    "Failed parse keeps the uploaded file",
  );
  console.log("HTTP corrupt CV failure retains file passed");
  await upload(
    skipped,
    "oversized.pdf",
    Buffer.alloc(5 * 1024 * 1024 + 1),
  ).then(
    () => {
      throw Error("Oversized upload accepted");
    },
    (e) => assert.match(e.message, /413|large|size/i),
  );
  console.log("HTTP size limit passed");
  // Keep a fresh isolated fixture account for browser verification; no existing user data changed.
  const ui = await register("ui");
  fs.writeFileSync(
    path.join(cache, "ui-account.json"),
    JSON.stringify({ email: ui.user.email, password }),
  );
  console.log(
    "Fresh local browser fixture ready (credentials stored in ignored cache)",
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
