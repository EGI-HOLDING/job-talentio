// Operational transport only. Database writes remain guarded by catalog-sync.ts.
// Private artifacts belong under .catalog-sync-private, never in a PR/image.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const project = 'f17bda5e-5f0c-4fd2-8fa9-25d568190f54';
const environment = 'staging';
const railway = process.platform === 'win32'
  ? path.join(process.env.APPDATA, 'npm/node_modules/@railway/cli/bin/railway.exe') : 'railway';
const identity = process.env.CATALOG_SYNC_SSH_KEY || path.join(process.env.USERPROFILE || process.env.HOME, '.ssh/id_ed25519_egi_holding_it');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function remote(code, input, service = 'api-stage-job-talentio') {
  const encoded = Buffer.from(code).toString('base64');
  const command = `cd /app/apps/api && node -e 'eval(Buffer.from("${encoded}","base64").toString())'`;
  try {
    return execFileSync(railway, ['ssh', '--project', project, '--environment', environment, '--service', service, '--identity-file', identity, command],
      { input, encoding: 'utf8', maxBuffer: 100 * 1024 * 1024, timeout: 180000, windowsHide: true });
  } catch (error) {
    // Never dump stdout: it may contain a database backup or a catalog snapshot.
    throw new Error('Railway SSH operation failed: ' + String(error.stderr || error.message).slice(0, 1500));
  }
}

function privateWrite(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
}

if (require.main === module) {
  const [operation, file, argument] = process.argv.slice(2);
  if (operation === 'upload') {
    if (!/^\/tmp\/talentio-catalog-sync\/[a-zA-Z0-9._-]+$/.test(argument || '')) throw Error('Invalid remote artifact path');
    const bytes = fs.readFileSync(file);
    const output = remote(`const fs=require('node:fs'),crypto=require('node:crypto');const bytes=fs.readFileSync(0);fs.mkdirSync('/tmp/talentio-catalog-sync',{recursive:true,mode:0o700});fs.writeFileSync(${JSON.stringify(argument)},bytes,{flag:'wx',mode:0o600});console.log(JSON.stringify({bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}));`, bytes);
    console.log(output.trim());
  } else if (operation === 'download') {
    if (!/^\/tmp\/talentio-catalog-sync\/[a-zA-Z0-9._-]+$/.test(argument || '')) throw Error('Invalid remote artifact path');
    const encoded = remote(`console.log(require('node:fs').readFileSync(${JSON.stringify(argument)}).toString('base64'));`).trim();
    const bytes = Buffer.from(encoded, 'base64'); privateWrite(file, bytes);
    console.log(JSON.stringify({ operation, bytes: bytes.length, sha256: digest(bytes) }));
  } else if (operation === 'exec') {
    // The file is an operator-authored JS script; it is not a shell command.
    console.log(remote(fs.readFileSync(file, 'utf8')).trim());
  } else throw Error('Usage: catalog-sync-railway upload|download <local-file> <remote-path>, or exec <local-js>');
}
module.exports = { remote, privateWrite, project, environment };
