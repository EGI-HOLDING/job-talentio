const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),web=createRequire(path.join(root,'apps/web/package.json')),ts=web('typescript'),React=web('react'),{renderToStaticMarkup}=web('react-dom/server');
const mod={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'apps/web/src/components/employee/MessageBody.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module:mod,exports:mod.exports,URL,window:{location:{origin:'https://jobtalent.io'}},require:web});
const render=text=>renderToStaticMarkup(React.createElement(mod.exports.MessageBody,{text}));
const invitation=render('Buka https://jobtalent.io/id/screening/token-123.');assert.match(invitation,/href="https:\/\/jobtalent.io\/id\/screening\/token-123"/);assert.match(invitation,/>Buka undangan interview<\/a>\./);assert.doesNotMatch(invitation,/target=/);
const external=render('Meeting https://meeting.synthetic.test/session');assert.match(external,/target="_blank"/);assert.match(external,/rel="noopener noreferrer"/);
const hostile=render('<script>alert(1)</script> javascript:alert(1) <img src=x onerror=alert(2)>');assert.doesNotMatch(hostile,/<script|<img|<a /);assert.match(hostile,/&lt;script&gt;/);
console.log('Message body passed: clickable local screening invitations, safe external meeting links, punctuation handling and escaped untrusted text.');
