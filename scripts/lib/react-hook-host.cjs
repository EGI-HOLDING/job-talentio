// Executes actual client components without a browser session or business data.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'../..'),web=createRequire(path.join(root,'apps/web/package.json'));
const ts=web('typescript'),React=web('react');
function host(file,name,dependencies,globals={}){
  let cursor=0,dirty=true,tree,props;const cells=[],effects=[],timers=new Map();let timerId=0;
  const equal=(a,b)=>Boolean(a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index])));
  const hooks={...React,useState(initial){const index=cursor++;if(!cells[index])cells[index]={value:typeof initial==='function'?initial():initial,set(value){const next=typeof value==='function'?value(cells[index].value):value;if(!Object.is(next,cells[index].value)){cells[index].value=next;dirty=true;}}};return[cells[index].value,cells[index].set];},useRef(initial){const index=cursor++;return(cells[index]||={current:initial});},useMemo(fn,deps){const index=cursor++;if(!cells[index]||!equal(cells[index].deps,deps))cells[index]={deps,value:fn()};return cells[index].value;},useCallback(fn,deps){return hooks.useMemo(()=>fn,deps);},useEffect(fn,deps){const index=cursor++,old=cells[index];if(!old||!equal(old.deps,deps))effects.push(()=>{old?.cleanup?.();cells[index]={deps,cleanup:fn()};});}};
  hooks.useId=()=>{const index=cursor++;return(cells[index]||={value:'test-id-'+index}).value;};
  const module={exports:{}};
  const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,URL,URLSearchParams,AbortController,process:{env:{}},requestAnimationFrame(fn){return setImmediate(()=>fn(Date.now()));},cancelAnimationFrame:clearImmediate,setTimeout(fn,delay){timers.set(++timerId,{fn,delay});return timerId;},clearTimeout(id){timers.delete(id);},setInterval(){return 1;},clearInterval(){},...globals,require(name){if(name==='react')return hooks;if(name==='react/jsx-runtime')return web(name);if(name in dependencies)return dependencies[name];if(name.endsWith('.css'))return new Proxy({},{get:(_,key)=>String(key)});throw Error('Unexpected component dependency: '+name);}},{filename:file});
  return {async render(next=props){props=next;dirty=true;for(let i=0;i<30;i++){if(dirty){dirty=false;cursor=0;tree=module.exports[name](props);globals.attachRefs?.(tree);}effects.splice(0).forEach(fn=>fn());await new Promise(resolve=>setImmediate(resolve));if(!dirty&&!effects.length)return tree;}throw Error('Component did not settle');},fireTimers(){const queued=[...timers.values()];timers.clear();queued.forEach(timer=>timer.fn());},unmount(){cells.forEach(cell=>cell?.cleanup?.());timers.clear();}};
}
function nodes(tree,predicate){if(Array.isArray(tree))return tree.flatMap(node=>nodes(node,predicate));if(!tree||typeof tree!=='object')return[];return[...(predicate(tree)?[tree]:[]),...nodes(tree.props?.children,predicate)];}
function text(tree){if(Array.isArray(tree))return tree.map(text).join(' ');if(typeof tree==='string'||typeof tree==='number')return String(tree);return tree&&typeof tree==='object'?text(tree.props?.children):'';}
module.exports={host,nodes,text};
