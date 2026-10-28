const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  { createRequire } = require("node:module");
const repo = path.resolve(__dirname, ".."),
  ts = createRequire(path.join(repo, "apps/web/package.json"))("typescript");
let session;
function loadNavigationModule(name) {
  const target = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(repo, 'apps/web/src/lib', name + '.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    module: target, exports: target.exports, URL, URLSearchParams,
    require: (dependency) => loadNavigationModule(dependency.replace('./', '')),
  });
  return target.exports;
}
const moduleObject = { exports: {} };
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync(path.join(repo, "apps/web/src/lib/authReturn.ts"), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText,
  {
    module: moduleObject,
    exports: moduleObject.exports,
    URL,
    URLSearchParams,
    window: {
      location: {
        pathname: "/id/login",
        search: "?next=%2Fjobs%2Fsafe-job%3Fapply%3Dtrue",
      },
    },
    require: (name) => name === './api' ? { getSession: () => session } : loadNavigationModule(name.replace('./', '')),
  },
);
const { authDestination, safeAuthNext } = moduleObject.exports;
for (const status of ["IN_PROGRESS", "COMPLETED", "NOT_REQUIRED"]) {
  session = {
    user: { role: "EMPLOYEE", employeeOnboarding: { status, step: 3 } },
  };
  assert.equal(
    authDestination("/dashboard/employee"),
    status === "IN_PROGRESS"
      ? "/onboarding/employee?next=%2Fjobs%2Fsafe-job%3Fapply%3Dtrue"
      : "/jobs/safe-job?apply=true",
  );
}
session = { user: { role: "RECRUITER" } };
assert.equal(
  authDestination("/dashboard/recruiter"),
  "/jobs/safe-job?apply=true",
);
session = {user: {role: 'RECRUITER', recruiterOnboarding: {status: 'IN_PROGRESS', step: 1}}};
assert.equal(authDestination('/dashboard/recruiter'), '/onboarding/recruiter?next=%2Fjobs%2Fsafe-job%3Fapply%3Dtrue');
session = {user: {role: 'RECRUITER', recruiterOnboarding: {status: 'COMPLETE', step: 3}}};
assert.equal(authDestination('/dashboard/recruiter'), '/jobs/safe-job?apply=true');
for (const invalid of [
  "https://external.test",
  "//external.test",
  "/\\external.test",
  "/id/onboarding/employee",
  "/en/login",
  "/foo\u0000bar",
])
  assert.equal(safeAuthNext(invalid), null);
for (const locale of ["id", "en", "ru", "uz"])
  assert.equal(
    safeAuthNext(`/${locale}/jobs/123?apply=true`),
    "/jobs/123?apply=true",
  );
for (const file of [
  "app/[locale]/login/page.tsx",
  "app/[locale]/register/page.tsx",
  "components/auth/GoogleSignIn.tsx",
  "components/auth/TelegramSignIn.tsx",
  "components/auth/PhoneSignIn.tsx",
])
  assert.match(
    fs.readFileSync(path.join(repo, "apps/web/src", file), "utf8"),
    /authDestination\(/,
    file + " must share the post-login resolver",
  );
console.log(
  "Auth destination: all login entry points, old/new/completed employee, safe next and four locales passed",
);
