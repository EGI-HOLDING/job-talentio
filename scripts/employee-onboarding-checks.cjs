const fs = require("node:fs"),
  path = require("node:path"),
  { spawnSync } = require("node:child_process");
const repo = path.resolve(__dirname, ".."),
  api = path.join(repo, "apps/api"),
  cli = path.join(api, "node_modules/tsx/dist/cli.mjs");
const script = JSON.parse(
  fs.readFileSync(path.join(api, "package.json"), "utf8"),
).scripts.test;
const files = [...script.matchAll(/tsx ([^ &]+\.smoke\.ts)/g)].map((m) => m[1]);
let failed = 0;
const inline = script.match(/^tsx -e "([\s\S]*?)" && /)?.[1];
if (inline) {
  const run = spawnSync(process.execPath, [cli, '-e', inline], { cwd: api, encoding: 'utf8', windowsHide: true, timeout: 60000 });
  console.log(`${run.status === 0 ? 'PASS' : 'FAIL'} title normalization inline smoke`);
  if (run.status !== 0) { failed++; console.log(run.stdout); console.error(run.stderr); }
}
for (const file of files) {
  const run = spawnSync(process.execPath, [cli, file], {
    cwd: api,
    encoding: "utf8",
    windowsHide: true,
    timeout: 60000,
  });
  console.log(`${run.status === 0 ? "PASS" : "FAIL"} ${file}`);
  if (run.status !== 0) {
    failed++;
    console.log(run.stdout);
    console.error(run.stderr);
  }
}
const total = files.length + (inline ? 1 : 0);
console.log(`${total - failed}/${total} API smoke checks passed`);
if (failed) process.exitCode = 1;
