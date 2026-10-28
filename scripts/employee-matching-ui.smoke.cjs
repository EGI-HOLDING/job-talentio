const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const ts=require('../apps/web/node_modules/typescript');
const root=path.resolve(__dirname,'..');
const files=['apps/web/src/app/[locale]/jobs/page.tsx','apps/web/src/app/[locale]/jobs/[id]/JobDetailClient.tsx','apps/web/src/components/home/ForYouJobsSection.tsx',
  ...fs.readdirSync(path.join(root,'apps/web/src/components/employee')).filter(name=>name.endsWith('.tsx')).map(name=>'apps/web/src/components/employee/'+name)];
for(const file of files){
  const text=fs.readFileSync(path.join(root,file),'utf8');
  assert.ok(!/import[^;]*(?:MatchRing|MatchBreakdownPanel)/s.test(text),`${file}: numeric matching component imported`);
  assert.ok(!/MatchInsightsPanel|match-insights|workspace\.whyMatch/.test(text),`${file}: employee matching explanations should not be rendered`);
  const tree=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  function visit(node){
    if(ts.isJsxExpression(node)&&node.expression)assert.ok(!/\b(?:matchScore|matchBreakdown|viewerMatchScore)\b/.test(node.expression.getText(tree)),`${file}: numeric matching JSX expression`);
    ts.forEachChild(node,visit);
  }
  visit(tree);
}
const applications=fs.readFileSync(path.join(root,'apps/web/src/components/employee/ApplicationsWorkspace.tsx'),'utf8');
assert.ok(!applications.includes('/match-insights'),'application details should not fetch matching explanations');
assert.ok(!fs.existsSync(path.join(root,'apps/web/src/components/ui/MatchInsightsPanel.tsx')),'employee matching explanation panel should be removed');
const catalog=fs.readFileSync(path.join(root,'apps/admin/src/app/catalog/page.tsx'),'utf8');
assert.ok(catalog.includes('<OccupationMatchingEditor'),'admin references must be editable');
console.log(`Employee matching UI passed: ${files.length} surfaces, no score or explanation panels; Admin matching metadata editor remains wired.`);
