// Runs the actual game simulation without a browser; does not change game settings.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const base=fs.readFileSync(path.join(__dirname,'../exploration.js'),'utf8');
function run(range,margin){
  const elements=new Map();
  const ctx=new Proxy({}, {get:()=>()=>{}});
  function element(id){if(!elements.has(id))elements.set(id,{value:({mission:10,turnRate:45,scanDelay:.6,fogSpeed:60,fogGrace:2})[id],checked:true,style:{},firstElementChild:{style:{}},checkValidity:()=>true,setAttribute(){},addEventListener(){},getContext:()=>ctx,getBoundingClientRect:()=>({width:1200,height:800})});return elements.get(id);}
  const sandbox={document:{getElementById:element,addEventListener(){}},window:{addEventListener(){}},devicePixelRatio:1,ResizeObserver:class{observe(){}},requestAnimationFrame(){},Date,Math,Set};
  const source=base.replace('SCAN_RANGE = 120',`SCAN_RANGE = ${range}`).replace('saveRecord(latestRecord);',';').replace('new ResizeObserver(resize)','globalThis.test={start,update,keys,get state(){return state},get record(){return latestRecord}};new ResizeObserver(resize)');
  vm.runInNewContext(source,sandbox);const t=sandbox.test;t.start();t.state.traps=[];
  let mode='scan',target=0,scans=0;
  while(t.state.running && t.state.time<120){
    if(mode==='scan' && t.state.scanning && t.state.stillTime>=.6){
      scans++;target=Math.max(16,t.state.y-range+margin);t.keys.add('w');t.keys.add('space');mode='run';
    }else if(mode==='run' && t.state.y<=target){t.keys.clear();mode='scan';}
    t.update(1/120);
  }
  return {range,margin,reason:t.record?.reason,time:+t.state.time.toFixed(2),health:t.state.health,fogHits:t.state.fog.damageEvents.length,scans,remainingDistance:Math.round(t.state.y-16)};
}
const results=[];for(const margin of [16,32])for(const range of [190,120])results.push(run(range,margin));
console.log(JSON.stringify({scenario:'10-section empty corridor; scan to full range, sprint forward, stop and repeat; same actual physics and fog',results},null,2));
// Replay counterfactual: same recorded movements, shortened beam, retained observed cells.
const downloads=path.join(process.env.USERPROFILE,'Downloads');
const records=fs.readdirSync(downloads).filter(n=>/^scout-stride-exploration.*\.json$/.test(n)).map(n=>({name:n,time:fs.statSync(path.join(downloads,n)).mtimeMs})).sort((a,b)=>b.time-a.time);
if(records.length){
  const r=JSON.parse(fs.readFileSync(path.join(downloads,records[0].name),'utf8'));
  function coverage(range){
    const cells=new Set();let total=0,unknown=0;const width=r.map.width,cols=width/8;
    for(let i=0;i<r.trajectory.length;i++){
      const p=r.trajectory[i],q=r.trajectory[Math.max(0,i-1)],near=p.nearRadius??48;
      const scan=p.scanning?Math.min(range,p.scanRange??range):near,back=24;
      const ox=p.x-Math.cos(p.angle)*back,oy=p.y-Math.sin(p.angle)*back;
      const visible=(x,y)=>Math.hypot(x-p.x,y-p.y)<=near || (p.scanning && (x-p.x)*Math.cos(p.angle)+(y-p.y)*Math.sin(p.angle)>=0 && Math.hypot(x-ox,y-oy)<=scan+back && Math.abs(Math.atan2(Math.sin(Math.atan2(y-oy,x-ox)-p.angle),Math.cos(Math.atan2(y-oy,x-ox)-p.angle)))<=Math.PI/6);
      const distance=Math.hypot(p.x-q.x,p.y-q.y);total+=distance;
      if(!cells.has(Math.floor(p.y/8)*cols+Math.floor(p.x/8)))unknown+=distance;
      if(!p.scanning)continue;
      for(let row=Math.max(0,Math.floor((p.y-scan-back)/8));row<Math.min(r.map.height/8,Math.ceil((p.y+scan+back)/8));row++)for(let col=Math.max(0,Math.floor((p.x-scan-back)/8));col<Math.min(cols,Math.ceil((p.x+scan+back)/8));col++){
        const key=row*cols+col;if(cells.has(key))continue;
        if([[0,0],[8,0],[0,8],[8,8]].every(([dx,dy])=>visible(col*8+dx,row*8+dy)))cells.add(key);
      }
    }
    return {range,notScannedDistance:+unknown.toFixed(1),notScannedPercent:+(100*unknown/total).toFixed(1)};
  }
  console.log(JSON.stringify({replay:records[0].name,note:'Same trajectory, distance outside areas observed while stationary; not a new human playthrough',coverage:[coverage(190),coverage(120)]},null,2));
}

