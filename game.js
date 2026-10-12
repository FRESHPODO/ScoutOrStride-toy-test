(() => {
  'use strict';
  const PLAYER_DIAMETER = 32, RADIUS = PLAYER_DIAMETER / 2;
  const WIDTH = PLAYER_DIAMETER * 7, UNIT_HEIGHT = WIDTH;
  const HEALTH = 5, SLOW_WALK_SPEED = 30, WALK_SPEED = 65, SPEED = 110, TRAPS_PER_UNIT = 3, TRAP_RADIUS = 11;
  const BASE_ACCELERATION = 220, START_ACCELERATION_BOOST = 420, BRAKING = 840;
  const IDLE_VIEW_DIAMETERS = 4, RUN_VIEW_DIAMETERS = 2.75;
  const SPAWN_SAFE_RADIUS = PLAYER_DIAMETER * 2;
  const BEHAVIOR_WINDOW = 1.5, FORWARD_DISTANCE_RATIO = 0.9;
  const MIN_FORWARD_SPEED = PLAYER_DIAMETER, MIN_MOVING_TIME_RATIO = 0.85;
  // Preserve the previous walking view (4 -> 3 across speeds 0 -> 110).
  const WALK_VIEW_DIAMETERS = IDLE_VIEW_DIAMETERS-WALK_SPEED/SPEED;
  const $ = id => document.getElementById(id);
  const canvas = $('game'), ctx = canvas.getContext('2d');
  const keys = new Set();
  let state = null, latestRecord = null, lastFrame = null, viewWidth = 0, viewHeight = 0;
  let replay = null;
  function resize() {
    const rect = canvas.getBoundingClientRect();
    viewWidth = rect.width; viewHeight = rect.height;
    canvas.width = Math.round(viewWidth * devicePixelRatio);
    canvas.height = Math.round(viewHeight * devicePixelRatio);
  }
  function saveRecord(record) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], {type:'application/json'}));
    const link = document.createElement('a');
    link.href = url; link.download = `scout-stride-${record.startedAt.replace(/[:.]/g, '-')}.json`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function finish(reason) {
    if (!state || !state.running) return;
    state.running = false; keys.clear();
    latestRecord = {
      version:1, startedAt:state.startedAt, endedAt:new Date().toISOString(), reason,
      missionUnits:state.units, remainingHealth:state.health,
      touchedTrapCount:state.touched.size, touchedTrapIds:[...state.touched],
      durationSeconds:state.time, distance:state.distance,
      vision:{idleDiameters:IDLE_VIEW_DIAMETERS,walkDiameters:WALK_VIEW_DIAMETERS,runDiameters:RUN_VIEW_DIAMETERS,walkSpeed:WALK_SPEED,runSpeed:SPEED},
      map:{width:WIDTH,height:state.height,unitHeight:UNIT_HEIGHT,playerDiameter:PLAYER_DIAMETER,trapsPerUnit:TRAPS_PER_UNIT,traps:state.traps},
      coordinates:'continuous world units; origin top-left; +y points down; start at bottom, exit at top',
      trajectory:state.path, inputEvents:state.inputs
    };
    $('download').disabled = false;
    $('resultTitle').textContent = reason === 'completed' ? '미션 완료' : reason === 'health_depleted' ? '체력 소진' : '초기화';
    $('resultText').textContent = `남은 체력 ${state.health} / 닿은 함정 ${state.touched.size}개 / 이동 거리 ${state.distance.toFixed(1)}. 플레이 기록을 JSON 파일로 저장했습니다.`;
    $('overlayStart').textContent = '다시 시작 (Enter)'; $('overlay').hidden = false;
    saveRecord(latestRecord);
  }
  function start() {
    const units = Number($('mission').value);
    if (!Number.isInteger(units) || units < 1 || units > 100) { $('mission').reportValidity(); return; }
    if (state?.running) finish('reset');
    replay=null;$('replayControls').hidden=true;$('replayBehavior').hidden=true;$('moveInstructions').hidden=false;
    keys.clear();
    const traps = [];
    const spawnX=WIDTH/2,spawnY=units*UNIT_HEIGHT-RADIUS-8;
    for (let i = 0; i < units; i++) {
      for (let j = 0; j < TRAPS_PER_UNIT; j++) {
        // Keep the final unit's traps above a full-width safe starting area.
        const safeBandOffset=i===units-1 ? 12 : 70;
        const bandSpacing=i===units-1 ? 45 : 55;
        const trap={id:`${units-i}-${j+1}`,x:RADIUS + TRAP_RADIUS + Math.random()*(WIDTH-2*(RADIUS+TRAP_RADIUS)),y:i*UNIT_HEIGHT+safeBandOffset+j*bandSpacing+Math.random()*16,radius:TRAP_RADIUS};
        // Guarantee a clear gap even if the placement bands are changed later.
        const clearance=SPAWN_SAFE_RADIUS+TRAP_RADIUS;
        if(Math.hypot(trap.x-spawnX,trap.y-spawnY)<clearance)trap.y=spawnY-clearance;
        traps.push(trap);
      }
    }
    state = {running:true, units,height:units*UNIT_HEIGHT,x:WIDTH/2,y:spawnY,vx:0,vy:0,actualSpeed:0,health:HEALTH,traps,touched:new Set(),time:0,distance:0,startedAt:new Date().toISOString(),path:[{t:0,x:WIDTH/2,y:spawnY,health:HEALTH}],inputs:[]};
    $('overlay').hidden = true; $('start').textContent = '다시 시작'; lastFrame = null;
    updateHud();
  }
  function updateHud() {
    if (!state) return;
    const segment = Math.min(state.units, state.units-Math.floor(state.y/UNIT_HEIGHT));
    const progress=Math.max(0,Math.min(1,(state.height-RADIUS-8-state.y)/(state.height-2*RADIUS-8)));
    $('hearts').textContent = '♥'.repeat(state.health)+'♡'.repeat(HEALTH-state.health);
    $('hearts').setAttribute('aria-label',`체력 ${state.health}`);
    $('segment').textContent = `${segment} / ${state.units}`;
    $('position').textContent = `${Math.round(progress*100)}% · ${replay ? (replay.playing?'리플레이 재생':'리플레이 정지') : state.running?'탐험 중':'종료'}`;
    $('hits').textContent = state.touched.size;
    $('distance').textContent = state.distance.toFixed(1);
    $('elapsed').textContent = `${String(Math.floor(state.time/60)).padStart(2,'0')}:${String(Math.floor(state.time%60)).padStart(2,'0')}`;
    $('progress').firstElementChild.style.width = `${progress*100}%`;
  }
  function update(dt) {
    if(replay){if(replay.playing)seekReplay(Math.min(replay.duration,replay.time+dt*Number($('replayRate').value)));return;}
    if (!state?.running) return;
    state.time += dt;
    let dx = Number(keys.has('d') || keys.has('arrowright'))-Number(keys.has('a') || keys.has('arrowleft'));
    let dy = Number(keys.has('s') || keys.has('arrowdown'))-Number(keys.has('w') || keys.has('arrowup'));
    const length = Math.hypot(dx,dy);
    if (length) {dx/=length;dy/=length;}
    const slowWalking=keys.has('shiftleft') || keys.has('shiftright') || keys.has('shift');
    const speedLimit=slowWalking ? SLOW_WALK_SPEED : keys.has('space') ? SPEED : WALK_SPEED;
    const targetX=dx*speedLimit,targetY=dy*speedLimit;
    const deltaX=targetX-state.vx,deltaY=targetY-state.vy;
    const deltaSpeed=Math.hypot(deltaX,deltaY);
    // Strong initial response, easing toward the speed cap; braking stays faster.
    const speedRatio=Math.min(1,Math.hypot(state.vx,state.vy)/SPEED);
    const acceleration=BASE_ACCELERATION+START_ACCELERATION_BOOST*(1-speedRatio)**2;
    const slowingDown=Math.hypot(state.vx,state.vy)>speedLimit;
    const maxChange=(length && !slowingDown ? acceleration : BRAKING)*dt;
    if(deltaSpeed<=maxChange){state.vx=targetX;state.vy=targetY;}
    else{state.vx+=deltaX/deltaSpeed*maxChange;state.vy+=deltaY/deltaSpeed*maxChange;}
    const oldX=state.x,oldY=state.y;
    const nextX=state.x+state.vx*dt,nextY=state.y+state.vy*dt;
    state.x = Math.max(RADIUS,Math.min(WIDTH-RADIUS,nextX));
    state.y = Math.max(RADIUS,Math.min(state.height-RADIUS,nextY));
    if(state.x!==nextX)state.vx=0;
    if(state.y!==nextY)state.vy=0;
    state.actualSpeed=Math.hypot(state.x-oldX,state.y-oldY)/dt;
    state.distance += Math.hypot(state.x-oldX,state.y-oldY);
    for (const trap of state.traps) {
      if (!state.touched.has(trap.id) && Math.hypot(state.x-trap.x,state.y-trap.y) <= RADIUS+trap.radius) {
        state.touched.add(trap.id); state.health--; state.flashUntil=state.time+0.2;
        if (state.health===0) break;
      }
    }
    // Record every simulated frame, including idle time, with unrounded coordinates.
    state.path.push({t:state.time,x:state.x,y:state.y,health:state.health});
    if (state.health <= 0) finish('health_depleted');
    else if (state.y <= RADIUS) finish('completed');
    updateHud();
  }
  function draw() {
    if(replay)updateReplayBehavior();
    ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);
    ctx.fillStyle='#151719';ctx.fillRect(0,0,viewWidth,viewHeight);
    const scale=Math.min((viewWidth-100)/WIDTH,1.35), mapWidth=WIDTH*scale, left=(viewWidth-mapWidth)/2;
    const height=state?.height ?? UNIT_HEIGHT*10;
    const x=state?.x ?? WIDTH/2,y=state?.y ?? height-RADIUS-8;
    const visibleHeight=viewHeight/scale;
    const camera=y-visibleHeight/2;
    ctx.save();ctx.translate(left,-camera*scale);ctx.scale(scale,scale);
    ctx.fillStyle='#1b1e20';ctx.fillRect(0,0,WIDTH,height);
    ctx.strokeStyle='#272c2e';ctx.lineWidth=0.6;
    for(let i=Math.max(0,Math.floor(camera/UNIT_HEIGHT));i<=Math.min(Math.ceil(height/UNIT_HEIGHT),Math.ceil((camera+visibleHeight)/UNIT_HEIGHT));i++) {
      ctx.beginPath();ctx.moveTo(0,i*UNIT_HEIGHT);ctx.lineTo(WIDTH,i*UNIT_HEIGHT);ctx.stroke();
    }
    ctx.fillStyle='#78877e';ctx.fillRect(0,0,WIDTH,3);
    if(replay){
      ctx.strokeStyle='#657a6e';ctx.lineWidth=1;ctx.globalAlpha=0.5;ctx.beginPath();
      const path=replay.record.trajectory;
      const stride=Math.max(1,Math.floor(path.length/10000));
      for(let i=0;i<path.length;i+=stride){const p=path[i];if(i===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);}
      const end=path[path.length-1];ctx.lineTo(end.x,end.y);ctx.stroke();ctx.globalAlpha=1;
    }
    const vision=replay?.record.vision ?? {idleDiameters:IDLE_VIEW_DIAMETERS,walkDiameters:WALK_VIEW_DIAMETERS,runDiameters:RUN_VIEW_DIAMETERS,walkSpeed:WALK_SPEED,runSpeed:SPEED};
    const actualSpeed=Math.min(vision.runSpeed,state?.actualSpeed ?? 0);
    const viewDiameters=actualSpeed<=vision.walkSpeed
      ? vision.idleDiameters-(vision.idleDiameters-vision.walkDiameters)*(actualSpeed/vision.walkSpeed)
      : vision.walkDiameters-(vision.walkDiameters-vision.runDiameters)*((actualSpeed-vision.walkSpeed)/(vision.runSpeed-vision.walkSpeed));
    const lightRadius=PLAYER_DIAMETER*viewDiameters/2;
    const glow=ctx.createRadialGradient(x,y,0,x,y,lightRadius);
    glow.addColorStop(0,'#606964');glow.addColorStop(0.55,'#3c4440');glow.addColorStop(1,'#1b1e20');
    ctx.fillStyle=glow;ctx.beginPath();ctx.arc(x,y,lightRadius,0,Math.PI*2);ctx.fill();
    if(replay){ctx.strokeStyle='#afc2b4';ctx.lineWidth=1;ctx.setLineDash([3,3]);ctx.beginPath();ctx.arc(x,y,lightRadius,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);}
    for(const trap of state?.traps ?? []) {
      const d=Math.hypot(x-trap.x,y-trap.y);
      if(!replay && d-trap.radius>=lightRadius) continue;
      if(trap.y+trap.radius<camera || trap.y-trap.radius>camera+visibleHeight)continue;
      ctx.save();
      if(!replay){ctx.beginPath();ctx.arc(x,y,lightRadius,0,Math.PI*2);ctx.clip();
        ctx.globalAlpha=Math.max(0,Math.min(1,(lightRadius-d+trap.radius)/(lightRadius*0.6)));}
      const touched=state.touched.has(trap.id);
      // The outer edge of this disk is the exact trap collision boundary.
      ctx.fillStyle=touched?'#51403c':'#474d49';
      ctx.beginPath();ctx.arc(trap.x,trap.y,trap.radius,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle=touched?'#a47e74':'#b4bcb6';ctx.lineWidth=1.4;
      ctx.beginPath();ctx.arc(trap.x,trap.y,trap.radius-ctx.lineWidth/2,0,Math.PI*2);ctx.stroke();
      ctx.translate(trap.x,trap.y);ctx.scale(trap.radius/15,trap.radius/15);
      ctx.fillStyle=touched?'#bd8178':'#c0c7c2';
      ctx.beginPath();ctx.moveTo(-11,8);ctx.lineTo(-7,-6);ctx.lineTo(-2,2);ctx.lineTo(2,-11);ctx.lineTo(6,2);ctx.lineTo(10,-5);ctx.lineTo(12,8);ctx.closePath();ctx.fill();ctx.restore();
    }
    ctx.fillStyle=state?.flashUntil>state?.time?'#a7837c':'#8b9690';ctx.beginPath();ctx.arc(x,y,RADIUS,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#a1aaa4';ctx.lineWidth=1;ctx.stroke();ctx.fillStyle='#64736a';ctx.beginPath();ctx.arc(x,y+5,3,0,Math.PI*2);ctx.fill();
    ctx.restore();
    // Walls and section numbers stay readable independently of the light.
    const wallTop=Math.max(0,-camera*scale),wallBottom=Math.min(viewHeight,(height-camera)*scale);
    ctx.fillStyle='#343b37';ctx.fillRect(left-8,wallTop,8,wallBottom-wallTop);ctx.fillRect(left+mapWidth,wallTop,8,wallBottom-wallTop);
    ctx.font='12px monospace';ctx.textBaseline='middle';
    for(let i=Math.max(0,Math.floor(camera/UNIT_HEIGHT));i<Math.min(height/UNIT_HEIGHT,Math.ceil((camera+visibleHeight)/UNIT_HEIGHT));i++) {
      const yy=((i+0.5)*UNIT_HEIGHT-camera)*scale;
      const label=String(height/UNIT_HEIGHT-i).padStart(2,'0');
      ctx.fillStyle='#a3afa7';ctx.textAlign='right';ctx.fillText(label,left-17,yy);ctx.textAlign='left';ctx.fillText(label,left+mapWidth+17,yy);
    }
    if(camera<=0){ctx.fillStyle='#a7b8ab';ctx.textAlign='center';ctx.font='10px monospace';ctx.fillText('EXIT',viewWidth/2,-camera*scale-15);}
  }
  function frame(now) {
    const dt=lastFrame===null?0:Math.min((now-lastFrame)/1000,0.05);lastFrame=now;
    // Small simulation steps prevent tunneling through spikes during slow frames.
    let remaining=dt;while(remaining>0){const step=Math.min(remaining,1/120);update(step);remaining-=step;}
    draw();requestAnimationFrame(frame);
  }
  function releaseKeys() {
    if(state?.running && keys.size) state.inputs.push({t:state.time,type:'release_all',keys:[...keys]});
    keys.clear();lastFrame=null;
  }
  function loadReplay(record){
    const path=record?.trajectory,map=record?.map;
    if(!map || map.width!==WIDTH || map.playerDiameter!==PLAYER_DIAMETER || map.unitHeight!==UNIT_HEIGHT || !Number.isFinite(map.height) || map.height<UNIT_HEIGHT || map.height>UNIT_HEIGHT*100 || map.height%UNIT_HEIGHT!==0 || !Array.isArray(map.traps) || map.traps.length>10000 || !Array.isArray(path) || !path.length || path.length>2000000)throw new Error('지원되는 동선 기록 파일이 아닙니다.');
    let prev=-1;
    for(const p of path){
      if(!p || ![p.t,p.x,p.y,p.health].every(Number.isFinite) || p.t<0 || p.t<=prev || p.x<RADIUS || p.x>WIDTH-RADIUS || p.y<RADIUS || p.y>map.height-RADIUS || !Number.isInteger(p.health) || p.health<0 || p.health>HEALTH)throw new Error('동선 좌표 또는 시간이 올바르지 않습니다.');
      prev=p.t;
    }
    const ids=new Set();
    if(record.vision && (!['idleDiameters','walkDiameters','runDiameters','walkSpeed','runSpeed'].every(k=>Number.isFinite(record.vision[k]) && record.vision[k]>0) || record.vision.runSpeed<=record.vision.walkSpeed))throw new Error('시야 설정이 올바르지 않습니다.');
    for(const trap of map.traps){if(!trap || typeof trap.id!=='string' || ids.has(trap.id) || ![trap.x,trap.y,trap.radius].every(Number.isFinite) || trap.radius<=0 || trap.radius>WIDTH || trap.x<0 || trap.x>WIDTH || trap.y<0 || trap.y>map.height)throw new Error('함정 정보가 올바르지 않습니다.');ids.add(trap.id);}
    const distances=new Float64Array(path.length),touchEvents=[],touched=new Set();
    for(let i=0;i<path.length;i++){
      const p=path[i];if(i)distances[i]=distances[i-1]+Math.hypot(p.x-path[i-1].x,p.y-path[i-1].y);
      for(const trap of map.traps){if(touched.size<HEALTH-p.health && !touched.has(trap.id) && Math.abs(p.y-trap.y)<=RADIUS+trap.radius && Math.hypot(p.x-trap.x,p.y-trap.y)<=RADIUS+trap.radius){touched.add(trap.id);touchEvents.push({t:p.t,id:trap.id});}}
    }
    if(state?.running)finish('reset');
    keys.clear();latestRecord=record;$('download').disabled=false;
    replay={record,distances,touchEvents,duration:path[path.length-1].t,time:0,playing:true};
    state={running:false,units:map.height/UNIT_HEIGHT,height:map.height,traps:map.traps,touched:new Set(),health:HEALTH,x:path[0].x,y:path[0].y,time:0,distance:0,actualSpeed:0};
    $('overlay').hidden=true;$('moveInstructions').hidden=true;$('replayControls').hidden=false;$('replaySeek').max=replay.duration;$('replaySeek').value=0;
    lastFrame=null;seekReplay(0);
  }
  function seekReplay(time){
    if(!replay)return;
    replay.time=Math.max(0,Math.min(replay.duration,time));
    const path=replay.record.trajectory;
    let lo=0,hi=path.length;
    while(lo<hi){const mid=(lo+hi)>>>1;if(path[mid].t<=replay.time)lo=mid+1;else hi=mid;}
    const i=Math.max(0,lo-1),a=path[i],b=path[Math.min(i+1,path.length-1)];
    const fraction=b.t>a.t?Math.max(0,Math.min(1,(replay.time-a.t)/(b.t-a.t))):0;
    state.x=a.x+(b.x-a.x)*fraction;state.y=a.y+(b.y-a.y)*fraction;state.health=a.health;state.time=replay.time;
    state.distance=replay.distances[i]+Math.hypot(state.x-a.x,state.y-a.y);
    const before=i>0?path[i-1]:a;
    state.actualSpeed=a.t>before.t?Math.hypot(a.x-before.x,a.y-before.y)/(a.t-before.t):0;
    state.touched=new Set(replay.touchEvents.filter(e=>e.t<=replay.time).map(e=>e.id));
    if(replay.time>=replay.duration)replay.playing=false;
    $('replayToggle').textContent=replay.playing?'일시정지':'재생';
    $('replaySeek').value=replay.time;$('replayTime').textContent=`${replay.time.toFixed(1)} / ${replay.duration.toFixed(1)}초`;
    updateHud();
    updateReplayBehavior();
  }
  function updateReplayBehavior(){
    if(!replay)return;
    const path=replay.record.trajectory;
    const begin=Math.max(path[0].t,replay.time-BEHAVIOR_WINDOW);
    let lo=0,hi=path.length;
    while(lo<hi){const mid=(lo+hi)>>>1;if(path[mid].t<=begin)lo=mid+1;else hi=mid;}
    const i=Math.max(0,lo-1),a=path[i],b=path[Math.min(i+1,path.length-1)];
    const f=b.t>a.t?Math.max(0,Math.min(1,(begin-a.t)/(b.t-a.t))):0;
    const x=a.x+(b.x-a.x)*f,y=a.y+(b.y-a.y)*f;
    const startDistance=replay.distances[i]+Math.hypot(x-a.x,y-a.y);
    const distance=Math.max(0,state.distance-startDistance),duration=Math.max(0,replay.time-begin);
    const averageSpeed=duration>0?distance/duration:0;
    const forwardRatio=distance>0?Math.max(0,(y-state.y)/distance):0;
    const forwardSpeed=duration>0?Math.max(0,y-state.y)/duration:0;
    let movingTime=0;
    for(let j=i;j<path.length-1 && path[j].t<replay.time;j++){
      const p=path[j],q=path[j+1],dt=q.t-p.t;
      if(dt>0 && Math.hypot(q.x-p.x,q.y-p.y)/dt>1){
        movingTime+=Math.max(0,Math.min(q.t,replay.time)-Math.max(p.t,begin));
      }
    }
    const movingRatio=duration>0?movingTime/duration:0;
    const stride=duration>=1 && forwardSpeed>=MIN_FORWARD_SPEED && forwardRatio>=FORWARD_DISTANCE_RATIO && movingRatio>=MIN_MOVING_TIME_RATIO;
    const label=$('replayBehavior');label.hidden=false;
    label.textContent=stride?'stride':'scout';
    label.dataset.behavior=stride?'stride':'scout';
    label.title=`최근 ${duration.toFixed(2)}초 · 평균 속도 ${averageSpeed.toFixed(1)} · 전진 속도 ${forwardSpeed.toFixed(1)} · 전진 비율 ${Math.round(forwardRatio*100)}% · 이동 시간 ${Math.round(movingRatio*100)}%. 동선에 따른 추정이며 실제 의도나 위험 인식을 판정하지 않습니다.`;
  }
  function inputKey(event){
    if(event.code==='Space')return 'space';
    if(event.code==='ShiftLeft' || event.code==='ShiftRight')return event.code.toLowerCase();
    if(/^Key[WASD]$/.test(event.code ?? ''))return event.code.slice(3).toLowerCase();
    return event.key.toLowerCase();
  }
  window.addEventListener('keydown',event=>{
    if(replay)return;
    if(event.key==='Enter' && !event.repeat && !state?.running){
      event.preventDefault();start();return;
    }
    const key=inputKey(event);
    if(!['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright','space','shiftleft','shiftright','shift'].includes(key)||event.target.matches('input,textarea,select')||!state?.running)return;
    event.preventDefault();if(!keys.has(key)){keys.add(key);state.inputs.push({t:state.time,type:'keydown',key});}
  });
  window.addEventListener('keyup',event=>{const key=inputKey(event);if(keys.delete(key)&&state?.running)state.inputs.push({t:state.time,type:'keyup',key});});
  window.addEventListener('blur',releaseKeys);document.addEventListener('visibilitychange',releaseKeys);
  $('start').onclick=start;$('reset').onclick=start;$('overlayStart').onclick=start;
  $('download').onclick=()=>latestRecord&&saveRecord(latestRecord);
  $('replayLoad').onclick=()=>$('replayFile').click();
  $('replayFile').onchange=async event=>{
    const file=event.target.files[0];if(!file)return;
    try{if(file.size>200*1024*1024)throw new Error('파일이 너무 큽니다 (최대 200MB).');loadReplay(JSON.parse(await file.text()));$('replayError').textContent='';}
    catch(error){$('replayError').textContent=error instanceof SyntaxError?'JSON 파일 형식을 확인하세요.':error.message;}
    event.target.value='';
  };
  $('replayToggle').onclick=()=>{if(!replay)return;if(replay.time>=replay.duration)seekReplay(0);replay.playing=!replay.playing;seekReplay(replay.time);};
  $('replaySeek').oninput=()=>{if(replay){replay.playing=false;seekReplay(Number($('replaySeek').value));}};
  new ResizeObserver(resize).observe(canvas);resize();requestAnimationFrame(frame);
})();
