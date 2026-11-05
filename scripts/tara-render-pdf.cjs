const {createRequire}=require('node:module'),{pathToFileURL}=require('node:url'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const req=createRequire(path.resolve('apps/api/package.json'));
(async()=>{const canvas=req('@napi-rs/canvas');Object.assign(globalThis,{DOMMatrix:canvas.DOMMatrix,ImageData:canvas.ImageData,Path2D:canvas.Path2D});
const pdfjs=await import(pathToFileURL(req.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);fs.mkdirSync('tmp/tara-pdf',{recursive:true});
for(const file of process.argv.slice(2)){const doc=await pdfjs.getDocument({data:new Uint8Array(fs.readFileSync(file)),useSystemFonts:true,isEvalSupported:false}).promise;assert.equal(doc.numPages,2);for(let i=1;i<=doc.numPages;i++){const page=await doc.getPage(i),viewport=page.getViewport({scale:1.5}),c=canvas.createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));await page.render({canvasContext:c.getContext('2d'),viewport,canvas:c}).promise;fs.writeFileSync('tmp/tara-pdf/'+path.basename(file,'.pdf')+'-'+i+'.png',c.toBuffer('image/png'));}console.log(file,': two pages rendered');}
})().catch(e=>{console.error(e);process.exitCode=1;});
