const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const elements = new Map(), arcs = [], listeners = new Map();
const ctx = new Proxy({
  arc(...args) { arcs.push(args); },
  createRadialGradient() { return { addColorStop() {} }; }
}, { get(target, key) { return key in target ? target[key] : () => {}; } });
function element(id) {
  if (!elements.has(id)) elements.set(id, {
    value: id === 'replayRate' ? '1' : '10', style: {}, dataset: {}, firstElementChild: { style: {} },
    setAttribute() {}, getContext: () => ctx, getBoundingClientRect: () => ({ width: 1200, height: 800 })
  });
  return elements.get(id);
}
const sandbox = {
  document: { getElementById: element, addEventListener() {} }, window: { addEventListener(type, fn) { listeners.set(type, fn); } },
  devicePixelRatio: 1, ResizeObserver: class { observe() {} }, requestAnimationFrame() {}, Date, Math, Set
};
const source = fs.readFileSync(require('node:path').join(__dirname, '../game.js'), 'utf8')
  .replace('new ResizeObserver(resize)', 'globalThis.test={loadReplay,seekReplay,update,draw,start,get state(){return state},get replay(){return replay}}; new ResizeObserver(resize)');
vm.runInNewContext(source, sandbox);
const t = sandbox.test;
const record = {
  map: { width: 224, height: 2240, unitHeight: 224, playerDiameter: 32,
    traps: [{id: 'near', x: 112, y: 970, radius: 11}, {id: 'outside', x: 40, y: 1100, radius: 11}] },
  trajectory: [{t: 0, x: 112, y: 1000, health: 5}, {t: 1, x: 112, y: 970, health: 4}, {t: 2, x: 112, y: 940, health: 4}]
};
t.loadReplay(record);
assert.equal(element('moveInstructions').hidden, true);
t.seekReplay(0.5); assert.equal(t.state.y, 985); assert.equal(t.state.health, 5);
t.seekReplay(1); assert.equal(t.state.health, 4); assert(t.state.touched.has('near'));
t.seekReplay(0); assert.equal(t.state.touched.size, 0);
arcs.length = 0; t.draw(); assert(arcs.some(a => a[0] === 40 && a[1] === 1100 && a[2] === 11), 'outside-view trap is rendered');
t.replay.playing = true; element('replayRate').value = '2'; t.update(0.25); assert.equal(t.replay.time, 0.5);
t.seekReplay(2); assert.equal(t.replay.playing, false); assert.equal(t.state.y, 940);
assert.throws(() => t.loadReplay({ ...record, trajectory: [{t: -1, x: 112, y: 1000, health: 5}] }));
function behaviorPath(points) {
  t.loadReplay({ map: {...record.map, traps: []}, trajectory: points.map(([time,x,y])=>({t:time,x,y,health:5})) });
}
behaviorPath([[0,112,1000],[1,112,935],[2,112,870],[3.5,112,870]]);
t.seekReplay(1); assert.equal(element('replayBehavior').dataset.behavior, 'stride', 'walking forward is stride');
t.seekReplay(3.5); assert.equal(element('replayBehavior').dataset.behavior, 'scout', 'recent stop is scout');
t.seekReplay(0); assert.equal(element('replayBehavior').dataset.behavior, 'scout', 'rewind updates category');
behaviorPath([[0,50,1000],[0.5,150,1000],[1,50,1000]]);
t.seekReplay(1); assert.equal(element('replayBehavior').dataset.behavior, 'scout', 'lateral search is scout');
behaviorPath([[0,112,1000],[1,112,890]]);
t.seekReplay(1); assert.equal(element('replayBehavior').dataset.behavior, 'stride', 'running forward is stride');
t.seekReplay(0.5); assert.equal(element('replayBehavior').dataset.behavior, 'scout', 'brief forward burst is insufficient');
behaviorPath([[0,112,1000],[1.5,112,955]]);
t.seekReplay(1.5); assert.equal(element('replayBehavior').dataset.behavior, 'scout', 'slow walking is scout');
behaviorPath([[0,112,1000],[0.6,112,934],[1.5,112,934]]);
t.seekReplay(1.5); assert.equal(element('replayBehavior').dataset.behavior, 'scout', 'burst followed by pause is scout');
behaviorPath([[0,50,1000],[0.75,110,920],[1.5,50,840]]);
t.seekReplay(1.5); assert.equal(element('replayBehavior').dataset.behavior, 'scout', '80 percent forward ratio no longer qualifies');
t.start(); assert.equal(t.replay, null); assert.equal(t.state.running, true);
assert.equal(element('moveInstructions').hidden, false);
assert.equal(element('replayBehavior').hidden, true);
function key(type, value) {
  listeners.get(type)({key:value,code:value.length===1 ? `Key${value.toUpperCase()}` : value,target:{matches:()=>false},preventDefault(){}});
}
function tick(count=60) { for(let i=0;i<count;i++)t.update(1/120); }
t.state.traps=[];t.state.y=1000;t.state.x=112;
key('keydown','w');key('keydown','ArrowUp');tick();assert.equal(t.state.vy,-65);
key('keyup','w');tick();assert.equal(t.state.vy,-65,'arrow keeps movement after W release');
key('keyup','ArrowUp');tick();assert.equal(t.state.vy,0);
key('keydown','w');key('keydown','ArrowUp');key('keyup','ArrowUp');tick();assert.equal(t.state.vy,-65,'W keeps movement after arrow release');
key('keydown','ArrowDown');tick();assert.equal(t.state.vy,0,'opposite directions cancel');
key('keyup','ArrowDown');key('keydown','ArrowRight');tick(12);
assert(Math.hypot(t.state.vx,t.state.vy)<=65+1e-9,'mixed diagonal input stays normalized');
key('keyup','w');key('keyup','ArrowRight');tick();
t.state.x=112;t.state.y=1000;
key('keydown','w');key('keydown','Space');tick();assert.equal(t.state.vy,-110);
key('keydown','ShiftLeft');tick(20);assert.equal(t.state.vy,-30,'Shift overrides running and brakes');
key('keydown','ShiftRight');key('keyup','ShiftLeft');tick();assert.equal(t.state.vy,-30,'right Shift retains slow walk');
key('keyup','ShiftRight');key('keyup','Space');tick();assert.equal(t.state.vy,-65,'release returns to ordinary walk');
key('keyup','w');tick();assert.equal(t.state.vy,0);
for (const units of [1, 10, 100]) {
  element('mission').value = String(units);
  for (let trial = 0; trial < 50; trial++) {
    t.state.running = false; t.start();
    assert.equal(t.state.traps.length, units * 3);
    for (const trap of t.state.traps) {
      assert(Math.hypot(trap.x - t.state.x, trap.y - t.state.y) >= 64 + trap.radius, 'spawn safe area stays clear');
      assert(trap.y - trap.radius >= 0 && trap.y + trap.radius <= t.state.height);
    }
    t.update(1 / 120); assert.equal(t.state.health, 5, 'idle spawn takes no damage');
  }
}
console.log('PASS: replay interpolation, health, touched traps, rewind, full trap visibility, playback speed, completion, validation and return to game');
console.log('PASS: spawn clearance and initial health across 150 generated maps');
console.log('PASS: stride/scout for walking, running, stopping, lateral search and rewind');
console.log('PASS: WASD/arrow logical OR, independent releases, opposite directions, mixed diagonal and mode-specific HUD visibility');
console.log('PASS: stricter stride thresholds, slow walk, Shift priority and independent Shift releases');
