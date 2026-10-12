(() => {
  'use strict';
  const PLAYER_DIAMETER = 32, RADIUS = PLAYER_DIAMETER / 2;
  const WIDTH = PLAYER_DIAMETER * 7, UNIT_HEIGHT = WIDTH;
  const HEALTH = 5, SLOW_WALK_SPEED = 30, WALK_SPEED = 65, SPEED = 110, TRAPS_PER_UNIT = 3, TRAP_RADIUS = 11;
  const BASE_ACCELERATION = 220, START_ACCELERATION_BOOST = 420, BRAKING = 840;
  const IDLE_VIEW_DIAMETERS = 3, RUN_VIEW_DIAMETERS = 2;
  const SPAWN_SAFE_RADIUS = PLAYER_DIAMETER * 2;
  const BEHAVIOR_WINDOW = 1.5, FORWARD_DISTANCE_RATIO = 0.9;
  const MIN_FORWARD_SPEED = PLAYER_DIAMETER, MIN_MOVING_TIME_RATIO = 0.85;
  // Preserve the previous walking view (4 -> 3 across speeds 0 -> 110).
  const WALK_VIEW_DIAMETERS = IDLE_VIEW_DIAMETERS-WALK_SPEED/SPEED;
  const $ = id => document.getElementById(id);
  const canvas = $('game'), ctx = canvas.getContext('2d');
  const keys = new Set();
  let state = null, latestRecord = null, lastFrame = null, viewWidth = 0, viewHeight = 0;
  const replay = null;
  const CELL = 8, SCAN_RANGE = 120, SCAN_HALF = Math.PI / 6, SCAN_BACK_OFFSET = 24;
  const TURN_RAMP_SECONDS = 0.75;
  const FOG_START_DELAY = 2;
  const SETTING_IDS = ['turnLimit','turnRate','scanDelay','fogSpeed','fogGrace'];
  let pointer = null;
  const angleDifference = (a,b) => Math.atan2(Math.sin(a-b),Math.cos(a-b));
  function scanGeometry() {
    return {x:state.x-Math.cos(state.angle)*SCAN_BACK_OFFSET,
      y:state.y-Math.sin(state.angle)*SCAN_BACK_OFFSET,
      radius:state.scanRange+SCAN_BACK_OFFSET};
  }
  function visible(px,py) {
    const d = Math.hypot(px-state.x,py-state.y);
    const beam=scanGeometry();
    const forward=(px-state.x)*Math.cos(state.angle)+(py-state.y)*Math.sin(state.angle);
    return d <= state.nearRadius || (state.scanning && forward>=0 && Math.hypot(px-beam.x,py-beam.y) <= beam.radius && Math.abs(angleDifference(Math.atan2(py-beam.y,px-beam.x),state.angle)) <= SCAN_HALF);
  }
  function turnTowardPointer(dt) {
    if(pointer) {
      const scale=Math.min((viewWidth-100)/WIDTH,1.35);
      const playerScreenX=viewWidth/2+(state.x-WIDTH/2)*scale;
      if(Math.hypot(pointer.x-playerScreenX,pointer.y-viewHeight/2)<2){state.turnSpeed=0;state.turnDirection=0;return;}
      const target = Math.atan2(pointer.y-viewHeight/2,pointer.x-playerScreenX);
      const delta = angleDifference(target,state.angle);
      if(!state.exploration.turnLimit){state.angle+=delta;state.turnSpeed=0;state.turnDirection=0;return;}
      const direction=Math.sign(delta),limit=state.exploration.turnRate*Math.PI/180;
      if(direction!==state.turnDirection)state.turnSpeed=0;
      state.turnDirection=direction;
      const previous=state.turnSpeed;
      state.turnSpeed=Math.min(limit,previous+limit/TURN_RAMP_SECONDS*dt);
      const max=(previous+state.turnSpeed)*.5*dt;
      if(Math.abs(delta)<=max){state.angle+=delta;state.turnSpeed=0;state.turnDirection=0;}
      else state.angle+=direction*max;
    }
  }
  function lightStrength(px,py) {
    const d=Math.hypot(px-state.x,py-state.y);
    const near=Math.min(1,Math.max(0,(1-d/state.nearRadius)/.55));
    const beam=scanGeometry();
    const offset=Math.abs(angleDifference(Math.atan2(py-beam.y,px-beam.x),state.angle));
    const forward=(px-state.x)*Math.cos(state.angle)+(py-state.y)*Math.sin(state.angle);
    const cone=state.scanning && forward>=0 ? Math.max(0,1-Math.hypot(px-beam.x,py-beam.y)/beam.radius)*Math.min(1,Math.max(0,(1-offset/SCAN_HALF)/.3)) : 0;
    return Math.max(near,cone);
  }
  function explorationStep(dt) {
    const movingInput = ['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].some(k=>keys.has(k));
    state.scanning = state.actualSpeed <= 0.1 && !movingInput;
    state.stillTime = state.scanning ? state.stillTime+dt : 0;
    state.scanRange = state.nearRadius+(SCAN_RANGE-state.nearRadius)*Math.min(1,state.stillTime/state.exploration.scanDelay);
    const reach = state.scanning ? state.scanRange+SCAN_BACK_OFFSET : state.nearRadius;
    for(let row=Math.max(0,Math.floor((state.y-reach)/CELL));row<Math.min(state.height/CELL,Math.ceil((state.y+reach)/CELL));row++) {
      for(let col=Math.max(0,Math.floor((state.x-reach)/CELL));col<Math.min(WIDTH/CELL,Math.ceil((state.x+reach)/CELL));col++) {
        const px=(col+.5)*CELL,py=(row+.5)*CELL,key=row*(WIDTH/CELL)+col;
        // Require a whole cell to be inside the lit region before retaining it.
        if(!state.known.has(key) && [[-4,-4],[4,-4],[-4,4],[4,4]].every(([dx,dy])=>visible(px+dx,py+dy))) {
          state.known.add(key);state.observations.push({t:state.time,cell:key});
        }
      }
    }
    for(const trap of state.traps) if(visible(trap.x,trap.y))state.seenTraps.add(trap.id);
    $('scanStatus').textContent = state.scanning ? '정지 탐색' : '이동 중 · 좁은 주변 시야';
  }
  function updateFog(dt,oldY) {
    const fog=state.fog;
    const frontAt=t=>state.height-fog.speed*Math.max(0,t-fog.startDelay);
    const previousFront=frontAt(state.time-dt);
    fog.frontY=frontAt(state.time);
    const oldGap=oldY-previousFront,newGap=state.y-fog.frontY;
    fog.inside=newGap>=0;
    if(!fog.inside){fog.exposure=0;return;}
    const entered=oldGap<0;
    const fraction=entered ? Math.max(0,Math.min(1,-oldGap/(newGap-oldGap))) : 0;
    if(entered)fog.exposure=0;
    fog.exposure+=dt*(1-fraction);
    while(fog.exposure+1e-9>=fog.grace && state.health>0){
      fog.exposure=Math.max(0,fog.exposure-fog.grace);state.health--;state.flashUntil=state.time+.2;
      fog.damageEvents.push({t:state.time,health:state.health});
    }
  }
  canvas.addEventListener('pointermove',event=>{const rect=canvas.getBoundingClientRect();pointer={x:event.clientX-rect.left,y:event.clientY-rect.top};});
  function resize() {
    const rect = canvas.getBoundingClientRect();
    viewWidth = rect.width; viewHeight = rect.height;
    canvas.width = Math.round(viewWidth * devicePixelRatio);
    canvas.height = Math.round(viewHeight * devicePixelRatio);
  }
  function saveRecord(record) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], {type:'application/json'}));
    const link = document.createElement('a');
    link.href = url; link.download = `scout-stride-exploration-${record.startedAt.replace(/[:.]/g, '-')}.json`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function finish(reason) {
    if (!state || !state.running) return;
    state.running = false; keys.clear();for(const id of SETTING_IDS)$(id).disabled=false;
    latestRecord = {
      version:2, variant:'stationary-exploration', exploration:state.exploration, observations:state.observations, observationCellSize:CELL, startedAt:state.startedAt, endedAt:new Date().toISOString(), reason,
      missionUnits:state.units, remainingHealth:state.health,
      touchedTrapCount:state.touched.size, touchedTrapIds:[...state.touched],
      durationSeconds:state.time, distance:state.distance,
      vision:{idleDiameters:IDLE_VIEW_DIAMETERS,walkDiameters:WALK_VIEW_DIAMETERS,runDiameters:RUN_VIEW_DIAMETERS,walkSpeed:WALK_SPEED,runSpeed:SPEED},
      map:{width:WIDTH,height:state.height,unitHeight:UNIT_HEIGHT,playerDiameter:PLAYER_DIAMETER,trapsPerUnit:TRAPS_PER_UNIT,traps:state.traps},
      coordinates:'continuous world units; origin top-left; +y points down; start at bottom, exit at top',
      trajectory:state.path, inputEvents:state.inputs
      ,fog:{speed:state.fog.speed,startDelay:state.fog.startDelay,damageInterval:state.fog.grace,damageEvents:state.fog.damageEvents}
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
    $('replayControls').hidden=true;$('replayBehavior').hidden=true;$('moveInstructions').hidden=false;
    keys.clear();
    for(const id of ['turnRate','scanDelay','fogSpeed','fogGrace'])if(!$(id).checkValidity()){$(id).reportValidity();return;}
    const traps = [];
    const spawnX=WIDTH/2,spawnY=units*UNIT_HEIGHT-RADIUS-8;
    for (let i = 0; i < units; i++) {
      for (let j = 0; j < TRAPS_PER_UNIT; j++) {
        // Keep the final unit's traps above a full-width safe starting area.
        const safeBandOffset=i===units-1 ? 12 : 70;
        const bandSpacing=i===units-1 ? 45 : 55;
        const trap={type:'spike',id:`${units-i}-${j+1}`,x:RADIUS + TRAP_RADIUS + Math.random()*(WIDTH-2*(RADIUS+TRAP_RADIUS)),y:i*UNIT_HEIGHT+safeBandOffset+j*bandSpacing+Math.random()*16,radius:TRAP_RADIUS};
        // Guarantee a clear gap even if the placement bands are changed later.
        const clearance=SPAWN_SAFE_RADIUS+TRAP_RADIUS;
        if(Math.hypot(trap.x-spawnX,trap.y-spawnY)<clearance)trap.y=spawnY-clearance;
        traps.push(trap);
      }
    }
    state = {running:true, units,height:units*UNIT_HEIGHT,x:WIDTH/2,y:spawnY,vx:0,vy:0,actualSpeed:0,health:HEALTH,traps,touched:new Set(),time:0,distance:0,startedAt:new Date().toISOString(),path:[{t:0,x:WIDTH/2,y:spawnY,health:HEALTH}],inputs:[]};
    Object.assign(state,{angle:-Math.PI/2,turnSpeed:0,turnDirection:0,stillTime:0,scanning:false,scanRange:0,nearRadius:48,known:new Set(),seenTraps:new Set(),observations:[],exploration:{turnLimit:$('turnLimit').checked,turnRate:Number($('turnRate').value),scanDelay:Number($('scanDelay').value),scanRange:SCAN_RANGE,scanAngleDegrees:60,scanBackOffset:SCAN_BACK_OFFSET,turnRampSeconds:TURN_RAMP_SECONDS}});
    state.fog={speed:Number($('fogSpeed').value),grace:Number($('fogGrace').value),startDelay:FOG_START_DELAY,frontY:state.height,exposure:0,inside:false,damageEvents:[]};
    for(const id of SETTING_IDS)$(id).disabled=true;
    explorationStep(0);
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
    $('fogStatus').textContent=state.fog.inside ? `안개 안 · 피해까지 ${Math.max(0,state.fog.grace-state.fog.exposure).toFixed(1)}초` : state.time<state.fog.startDelay ? `안개 출발까지 ${(state.fog.startDelay-state.time).toFixed(1)}초` : `안개까지 ${Math.max(0,state.fog.frontY-state.y).toFixed(0)} 거리`;
    $('fogStatus').style.color=state.fog.inside?'#e5a38d':'#afb6c5';
  }
  function update(dt) {
    if(replay){if(replay.playing)seekReplay(Math.min(replay.duration,replay.time+dt*Number($('replayRate').value)));return;}
    if (!state?.running) return;
    state.time += dt;
    turnTowardPointer(dt);
    let dx = Number(keys.has('d') || keys.has('arrowright'))-Number(keys.has('a') || keys.has('arrowleft'));
    let dy = Number(keys.has('s') || keys.has('arrowdown'))-Number(keys.has('w') || keys.has('arrowup'));
    const length = Math.hypot(dx,dy);
    if (length) {dx/=length;dy/=length;}
    // W/S move along the gaze; A/D strafe relative to the same gaze.
    const localRight=dx,localForward=-dy;
    dx=Math.cos(state.angle)*localForward-Math.sin(state.angle)*localRight;
    dy=Math.sin(state.angle)*localForward+Math.cos(state.angle)*localRight;
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
    state.nearRadius=PLAYER_DIAMETER*(IDLE_VIEW_DIAMETERS-(IDLE_VIEW_DIAMETERS-RUN_VIEW_DIAMETERS)*Math.min(1,state.actualSpeed/SPEED))/2;
    explorationStep(dt);
    updateFog(dt,oldY);
    state.path.push({t:state.time,x:state.x,y:state.y,health:state.health,angle:state.angle,scanning:state.scanning,scanRange:state.scanRange,nearRadius:state.nearRadius,fogFrontY:state.fog.frontY,fogExposure:state.fog.exposure});
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
    const lightRadius=state?.nearRadius ?? 64;
    const glow=ctx.createRadialGradient(x,y,0,x,y,lightRadius);
    glow.addColorStop(0,'rgba(100,120,105,0.45)');glow.addColorStop(.45,'rgba(100,120,105,0.45)');glow.addColorStop(1,'rgba(100,120,105,0)');
    ctx.fillStyle=glow;ctx.beginPath();ctx.arc(x,y,lightRadius,0,Math.PI*2);ctx.fill();
    if(state?.scanning){
      // Clip the extra beam at the player's plane; its rear origin adds no rear light.
      ctx.save();ctx.translate(x,y);ctx.rotate(state.angle);
      ctx.beginPath();ctx.rect(0,-1000,1000,2000);ctx.clip();
      ctx.rotate(-state.angle);ctx.translate(-x,-y);
      const origin=scanGeometry();
      const beam=ctx.createRadialGradient(origin.x,origin.y,0,origin.x,origin.y,origin.radius);
      beam.addColorStop(0,'rgba(120,145,125,0.45)');beam.addColorStop(.45,'rgba(100,125,105,0.25)');beam.addColorStop(1,'rgba(100,125,105,0)');
      ctx.fillStyle=beam;
      // Feather angular edges as well as the far edge; no boundary outline.
      const slices=100,step=2*SCAN_HALF/slices;
      for(let i=0;i<slices;i++){
        const start=state.angle-SCAN_HALF+i*step;
        const edge=Math.min((i+.5)/slices,1-(i+.5)/slices);
        ctx.globalAlpha=Math.sin(Math.min(1,edge/.15)*Math.PI/2)**2;
        ctx.beginPath();ctx.moveTo(origin.x,origin.y);ctx.arc(origin.x,origin.y,origin.radius,start,start+step+.0001);ctx.closePath();ctx.fill();
      }
      ctx.globalAlpha=1;
      ctx.restore();
    }
    for(const trap of state?.traps ?? []) {
      const d=Math.hypot(x-trap.x,y-trap.y);
      if(!state.seenTraps.has(trap.id)) continue;
      if(trap.y+trap.radius<camera || trap.y-trap.radius>camera+visibleHeight)continue;
      ctx.save();
      ctx.globalAlpha=0.28+0.72*lightStrength(trap.x,trap.y);
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
    ctx.strokeStyle='#a1aaa4';ctx.lineWidth=1;ctx.stroke();ctx.fillStyle='#64736a';ctx.beginPath();ctx.arc(x+Math.cos(state?.angle ?? -Math.PI/2)*10,y+Math.sin(state?.angle ?? -Math.PI/2)*10,3,0,Math.PI*2);ctx.fill();
    if(state?.fog){
      const front=state.fog.frontY;
      const top=Math.max(front,camera),bottom=Math.min(height,camera+visibleHeight);
      if(bottom>top){
        const mist=ctx.createLinearGradient(0,front,0,front+70);
        mist.addColorStop(0,'rgba(136,146,165,0.12)');mist.addColorStop(.4,'rgba(112,123,145,0.45)');mist.addColorStop(1,'rgba(82,95,119,0.7)');
        ctx.fillStyle=mist;ctx.fillRect(0,top,WIDTH,bottom-top);
        ctx.strokeStyle='rgba(174,186,205,0.25)';ctx.lineWidth=1;
        for(let row=Math.floor(top/26);row<Math.ceil(bottom/26);row++){
          const yy=row*26+Math.sin(state.time*.8+row)*4;
          if(yy<front)continue;
          ctx.beginPath();ctx.moveTo(0,yy);ctx.bezierCurveTo(WIDTH*.3,yy-8,WIDTH*.7,yy+8,WIDTH,yy);ctx.stroke();
        }
        // Keep the player readable inside the mist.
        ctx.strokeStyle='#c0c7c4';ctx.beginPath();ctx.arc(x,y,RADIUS,0,Math.PI*2);ctx.stroke();
      }
    }
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
  new ResizeObserver(resize).observe(canvas);resize();requestAnimationFrame(frame);
})();





