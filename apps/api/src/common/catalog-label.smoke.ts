import { catalogLabelIssue } from '@job-talentio/shared';
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
expectOk('C++');
expectOk('C#');
expectOk('HTML5');
expectOk('HTTPS');
expectOk('Unit Testing');
expectOk('A/B Testing');
expectOk('R');

expectThrow('fuck');
expectThrow('asdfgh');
expectThrow('xxx');
expectThrow('11111');
expectThrow('aaaa');
expectThrow('test');
expectThrow('testing');

assert(isBlockedCatalogKey(normalizeLookupKey('shit')), 'shit blocked');
assert(isBlockedCatalogKey(normalizeLookupKey('testing')), 'exact testing blocked');
assert(
  !isBlockedCatalogKey(normalizeLookupKey('Unit Testing')),
  'Unit Testing must not inherit the testing block',
);
assert(isGibberishCatalogKey('qwerty', 'qwerty'), 'qwerty gibberish');
assert(!isGibberishCatalogKey('react', 'React'), 'react not gibberish');
assert(!isGibberishCatalogKey('c', 'C++'), 'C++ is not gibberish');
assert(!isGibberishCatalogKey('html5', 'HTML5'), 'HTML5 is not gibberish');

assert(catalogLabelIssue('C++') === null, 'C++ allowed');
assert(catalogLabelIssue('HTML5') === null, 'HTML5 allowed');
assert(catalogLabelIssue('Unit Testing') === null, 'Unit Testing allowed');
assert(catalogLabelIssue('testing') === 'blocked', 'testing blocked');
assert(catalogLabelIssue('11111') === 'gibberish', 'all-digit rejected');

console.log('api: catalog-label guard smoke ok');
