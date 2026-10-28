const path=require('node:path'),{execFileSync}=require('node:child_process');
const h=require('./lib/hr-demo-env.cjs'),c=h.config({realAuth:true});h.assertDemoUrl(c.databaseUrl);
const target=process.argv[2]||'web';if(!['web','admin'].includes(target))throw Error('Unknown build target');
const build=process.argv[3]||'.next-package-readiness';if(!/^\.next-[a-z0-9-]+$/.test(build))throw Error('Invalid build directory');
execFileSync(process.execPath,[require.resolve('next/dist/bin/next',{paths:[path.join(h.repo,'apps',target)]}),'build'],{
  cwd:path.join(h.repo,'apps',target),env:{...c.env,NODE_ENV:'production',NEXT_BUILD_DIR:build},windowsHide:true,stdio:'inherit',timeout:240000,
});
