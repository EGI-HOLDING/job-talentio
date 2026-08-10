import { assertCatalogLabel, isGibberishCatalogKey, normalizeLookupKey } from './lookup-normalize';
import { isBlockedCatalogKey } from './catalog-blocklist';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function expectThrow(name: string) {
  let threw = false;
  try {
    assertCatalogLabel(name);
  } catch {
    threw = true;
  }
  assert(threw, `expected reject: ${name}`);
}

function expectOk(name: string) {
  assertCatalogLabel(name);
}

expectOk('React');
expectOk('Node.js');
expectOk('Ozbek');
expectOk('Full-stack Developer');

expectThrow('fuck');
expectThrow('asdfgh');
expectThrow('xxx');
expectThrow('11111');
expectThrow('aaaa');

assert(isBlockedCatalogKey(normalizeLookupKey('shit')), 'shit blocked');
assert(isGibberishCatalogKey('qwerty', 'qwerty'), 'qwerty gibberish');
assert(!isGibberishCatalogKey('react', 'React'), 'react not gibberish');

console.log('api: catalog-label guard smoke ok');
