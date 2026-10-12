const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const elements=new Map(),listeners=new Map();
const ctx=new Proxy({createRadialGradient:()=>({addColorStop(){}}),createLinearGradient:()=>({addColorStop(){}})}, {get:(target,key)=>target[key]??(()=>{})});
function element(id){if(!elements.has(id))elements.set(id,{value:({mission:10,turnRate:45,scanDelay:.6,fogSpeed:60,fogGrace:2})[id],checked:true,style:{},firstElementChild:{style:{}},checkValidity:()=>true,setAttribute(){},addEventListener(type,fn){listeners.set('canvas:'+type,fn)},getContext:()=>ctx,getBoundingClientRect:()=>({width:1200,height:800,left:0,top:0})});return elements.get(id);}
const sandbox={document:{getElementById:element,addEventListener(){}},window:{addEventListener(type,fn){listeners.set(type,fn)}},devicePixelRatio:1,ResizeObserver:class{observe(){}},requestAnimationFrame(){},Date,Math,Set};
let source=fs.readFileSync(require('node:path').join(__dirname,'../exploration.js'),'utf8').replace('new ResizeObserver(resize)','globalThis.test={start,update,draw,visible,updateFog,keys,get state(){return state}};new ResizeObserver(resize)');
vm.runInNewContext(source,sandbox);const t=sandbox.test;t.start();t.state.traps=[];t.state.y=1000;
for(let i=0;i<72;i++)t.update(1/120);
assert.equal(t.state.scanning,true);assert.equal(t.state.scanRange,120);
assert(t.visible(112,890));assert(!t.visible(210,1000),'side outside near view stays unknown');
assert(t.visible(160,940),'modest rear origin widens nearby right view');
assert(t.visible(64,940),'modest rear origin widens nearby left view');
assert(!t.visible(112,1060),'extra beam does not illuminate behind player');
assert(!t.visible(112,875),'forward reach remains limited to 120');
const count=t.state.known.size;assert(count>0);
listeners.get('canvas:pointermove')({clientX:1000,clientY:400});
const before=t.state.angle;t.update(.05);
assert(Math.abs(t.state.angle-before)<=45*Math.PI/180*.05+1e-10,'rotation respects rate cap');
assert(t.state.turnSpeed>0 && t.state.turnSpeed<45*Math.PI/180*.1,'rotation starts slowly');
for(let i=0;i<90;i++)t.update(1/120);
assert(Math.abs(t.state.turnSpeed-45*Math.PI/180)<1e-9,'sustained turn reaches speed cap');
t.keys.add('w');t.update(1/120);assert.equal(t.state.scanning,false);assert.equal(t.state.stillTime,0);assert(t.state.known.size>=count,'observations persist');
assert(!t.visible(112,t.state.y-150),'movement disables extended cone');t.draw();
assert(t.state.path.at(-1).angle!==undefined);assert(t.state.observations.length>0);
assert(t.state.nearRadius>32 && t.state.nearRadius<=48,'peripheral view uses intermediate range');
t.keys.clear();t.state.vx=0;t.state.vy=0;t.state.x=112;t.state.y=1000;
// Center pointer prevents an additional turn during movement checks.
listeners.get('canvas:pointermove')({clientX:600,clientY:400});
t.state.angle=0;t.keys.add('w');t.update(.05);
assert(t.state.vx>0 && Math.abs(t.state.vy)<1e-9,'W follows gaze to the right');
t.keys.clear();t.state.vx=0;t.state.vy=0;t.state.x=112;
t.keys.add('d');t.update(.05);
assert(t.state.vy>0 && Math.abs(t.state.vx)<1e-9,'D strafes right relative to gaze');
t.state.health=5;t.state.time=1;t.state.y=t.state.height-24;t.updateFog(.1,t.state.y);
assert.equal(t.state.fog.frontY,t.state.height,'fog waits before starting');
t.state.time=3;t.updateFog(.1,t.state.y);
assert.equal(t.state.fog.frontY,t.state.height-60,'fog advances from map rear');
t.state.fog.exposure=0;t.state.y=t.state.fog.frontY+10;
for(let i=0;i<19;i++){t.state.time+=.1;t.updateFog(.1,t.state.y);}
assert.equal(t.state.health,5,'short exposure does not damage');
t.state.time+=.1;t.updateFog(.1,t.state.y);assert.equal(t.state.health,4,'threshold damages once');
for(let i=0;i<20;i++){t.state.time+=.1;t.updateFog(.1,t.state.y);}
assert.equal(t.state.health,3,'continued exposure repeats damage');
t.state.y=t.state.fog.frontY-100;t.state.time+=.1;t.updateFog(.1,t.state.y);
assert.equal(t.state.fog.exposure,0,'escaping resets exposure');assert.equal(t.state.fog.inside,false);
assert.equal(t.state.fog.damageEvents.length,2,'fog damage is recorded separately');t.draw();
console.log('PASS: exploration, gaze movement, turn acceleration, fog pursuit, timed damage and exposure reset');



