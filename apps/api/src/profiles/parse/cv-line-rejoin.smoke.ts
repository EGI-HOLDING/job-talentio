import { rejoinWrappedCvLines } from './cv-line-rejoin';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const WRAPPED_DUTIES = `
IT Infrastructure & Support Specialist
Acme
Jan 2023 – Dec 2024
• Manage and maintain IT infrastructure supporting 150+ users
• Configure and troubleshoot managed switches LAN connectivity.
• Provide Level 1 and Level 2 support for Windows workstations, printers, POS devices, IP phones, and operational
systems.
IT Support Engineer
Jan 2022 – Present
`;

function rejoinsNonBulletContinuation() {
  const out = rejoinWrappedCvLines(WRAPPED_DUTIES);
  assert(/operational systems\./i.test(out), `wrap not joined:\n${out}`);
  assert(
    !/operational\nsystems\./i.test(out),
    `continuation still on its own line:\n${out}`,
  );
}

function keepsNextRoleTitleSeparate() {
  const out = rejoinWrappedCvLines(WRAPPED_DUTIES);
  const dutyLine = out.split('\n').find((l) => /operational systems/i.test(l)) || '';
  assert(
    !/IT Support Engineer/i.test(dutyLine),
    `next title glued onto previous sentence:\n${out}`,
  );
  assert(/\nIT Support Engineer\n/i.test(out), `next title lost as its own line:\n${out}`);
}

function keepsLevelTwoBullet() {
  const out = rejoinWrappedCvLines(WRAPPED_DUTIES);
  assert(/Level 1 and Level 2 support/i.test(out), 'Level 1/2 bullet dropped');
}

function joinsHyphenWrap() {
  const out = rejoinWrappedCvLines('opera-\ntional systems.');
  assert(out === 'operational systems.', `hyphen wrap got: ${JSON.stringify(out)}`);
}

function doesNotJoinAcrossBlankLine() {
  const out = rejoinWrappedCvLines('First clause\n\nsecond paragraph.');
  assert(out.includes('\n\n') || out.split('\n').length >= 2, `blank join lost:\n${out}`);
  assert(!/^First clause second paragraph/.test(out), `joined across blank:\n${out}`);
}

async function main() {
  rejoinsNonBulletContinuation();
  keepsNextRoleTitleSeparate();
  keepsLevelTwoBullet();
  joinsHyphenWrap();
  doesNotJoinAcrossBlankLine();
  console.log('api: cv-line-rejoin smoke ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
