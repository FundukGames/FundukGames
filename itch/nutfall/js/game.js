/*
 * Nutfall — sealed circular arena prototype.
 * --------------------------------------------------------------------------
 * A cannon fires nuts into a closed round arena. Walls are springy and there
 * is NO gravity, so a nut ricochets around — picking up value from the +N / ×N
 * modifiers inside — until it escapes through the GOAL arc on the rim. Only
 * then is its value banked and its slot freed. Nuts in play are capped, so
 * nut↔nut collisions are on (cheap at this count) for extra chaos.
 *
 * Aim with the pointer + tap to fire, or toggle Auto ("flow"): the cannon
 * self-fires with a small spread in direction and varied power.
 *
 * Perf notes (.claude/skills/threejs-geometry, threejs-interaction):
 *   - nuts and pegs are InstancedMesh (few draw calls),
 *   - pointer→world via Raycaster against the z=0 plane,
 *   - fixed nut pool, no per-frame allocation.
 */
import * as THREE from "three";

// ---- Plinko field constants (everything lives on the z=0 plane) -----------
const HW = 4.4, HH = 6.6;          // half-width / half-height of the field
const NUT_R = 0.32, BUMP_R = 0.5;
const WALL_BOUNCE = 0.7, BUMP_BOUNCE = 0.82, MAX_NUTS = 400;
const GRAVITY = -12;               // nuts fall downward
const VMAX = 16;                   // hard speed cap (anti-tunnelling / bumper safety)
const SPAWN_Y = HH - 0.4, DRAIN_Y = -HH + 0.85; // top spawn line / bottom receiver line
let CAPACITY = 5;                  // nuts allowed in play at once (upgradable; resets each level)
let baseCapacity = 5;             // capacity floor a fresh level starts at (raised by unlocks)
let baseValue = 1;                 // value a nut starts with
let flowInterval = 1.0;            // seconds between drops (starts at 1/s)
let GOAL_MULT = 1;                 // global payout multiplier (persistent, tiny steps)

// Bottom receiver lanes are rebuilt per stage; the current layout lives here.
let LANES = [], LANE_W = 0;
function laneColor(m) {
  if (m === 0) return "#8a3030";   // trap
  if (m >= 10) return "#ffd23f";   // jackpot
  if (m >= 6) return "#ff9d3a";
  if (m >= 3) return "#ff5ca8";
  if (m >= 2) return "#19c37d";
  if (m > 1) return "#5fc8a0";     // ×1.5
  return "#c89b3a";                // ×1
}

// --- Stage progression: bank 🌰 to fill the stage bar; each new stage swaps the
// board (lane layout) and unlocks an upgrade / Multiply modifier / capacity. ---
let stage = 0, lifetime = 0, unlockedMul = false;
let maxOnField = 1, fieldCap = 4; // current modifier-slot count (bought) and the level's cap
const upgUnlocked = { cap: true, slot: true, val: false, flow: false, goal: false };
const modUnlocked = { bump: false, funnel: false, split: false };
const STAGES = [
  { name: "First Harvest", need: 0,        lanes: [1],                maxOnField: 4 },
  { name: "Sweet Tooth",   need: 250,      lanes: [1, 1],             maxOnField: 4, unlockUpg: "val" },
  { name: "Twin Hollows",  need: 1200,     lanes: [1, 1],             maxOnField: 5, unlockMul: true, unlockUpg: "goal" },
  { name: "The Climb",     need: 6000,     lanes: [1, 1, 1],          maxOnField: 6, unlockMod: "funnel" },
  { name: "Rotten Branch", need: 30000,    lanes: [1, 1, 1],          maxOnField: 6, unlockUpg: "flow", unlockMod: "bump" },
  { name: "Deep Grove",    need: 150000,   lanes: [1, 1, 1, 1],       maxOnField: 6, unlockCap: 1 },
  { name: "Wide Canopy",   need: 800000,   lanes: [1, 1, 1, 1],       maxOnField: 6, unlockCap: 1, unlockMod: "split" },
  { name: "Golden Bough",  need: 4000000,  lanes: [1, 1, 1, 1, 1],    maxOnField: 6 },
  { name: "Mastery",       need: 20000000, lanes: [1, 1, 1, 1, 1],    maxOnField: 6 },
];
const STAGES_MAX = STAGES.length - 1;

// ---- Renderer / scene / camera --------------------------------------------
const arenaEl = document.getElementById("arena");
const popupsEl = document.getElementById("popups");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x2a2150);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping; // tames highlights WITHOUT dulling the candy colors
renderer.toneMappingExposure = 1.0;
arenaEl.appendChild(renderer.domElement);
let composer = null; // optional bloom pipeline, wired up below if addons load

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(0, 0, 18);
camera.lookAt(0, 0, 0);

scene.add(new THREE.AmbientLight(0xffffff, 0.42));
const key = new THREE.DirectionalLight(0xffffff, 0.95);
key.position.set(3, 5, 8);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.0005;
const sc = key.shadow.camera;
sc.left = -(HW + 1); sc.right = HW + 1; sc.top = HH + 1; sc.bottom = -(HH + 1); sc.near = 1; sc.far = 40;
scene.add(key);
const fill = new THREE.DirectionalLight(0xff7ec8, 0.4); // warm pink rim light
fill.position.set(-5, -3, 5); scene.add(fill);

// Quick outlined text sprite (lane multipliers + later the nut numbers/labels).
function tagSprite(text, size, color) {
  const cv = document.createElement("canvas"); cv.width = cv.height = 128;
  const ctx = cv.getContext("2d");
  ctx.font = "900 58px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.lineWidth = 8; ctx.strokeStyle = "rgba(0,0,0,0.8)"; ctx.strokeText(text, 64, 68);
  ctx.fillStyle = color || "#fff"; ctx.fillText(text, 64, 68);
  const tex = new THREE.CanvasTexture(cv); tex.anisotropy = 4;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  s.scale.set(size, size, 1); return s;
}

// Bark texture for the trunk walls / base.
function barkTexture() {
  const cv = document.createElement("canvas"); cv.width = 128; cv.height = 512;
  const ctx = cv.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 128, 0);
  g.addColorStop(0, "#432c15"); g.addColorStop(0.5, "#7a5634"); g.addColorStop(1, "#3d2712");
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 512);
  ctx.strokeStyle = "rgba(30,18,8,0.55)";
  for (let i = 0; i < 16; i++) {
    let x = Math.random() * 128, y = 0; ctx.lineWidth = 1 + Math.random() * 3; ctx.beginPath(); ctx.moveTo(x, 0);
    while (y < 512) { x += (Math.random() - 0.5) * 7; y += 22; ctx.lineTo(x, y); } ctx.stroke();
  }
  ctx.strokeStyle = "rgba(190,150,95,0.22)";
  for (let i = 0; i < 8; i++) { const x = Math.random() * 128; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + (Math.random() - 0.5) * 12, 512); ctx.stroke(); }
  const tex = new THREE.CanvasTexture(cv); tex.anisotropy = 4; return tex;
}
// Back panel — warm woody gradient.
function boardTexture() {
  const cv = document.createElement("canvas"); cv.width = 256; cv.height = 512;
  const ctx = cv.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, "#3a2c1a"); g.addColorStop(1, "#16100a");
  ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 512);
  ctx.strokeStyle = "rgba(255,220,170,0.04)"; ctx.lineWidth = 2;
  for (let y = 40; y < 512; y += 46) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(256, y); ctx.stroke(); }
  const tex = new THREE.CanvasTexture(cv); tex.anisotropy = 4; return tex;
}
const boardMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(2 * HW + 0.4, 2 * HH + 0.4),
  new THREE.MeshStandardMaterial({ map: boardTexture(), roughness: 0.95 })
);
boardMesh.position.z = -0.5; boardMesh.receiveShadow = true; scene.add(boardMesh);

// Side walls = tree-trunk bark; a branch across the top.
const barkMat = new THREE.MeshStandardMaterial({ map: barkTexture(), roughness: 0.9 });
const woodMat = new THREE.MeshStandardMaterial({ color: 0x6e4a28, roughness: 0.8 });
function wall(x) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2 * HH + 0.4, 0.9), barkMat); m.position.set(x, 0, 0); m.castShadow = true; scene.add(m); }
wall(-HW - 0.25); wall(HW + 0.25);
const topBranch = new THREE.Mesh(new THREE.BoxGeometry(2 * HW + 1.0, 0.5, 0.9), barkMat);
topBranch.position.set(0, HH + 0.25, 0); scene.add(topBranch);

// Bottom = trunk base; each stage's lanes (hollows) are (re)built into laneGroup.
const beam = new THREE.Mesh(new THREE.BoxGeometry(2 * HW + 0.5, 1.0, 0.9), barkMat);
beam.position.set(0, DRAIN_Y - 0.5, -0.1); beam.receiveShadow = true; scene.add(beam);
const laneGroup = new THREE.Group(); scene.add(laneGroup);
function laneTag(ln) {
  const t = tagSprite("×" + (Math.round(ln.mult * 10) / 10), Math.min(0.85, LANE_W * 0.55), ln.mult === 0 ? "#ff9a9a" : "#ffe7b0");
  t.position.set(ln.cx, DRAIN_Y - 0.18, 0.45); return t;
}
function buildLanes(mults) {
  while (laneGroup.children.length) {
    const c = laneGroup.children.pop();
    if (c.isMesh && c.geometry) c.geometry.dispose();
    if (c.material) { if (c.material.map) c.material.map.dispose(); c.material.dispose(); }
    laneGroup.remove(c);
  }
  LANE_W = (2 * HW) / mults.length;
  const rx = LANE_W * 0.42, ry = Math.min(0.85, rx); // ellipse hollow sized to the lane width
  // Every lane always starts at ×1 — the stage's array only sets the lane COUNT;
  // players grow each lane via the per-lane upgrade buttons.
  LANES = mults.map((m, i) => ({ base: 1, mult: 1, lvl: 0, color: laneColor(1), cx: -HW + (i + 0.5) * LANE_W, tag: null, rim: null }));
  LANES.forEach((ln) => {
    // coloured border ellipse behind a dark hollow ellipse — fills the lane cleanly.
    ln.rim = new THREE.Mesh(new THREE.CircleGeometry(1, 36),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(ln.color), roughness: 0.5, metalness: 0.15 }));
    ln.rim.scale.set(rx + 0.12, ry + 0.12, 1); ln.rim.position.set(ln.cx, DRAIN_Y - 0.18, 0.18); laneGroup.add(ln.rim);
    const hollow = new THREE.Mesh(new THREE.CircleGeometry(1, 36), new THREE.MeshStandardMaterial({ color: 0x0f0905, roughness: 0.95 }));
    hollow.scale.set(rx, ry, 1); hollow.position.set(ln.cx, DRAIN_Y - 0.18, 0.2); laneGroup.add(hollow);
    ln.tag = laneTag(ln); laneGroup.add(ln.tag);
  });
  buildLaneButtons();
}

// ---- Per-lane upgrade buttons (a coin button under each hollow) ------------
const laneBtnsEl = document.getElementById("lanebtns");
const laneProjV = new THREE.Vector3();
let laneButtons = [];
// Lanes upgrade in ×0.1 steps, priced exactly like the ×-modifier tiers.
function laneUpgCost(ln) { return TYPES.mul.cost(Math.round((ln.mult + 0.1) * 10) / 10); }
function upgradeLane(i) {
  const ln = LANES[i]; const c = laneUpgCost(ln);
  if (score < c) return;
  score -= c;
  ln.mult = Math.round((ln.mult + 0.1) * 10) / 10; ln.lvl++; ln.color = laneColor(ln.mult);
  ln.rim.material.color.set(ln.color);
  laneGroup.remove(ln.tag); ln.tag.material.map.dispose(); ln.tag.material.dispose();
  ln.tag = laneTag(ln); laneGroup.add(ln.tag);
}
function buildLaneButtons() {
  if (!laneBtnsEl) return;
  laneBtnsEl.innerHTML = ""; laneButtons = [];
  LANES.forEach((ln, i) => {
    const b = document.createElement("button"); b.className = "lanebtn";
    b.addEventListener("click", () => upgradeLane(i));
    laneBtnsEl.appendChild(b); laneButtons.push(b);
  });
  positionLaneButtons();
}
function positionLaneButtons() {
  if (!laneBtnsEl) return;
  const rect = arenaEl.getBoundingClientRect();
  LANES.forEach((ln, i) => {
    const b = laneButtons[i]; if (!b) return;
    laneProjV.set(ln.cx, DRAIN_Y - 1.05, 0).project(camera);
    b.style.left = (laneProjV.x * 0.5 + 0.5) * rect.width + "px";
    b.style.top = (-laneProjV.y * 0.5 + 0.5) * rect.height + "px";
  });
}
function updateLaneButtons() { // called each frame (cheap; a handful of lanes)
  for (let i = 0; i < LANES.length; i++) {
    const b = laneButtons[i]; if (!b) continue;
    const c = laneUpgCost(LANES[i]);
    b.textContent = "⬆ " + fmtVal(c);
    b.disabled = score < c;
    if (!b.disabled) tip("lane", "Tap <b>⬆</b> under a hollow to raise that lane's multiplier");
  }
}
buildLanes(STAGES[0].lanes);

// Squirrel that tosses the nuts in, on the top branch.
function squirrelSprite() {
  const cv = document.createElement("canvas"); cv.width = cv.height = 256;
  const ctx = cv.getContext("2d");
  ctx.font = "200px serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("🐿️", 128, 140);
  const tex = new THREE.CanvasTexture(cv); tex.anisotropy = 4;
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
}
const squirrel = squirrelSprite(); squirrel.scale.set(1.9, 1.9, 1);
const SQ_Y = HH + 0.5; squirrel.position.set(0, SQ_Y, 0.6); scene.add(squirrel);
let squirrelKick = 0, squirrelTargetX = 0; // toss timer + the column it's hopping to

// No static pegs — nuts are deflected only by the walls and the modifiers the
// player places. (`dummy` is reused to write nut instance transforms below.)
const dummy = new THREE.Object3D();

// ---- Modifier bumpers — placed by the player from the inventory -----------
const bumpers = []; // populated at runtime; see placeBumperFree

// ---- Nut pool + InstancedMesh ---------------------------------------------
// Hazelnut-ish silhouette, revolved into a solid — reads as a nut, not a ball,
// and still works as a single instanced geometry.
const PROFILE = [[0.0, -1.0], [0.45, -0.96], [0.8, -0.62], [1.0, -0.18], [0.96, 0.34], [0.62, 0.74], [0.28, 0.95], [0.06, 1.0]];
const nutGeo = new THREE.LatheGeometry(PROFILE.map(([x, y]) => new THREE.Vector2(x * NUT_R * 0.95, y * NUT_R)), 18);
nutGeo.computeVertexNormals();
const nutMesh = new THREE.InstancedMesh(
  nutGeo, new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.15 }), MAX_NUTS
);
nutMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_NUTS * 3), 3);
nutMesh.castShadow = true;
scene.add(nutMesh);
const nuts = [];
for (let i = 0; i < MAX_NUTS; i++) nuts.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, value: 1, cool: 0 });
const colLow = new THREE.Color(0x8a5a2b), colHigh = new THREE.Color(0xe0a83a), tmpCol = new THREE.Color();
// Compact number format — used for the in-nut value and the +N goal popup.
function fmtVal(v) {
  if (v >= 1e6) return (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + "M";
  if (v >= 1000) return (v / 1000).toFixed(v >= 1e4 ? 0 : 1) + "k";
  return String(Math.round(v * 10) / 10);
}

// Value number rendered INSIDE each nut (pooled sprites, redrawn on change).
const MAX_LABELS = 64;
const labels = [];
for (let i = 0; i < MAX_LABELS; i++) {
  const cv = document.createElement("canvas"); cv.width = cv.height = 128;
  const tex = new THREE.CanvasTexture(cv);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  spr.scale.set(NUT_R * 1.7, NUT_R * 1.7, 1); spr.renderOrder = 10; spr.visible = false;
  scene.add(spr);
  labels.push({ spr: spr, ctx: cv.getContext("2d"), tex: tex, last: null });
}
function drawNum(L, text) {
  const ctx = L.ctx; ctx.clearRect(0, 0, 128, 128);
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  let font = 66;
  do { ctx.font = "900 " + font + "px system-ui, sans-serif"; font -= 5; }
  while (ctx.measureText(text).width > 112 && font > 18); // shrink to fit longer numbers
  ctx.lineWidth = 7; ctx.strokeStyle = "rgba(0,0,0,0.85)"; ctx.strokeText(text, 64, 68);
  ctx.fillStyle = "#fff"; ctx.fillText(text, 64, 68);
  L.tex.needsUpdate = true;
}

let inPlay = 0;
// Nuts drop from three fixed columns — left edge / center / right edge — in
// round-robin order (the squirrel moves to each spot).
const DROP_X = [-(HW - 1.0), 0, HW - 1.0];
let dropIdx = 0;
function spawnTop() {
  if (inPlay >= CAPACITY) return false;
  const n = nuts.find((q) => !q.active);
  if (!n) return false;
  n.active = true; inPlay++;
  n.x = DROP_X[dropIdx]; dropIdx = (dropIdx + 1) % DROP_X.length;
  n.y = SPAWN_Y;
  n.vx = 0; n.vy = -1;
  n.value = baseValue; n.cool = 0;
  squirrelTargetX = n.x;  // squirrel hops to the drop column
  squirrelKick = 0.3;
  return true;
}
// Splitter: clone the nut (same value) shooting sideways, if capacity allows.
function trySplit(n) {
  if (inPlay >= CAPACITY) return;
  const c = nuts.find((q) => !q.active);
  if (!c) return;
  c.active = true; inPlay++;
  c.x = n.x; c.y = n.y; c.vx = -n.vx; c.vy = n.vy * 0.7;
  c.value = n.value; c.cool = 0.2;
}

// ---- HUD + input -----------------------------------------------------------
let score = 30, displayScore = 30, emitTimer = 0; // bare-minimum starting balance
const elScore = document.getElementById("score");
const elNuts = document.getElementById("nuts");
const elFps = document.getElementById("fps");

// Floating +N / crack popups, projected from world space onto the arena overlay.
const projV = new THREE.Vector3();
function popup(x, y, text, cls) {
  projV.set(x, y, 0).project(camera);
  const rect = arenaEl.getBoundingClientRect();
  const el = document.createElement("div");
  el.className = "pop " + cls; el.textContent = text;
  el.style.left = (projV.x * 0.5 + 0.5) * rect.width + "px";
  el.style.top = (-projV.y * 0.5 + 0.5) * rect.height + "px";
  popupsEl.appendChild(el);
  el.addEventListener("animationend", () => el.remove());
}

// Pointer → world (z=0 plane) via raycaster; aim cannon, tap to fire.
const raycaster = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const ndc = new THREE.Vector2(), hit = new THREE.Vector3();
function pointerWorld(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -(((e.clientY - rect.top) / rect.height) * 2 - 1));
  raycaster.setFromCamera(ndc, camera);
  return raycaster.ray.intersectPlane(plane, hit) ? hit : null;
}
// Pointer is only for placing & dragging modifiers (nuts drop automatically).
let dragBumper = null, dragFromX = 0, dragFromY = 0, dragMoved = false;
let lastClickTime = 0, lastClickBumper = null; // for double-click-to-remove
renderer.domElement.addEventListener("pointerdown", (e) => {
  const p = pointerWorld(e); if (!p) return;
  if (armedSlot >= 0 && inventory[armedSlot]) {            // placing / merging from the inventory
    const tgt = bumpers.find((m) => Math.hypot(m.x - p.x, m.y - p.y) < BUMP_R * 1.3);
    if (tgt) {                                             // dropped onto a field modifier
      if (canMerge(inventory[armedSlot], tgt)) {           // identical -> merge into it (frees the slot)
        setBumperValue(tgt, tierUp(tgt.type, tgt.value));
        inventory[armedSlot] = null; armedSlot = -1; updateInventory();
      }                                                    // else: occupied by a different one -> no-op
    } else { placeFromInventory(p); }                      // empty spot -> place
    hideGhost(); return;
  }
  const b = bumpers.find((m) => Math.hypot(m.x - p.x, m.y - p.y) < BUMP_R + 0.15);
  if (b) {
    const now = performance.now();
    if (b === lastClickBumper && now - lastClickTime < 300) { // double-click -> pick up
      pickUpBumper(b); lastClickBumper = null; dragBumper = null; return;
    }
    lastClickTime = now; lastClickBumper = b;
    dragBumper = b; dragFromX = b.x; dragFromY = b.y; dragMoved = false; // single press -> drag
  }
});
renderer.domElement.addEventListener("pointermove", (e) => {
  const p = pointerWorld(e); if (!p) return;
  if (dragBumper) {
    const c = clampInArena(p); dragMoved = true; moveBumper(dragBumper, c.x, c.y);
    showGhost(dragBumper.x, dragBumper.y, dropState(dragBumper.x, dragBumper.y, dragBumper.item, dragBumper));
  } else if (armedSlot >= 0 && inventory[armedSlot]) {
    const c = clampInArena(p);
    showGhost(c.x, c.y, dropState(c.x, c.y, inventory[armedSlot], null));
  } else { hideGhost(); }
});
renderer.domElement.addEventListener("pointerleave", hideGhost);
window.addEventListener("pointerup", () => {
  hideGhost();
  if (!dragBumper) return;
  if (!dragMoved) { dragBumper = null; return; } // a plain tap does nothing now (double-click removes)
  lastClickBumper = null; // a real drag shouldn't count toward a double-click
  const tgt = bumpers.find((b) => b !== dragBumper && Math.hypot(b.x - dragBumper.x, b.y - dragBumper.y) < BUMP_R * 1.3);
  if (tgt) {
    if (canMerge(dragBumper, tgt)) mergeInto(tgt, dragBumper);          // dropped onto identical -> merge
    else moveBumper(dragBumper, dragFromX, dragFromY);                  // can't stack -> revert
  } else if (overlapsOther(dragBumper.x, dragBumper.y, dragBumper)) {
    moveBumper(dragBumper, dragFromX, dragFromY);                       // too close -> revert
  }
  dragBumper = null;
});

// ---- Idle upgrades (left) -------------------------------------------------
// `now` returns the current value so the player always sees what they have.
const UPGRADES = [
  { id: "cap",  name: "Capacity",   desc: "+1 nut",       base: 120, mult: 1.9,  level: 0, apply: () => CAPACITY++,                                          now: () => CAPACITY + " nuts" },
  { id: "slot", name: "Mod slots",  desc: "+1 on field",  base: 80,  mult: 2.5,  level: 0, apply: () => { if (maxOnField < fieldCap) maxOnField++; }, max: () => maxOnField >= fieldCap, now: () => maxOnField + "/" + fieldCap },
  { id: "val",  name: "Base value", desc: "+1",           base: 100, mult: 1.6,  level: 0, apply: () => (baseValue += 1),                                    now: () => "start " + baseValue },
  { id: "flow", name: "Drop rate",  desc: "faster drops", base: 220, mult: 1.75, level: 0, apply: () => (flowInterval = Math.max(0.12, flowInterval * 0.85)), max: () => flowInterval <= 0.12, now: () => flowInterval.toFixed(2) + "s" },
  // Persistent global multiplier (survives the level reset) — slow & steep.
  { id: "goal", name: "Goal bonus", desc: "+×0.05 · kept", base: 300, mult: 10,  level: 0, persist: true, apply: () => (GOAL_MULT = Math.round((GOAL_MULT + 0.05) * 100) / 100), now: () => "×" + GOAL_MULT.toFixed(2) },
];
function upCost(u) { return Math.round(u.base * Math.pow(u.mult, u.level)); }
function buyUpgrade(u) { const c = upCost(u); if (score < c) return; score -= c; u.level++; u.apply(); refreshShops(); }

const upList = document.getElementById("up-list");
UPGRADES.forEach((u) => {
  const row = document.createElement("div"); row.className = "up-row"; row.dataset.id = u.id;
  row.innerHTML = '<div class="info"><b>' + u.name + '</b><span><b class="now"></b> · Lv<span class="lv">0</span> · ' + u.desc + '</span></div>' +
    '<button class="buy">🌰<span class="cost"></span></button>';
  row.querySelector(".buy").addEventListener("click", () => buyUpgrade(u));
  upList.appendChild(row);
});
function updateUpgrades() {
  UPGRADES.forEach((u) => {
    const row = upList.querySelector('.up-row[data-id="' + u.id + '"]');
    const locked = !upgUnlocked[u.id];
    row.style.opacity = locked ? 0.45 : 1;
    row.querySelector(".now").textContent = u.now();
    row.querySelector(".lv").textContent = u.level;
    const buy = row.querySelector(".buy");
    if (locked) { buy.disabled = true; buy.textContent = "🔒"; }
    else if (u.max && u.max()) { buy.disabled = true; buy.textContent = "MAX"; }
    else { buy.innerHTML = "🌰<span class=\"cost\">" + fmtVal(upCost(u)) + "</span>"; buy.disabled = score < upCost(u); }
  });
}

// ---- Merchant (right): pick a TYPE, crank its QUALITY, buy ONE item -------
const TYPES = {
  // Tiered: each tier doubles the cost; buying a pre-merged tier adds a 15%
  // convenience commission over merging it yourself (merge only equal tiers).
  add:    { id: "add", name: "Add", color: "#ffce3a", min: 1, max: 10, step: 1,
            label: (v) => "+" + v,
            cost: (v) => v <= 1 ? 10 : Math.round(10 * Math.pow(2, v - 1) * 1.15) },
  mul:    { id: "mul", name: "Multiply", color: "#19c37d", min: 1.1, max: 2.0, step: 0.1,
            label: (v) => "×" + (Math.round(v * 10) / 10),
            cost: (v) => { const k = Math.round((v - 1) * 10); return k <= 1 ? 45 : Math.round(45 * Math.pow(2, k - 1) * 1.15); } },
  bump:   { id: "bump", name: "Bumper", color: "#c9bdff", fixed: true, label: () => "»", cost: () => 60 },
  funnel: { id: "funnel", name: "Funnel", color: "#7fc8ff", fixed: true, label: () => "▽", cost: () => 200 },
  split:  { id: "split", name: "Splitter", color: "#ff9d3a", fixed: true, label: () => "Y", cost: () => 500 },
};
let shopType = "add", quality = TYPES.add.min;
function typeUnlocked(id) {
  if (id === "mul") return unlockedMul;
  if (id === "bump" || id === "funnel" || id === "split") return modUnlocked[id];
  return true; // add is always available
}

const INV_SLOTS = 16;
const inventory = new Array(INV_SLOTS).fill(null); // one item per slot, no stacking
let armedSlot = -1;

const buyBox = document.getElementById("buy-box");
function q(sel) { return buyBox.querySelector(sel); }

// Type selector.
const modTypes = document.getElementById("mod-types");
Object.values(TYPES).forEach((t) => {
  const b = document.createElement("button"); b.className = "mtype"; b.dataset.id = t.id;
  b.style.background = t.color; b.textContent = t.name;
  b.addEventListener("click", () => { if (!typeUnlocked(t.id)) return; shopType = t.id; quality = t.fixed ? 0 : t.min; updateMerchant(); });
  modTypes.appendChild(b);
});

// Quality box: − / slider / + with a live price.
buyBox.innerHTML =
  '<div class="bb-head"><button class="chip" id="bb-chip"></button><span id="bb-unit">quality</span></div>' +
  '<div class="bb-qty"><button id="bb-minus">−</button><input type="range" id="bb-slider" /><button id="bb-plus">+</button></div>' +
  '<div class="bb-foot"><span id="bb-qtyl"></span><button class="buy" id="bb-buy">Buy 🌰<span id="bb-total">0</span></button></div>';
const bb = { chip: q("#bb-chip"), minus: q("#bb-minus"), plus: q("#bb-plus"), slider: q("#bb-slider"),
  qtyl: q("#bb-qtyl"), total: q("#bb-total"), buy: q("#bb-buy") };
function snapQuality(v) {
  const t = TYPES[shopType];
  v = Math.round(v / t.step) * t.step;
  return Math.max(t.min, Math.min(t.max, Math.round(v * 100) / 100));
}
bb.slider.addEventListener("input", () => { quality = snapQuality(+bb.slider.value); updateMerchant(); });
bb.minus.addEventListener("click", () => { quality = snapQuality(quality - TYPES[shopType].step); updateMerchant(); });
bb.plus.addEventListener("click", () => { quality = snapQuality(quality + TYPES[shopType].step); updateMerchant(); });
bb.buy.addEventListener("click", () => {
  const t = TYPES[shopType], fixed = !!t.fixed;
  const price = fixed ? t.cost() : t.cost(quality), slot = inventory.indexOf(null);
  if (score < price || slot < 0) return;
  score -= price;
  const value = fixed ? 0 : (t.id === "mul" ? Math.round(quality * 10) / 10 : quality);
  inventory[slot] = { type: t.id, value: value, label: fixed ? t.label() : t.label(quality), color: t.color };
  refreshShops(); updateInventory();
  tip("inv", "Tap a slot to pick it up, then tap the <b>arena</b> to place");
  const same = inventory.filter((it) => it && it.type === t.id && it.value === value).length;
  if (same >= 2) tip("merge", "Two identical ones — drop one <b>onto the other</b> to merge into a stronger tier");
});
function qualityMax(t) { // per-level shop cap ramps up to the global max (+10 / ×2.0) by the last stage
  const lv = stage + 1; // 1..9
  return t.id === "add" ? Math.min(t.max, lv + 1) : Math.min(t.max, Math.round((1.1 + lv * 0.1) * 10) / 10);
}
function updateMerchant() {
  if (!typeUnlocked(shopType)) shopType = "add";
  const t = TYPES[shopType];
  // type buttons: select highlight + lock state + label
  Object.values(TYPES).forEach((tt) => {
    const btn = modTypes.querySelector('.mtype[data-id="' + tt.id + '"]');
    const ok = typeUnlocked(tt.id);
    btn.classList.toggle("sel", tt.id === shopType);
    btn.classList.toggle("locked", !ok);
    btn.textContent = ok ? tt.name : "🔒";
  });
  const fixed = !!t.fixed, full = inventory.indexOf(null) < 0;
  buyBox.classList.toggle("fixed", fixed);
  if (fixed) {
    bb.chip.textContent = t.label(); bb.chip.style.background = t.color;
    bb.qtyl.textContent = t.name;
    const price = t.cost();
    bb.total.textContent = fmtVal(price);
    bb.buy.disabled = score < price || full;
  } else {
    const qmax = qualityMax(t);
    quality = Math.max(t.min, Math.min(qmax, snapQuality(quality)));
    bb.slider.min = t.min; bb.slider.max = qmax; bb.slider.step = t.step; bb.slider.value = quality;
    bb.chip.textContent = t.label(quality); bb.chip.style.background = t.color;
    bb.qtyl.textContent = t.label(quality);
    const price = t.cost(quality);
    bb.total.textContent = fmtVal(price);
    bb.buy.disabled = score < price || full;
  }
}

// ---- Inventory (RPG grid) + free placement --------------------------------
const invEl = document.getElementById("inventory");

// One-time onboarding coachmarks (remembered in localStorage).
const tipEl = document.getElementById("tip");
let tipsSeen = {};
try { tipsSeen = JSON.parse(localStorage.getItem("nf_tips") || "{}"); } catch (e) {}
let tipTimer = null;
function tip(id, html) {
  if (tipsSeen[id] || !tipEl) return;
  tipsSeen[id] = 1;
  try { localStorage.setItem("nf_tips", JSON.stringify(tipsSeen)); } catch (e) {}
  tipEl.innerHTML = html; tipEl.classList.add("show");
  clearTimeout(tipTimer); tipTimer = setTimeout(() => tipEl.classList.remove("show"), 5000);
}

for (let i = 0; i < INV_SLOTS; i++) {
  const slot = document.createElement("button"); slot.className = "slot"; slot.dataset.i = i;
  slot.addEventListener("click", () => {
    if (!inventory[i]) return;
    // armed item + clicked an identical one -> merge in the inventory
    if (armedSlot >= 0 && armedSlot !== i && inventory[armedSlot] && canMerge(inventory[armedSlot], inventory[i])) {
      inventory[i] = nextTierItem(inventory[i]); inventory[armedSlot] = null; armedSlot = i; updateInventory(); return;
    }
    armedSlot = armedSlot === i ? -1 : i; updateInventory();
    if (armedSlot === i) tip("place", "Now tap inside the <b>arena</b> to drop it where you want");
  });
  invEl.appendChild(slot);
}
function updateInventory() {
  for (let i = 0; i < INV_SLOTS; i++) {
    const el = invEl.querySelector('.slot[data-i="' + i + '"]'); const it = inventory[i];
    el.textContent = it ? it.label : ""; el.style.background = it ? it.color : "";
    el.classList.toggle("filled", !!it); el.classList.toggle("sel", armedSlot === i);
  }
}
// A modifier is a glossy 3D disc with a floating text label (not a flat sprite).
const bumperGeo = new THREE.CylinderGeometry(BUMP_R, BUMP_R, 0.34, 30);
function textSprite(text, size) {
  const cv = document.createElement("canvas"); cv.width = cv.height = 128;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#14152b"; ctx.font = "bold 58px system-ui, sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(text, 64, 70);
  const tex = new THREE.CanvasTexture(cv); tex.anisotropy = 4;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  s.scale.set(size, size, 1); return s;
}
// ---- Funnel = a localized volumetric RAYMARCH tornado ---------------------
// A camera-facing quad at the funnel position; its fragment shader raymarches a
// procedural storm-funnel in the funnel's LOCAL space (positioned by uCenter,
// scaled by uInvScale). Only the quad's pixels run the shader, so several
// funnels stay cheap. Shader optimized: 3-octave fbm, cheap shadow march, 72 steps.
const FUNNEL_OFF = 0.7;        // funnel volume centers this far above the modifier point
const FUNNEL_INVSCALE = 2.6;   // world->local scale (bigger = smaller funnel)
const FUNNEL_VERT = `
  varying vec3 vWorld;
  void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`;
const FUNNEL_FRAG = `
  precision highp float;
  varying vec3 vWorld;
  uniform float uTime; uniform vec3 uCenter; uniform float uInvScale; uniform float uSteps;
  float hash(vec3 p){ p=fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
  float vnoise(vec3 x){ vec3 i=floor(x),f=fract(x); f=f*f*(3.0-2.0*f);
    return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
               mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
  float fbm(vec3 p){ float a=0.5,s=0.0; for(int i=0;i<3;i++){ s+=a*vnoise(p); p=p*2.02+vec3(11.3,7.1,3.7); a*=0.5; } return s; }
  const float Y_BOT=-1.75; const float Y_TOP=1.85;
  float funnelRadius(float y){ float t=clamp((y-Y_BOT)/(Y_TOP-Y_BOT),0.0,1.0);
    float r=0.085+1.15*pow(t,1.75); r+=0.55*smoothstep(0.78,1.0,t); r+=0.10*exp(-16.0*t); return r; }
  float densAt(vec3 p, float tm){
    if(p.y<Y_BOT-0.25||p.y>Y_TOP+0.45) return 0.0;
    float t=clamp((p.y-Y_BOT)/(Y_TOP-Y_BOT),0.0,1.0);
    float sway=0.22*sin(p.y*1.0+tm*0.8)+0.09*sin(p.y*2.4-tm*1.2);
    vec2 axis=vec2(sway,0.12*cos(p.y*0.85+tm*0.55)); vec2 q=p.xz-axis;
    float radius=length(q); float ang=atan(q.y,q.x); float R=funnelRadius(p.y);
    float spin=tm*(2.6+3.0*(1.0-t)); float swirl=ang+spin+p.y*3.4;
    vec3 np; np.x=cos(swirl)*(1.0+radius*1.2); np.y=p.y*1.6-tm*1.6; np.z=sin(swirl)*(1.0+radius*1.2);
    float n=fbm(np*1.6+vec3(0.0,tm*0.25,0.0)); float n2=fbm(np*3.8+vec3(5.0,-tm*0.5,2.0));
    float detail=n*0.62+n2*0.38;
    float streak=0.5+0.5*sin(swirl*3.0-tm*1.0+n2*4.0); streak=pow(streak,1.6);
    float edgeIn=smoothstep(R*0.0,R*0.50,radius); float edgeOut=smoothstep(R*1.45,R*0.70,radius);
    float wallProfile=edgeIn*edgeOut; float fill=smoothstep(R*1.10,R*0.1,radius);
    float fillAmt=mix(0.45,0.20,t); float shell=mix(wallProfile,fill*0.85,fillAmt);
    float body=shell; body*=(0.30+1.00*detail); body*=(0.55+0.65*streak);
    float topBillow=smoothstep(0.80,1.0,t); body=mix(body,max(body,edgeOut*(0.35+0.6*detail)),topBillow*0.8);
    float topFade=smoothstep(Y_TOP+0.7,Y_TOP-0.2,p.y); float botFade=smoothstep(Y_BOT-0.25,Y_BOT+0.30,p.y);
    float dens=body*topFade*botFade; dens=max(dens-0.15,0.0); return dens*2.15;
  }
  float dustAt(vec3 p, float tm){
    float h=p.y-Y_BOT; if(h<-0.1||h>1.3) return 0.0;
    vec2 q=p.xz; float sway=0.22*sin(p.y*1.0+tm*0.8); q.x-=sway*0.5;
    float radius=length(q); if(radius>1.6) return 0.0;
    float spin=tm*2.4; float sw=atan(q.y,q.x)+spin+p.y*2.0;
    vec3 np=vec3(cos(sw)*(1.0+radius*1.3),p.y*1.4-tm*1.1,sin(sw)*(1.0+radius*1.3));
    float n=fbm(np*2.2+vec3(0.0,tm*0.3,0.0));
    float ground=smoothstep(1.25,0.0,h); float maxR=mix(1.45,0.45,smoothstep(0.0,1.2,h));
    float ring=smoothstep(maxR,0.1,radius)*smoothstep(0.0,0.35,radius);
    float d=ground*ring*(0.15+0.95*n)-0.20; return max(d,0.0)*0.95;
  }
  float densShadow(vec3 p, float tm){
    if(p.y<Y_BOT-0.25||p.y>Y_TOP+0.45) return 0.0;
    float sway=0.22*sin(p.y*1.0+tm*0.8); vec2 q=p.xz-vec2(sway,0.0);
    float radius=length(q); float R=funnelRadius(p.y);
    float shell=smoothstep(0.0,R*0.5,radius)*smoothstep(R*1.45,R*0.7,radius);
    float n=vnoise(vec3(p.xz*2.0,p.y*1.6-tm*1.2)); return max(shell*(0.4+0.9*n)-0.12,0.0)*2.0;
  }
  bool hitBounds(vec3 ro, vec3 rd, out float t0, out float t1){
    float RC=2.0; float yb=Y_BOT-0.4, yt=Y_TOP+0.9;
    float a=rd.x*rd.x+rd.z*rd.z; float b=2.0*(ro.x*rd.x+ro.z*rd.z); float c=ro.x*ro.x+ro.z*ro.z-RC*RC;
    float tc0=-1e9, tc1=1e9;
    if(abs(a)>1e-5){ float disc=b*b-4.0*a*c; if(disc<0.0) return false; float sq=sqrt(disc); tc0=(-b-sq)/(2.0*a); tc1=(-b+sq)/(2.0*a); }
    else { if(c>0.0) return false; }
    float ty0=(yb-ro.y)/rd.y, ty1=(yt-ro.y)/rd.y; if(ty0>ty1){ float tmp=ty0; ty0=ty1; ty1=tmp; }
    t0=max(tc0,ty0); t1=min(tc1,ty1); t0=max(t0,0.0); return t1>t0;
  }
  void main(){
    vec3 ro=(cameraPosition-uCenter)*uInvScale;       // camera in funnel-local space
    vec3 rd=normalize(vWorld-cameraPosition);          // world ray dir (uniform scale keeps it)
    float tm=uTime; float t0,t1;
    if(!hitBounds(ro,rd,t0,t1)) discard;
    t1=min(t1,t0+9.0);
    vec3 Ldir=normalize(vec3(-0.45,0.80,0.40));
    vec3 colLit=vec3(0.90,0.91,0.95), colMid=vec3(0.52,0.54,0.62), colShadow=vec3(0.17,0.18,0.26), colDust=vec3(0.55,0.45,0.36);
    float steps=uSteps; float dt=(t1-t0)/steps;
    float dither=hash(vec3(gl_FragCoord.xy,tm)); float t=t0+dt*dither;
    float transmittance=1.0; vec3 accum=vec3(0.0);
    for(int i=0;i<72;i++){
      if(float(i)>=uSteps || t>t1) break;
      vec3 p=ro+rd*t; float dF=densAt(p,tm); float dD=dustAt(p,tm); float d=dF+dD;
      if(d>0.001){
        float shadow=0.9;
        if(d>0.02){ float sh=0.0; vec3 sp=p; float sdt=0.24; for(int j=0;j<4;j++){ sp+=Ldir*sdt; sh+=densShadow(sp,tm); } shadow=exp(-sh*0.8); }
        float t01=clamp((p.y-Y_BOT)/(Y_TOP-Y_BOT),0.0,1.0);
        vec3 base=mix(colMid,colLit,smoothstep(0.35,0.95,shadow)); base=mix(colShadow,base,smoothstep(0.0,0.35,shadow));
        base*=(0.82+0.18*shadow);
        float rim=smoothstep(0.55,0.95,shadow)*smoothstep(0.6,0.1,dF*4.0); base+=rim*vec3(0.10,0.11,0.13);
        float warm=clamp((dD/(d+1e-4))+(1.0-smoothstep(0.0,0.28,t01)),0.0,1.0); base=mix(base,colDust*(0.5+0.7*shadow),warm*0.7);
        float a=1.0-exp(-d*dt*8.0); accum+=transmittance*a*base; transmittance*=(1.0-a);
        if(transmittance<0.02) break;
      }
      t+=dt;
    }
    float alpha=1.0-transmittance; if(alpha<0.004) discard;
    gl_FragColor=vec4(accum + alpha*vec3(0.03,0.03,0.04), alpha);
  }`;
function makeTornado() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uInvScale: { value: FUNNEL_INVSCALE }, uSteps: { value: 72 } },
    vertexShader: FUNNEL_VERT, fragmentShader: FUNNEL_FRAG,
    transparent: true, depthWrite: false, depthTest: false,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 3.0), mat);
  m.renderOrder = 6; m.frustumCulled = false;
  return m;
}
function animateTornado(mesh, time, steps) { const u = mesh.material.uniforms; u.uTime.value = time; u.uSteps.value = steps; }
function disposeDisc(disc) {
  disc.traverse((c) => {
    if (!c.isMesh && !c.isPoints) return;
    if (c.geometry && c.geometry !== bumperGeo) c.geometry.dispose();
    if (c.material) c.material.dispose();
  });
}
function placeBumperFree(x, y, item) {
  let disc, lblText = item.label;
  if (item.type === "funnel") {
    disc = makeTornado();
    disc.position.set(x, y + FUNNEL_OFF, 0.5);
    disc.material.uniforms.uCenter.value.set(x, y + FUNNEL_OFF, 0);
    lblText = "";
  } else {
    const isBump = item.type === "bump";
    disc = new THREE.Mesh(bumperGeo, new THREE.MeshStandardMaterial({
      color: new THREE.Color(item.color), roughness: 0.22, metalness: 0.2,
      emissive: new THREE.Color(isBump ? item.color : 0x000000), emissiveIntensity: isBump ? 0.45 : 0 })); // bumper glows
    disc.rotation.x = Math.PI / 2; disc.position.set(x, y, 0.25); disc.castShadow = true;
    if (isBump) lblText = "»";
  }
  const lbl = textSprite(lblText, BUMP_R * 1.7); lbl.position.set(x, y, 0.55);
  scene.add(disc); scene.add(lbl);
  bumpers.push({ x, y, type: item.type, value: item.value, disc, lbl, item });
  tip("field", "<b>Drag</b> it to move · <b>double-click</b> to remove");
}
// Clamp a point to a legal spot inside the field. WALL_PAD keeps a modifier far
// enough from each wall that a nut can still slip down the side channel.
// TOP_PAD keeps modifiers away from the spawn line: parked right under a drop
// column they would catch every nut before it spreads (free-value abuse).
const WALL_PAD = BUMP_R + 2 * NUT_R + 0.1;
const TOP_PAD = 2.5;
function clampInArena(p) {
  return {
    x: Math.max(-HW + WALL_PAD, Math.min(HW - WALL_PAD, p.x)),
    y: Math.max(DRAIN_Y + 1.3, Math.min(SPAWN_Y - TOP_PAD, p.y)),
  };
}
// Keep at least a nut-diameter clear gap between modifiers, so a nut can always
// slip between two of them.
const MIN_SEP = 2 * BUMP_R + 2 * NUT_R + 0.15;
function overlapsOther(x, y, except) {
  return bumpers.some((b) => b !== except && Math.hypot(b.x - x, b.y - y) < MIN_SEP);
}
// Placement indicator: a coloured ring — green = ok, red = blocked/full, cyan = merge.
const ghost = new THREE.Mesh(new THREE.TorusGeometry(BUMP_R + 0.06, 0.06, 8, 28),
  new THREE.MeshBasicMaterial({ color: 0x19c37d, transparent: true, opacity: 0.9 }));
ghost.visible = false; ghost.renderOrder = 9; scene.add(ghost);
// Dashed line marking the no-place zone under the spawn row; shown only while
// a modifier is being dragged so the clamp doesn't feel arbitrary.
const zoneLine = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-HW, SPAWN_Y - TOP_PAD, 0.4), new THREE.Vector3(HW, SPAWN_Y - TOP_PAD, 0.4)]),
  new THREE.LineDashedMaterial({ color: 0xff5a5a, transparent: true, opacity: 0.45, dashSize: 0.22, gapSize: 0.16 }));
zoneLine.computeLineDistances(); zoneLine.visible = false; zoneLine.renderOrder = 9; scene.add(zoneLine);
const GHOST_COL = { valid: 0x19c37d, invalid: 0xff5a5a, full: 0xff5a5a, merge: 0x5fc8ff };
function dropState(x, y, item, except) {
  const tgt = bumpers.find((b) => b !== except && Math.hypot(b.x - x, b.y - y) < BUMP_R * 1.3);
  if (tgt) return canMerge(item, tgt) ? "merge" : "invalid";
  if (!except && bumpers.length >= maxOnField) return "full";
  if (overlapsOther(x, y, except)) return "invalid";
  return "valid";
}
function showGhost(x, y, state) { ghost.position.set(x, y, 0.55); ghost.material.color.setHex(GHOST_COL[state] || 0xffffff); ghost.visible = true; zoneLine.visible = true; }
function hideGhost() { ghost.visible = false; zoneLine.visible = false; }
function moveBumper(b, x, y) {
  b.x = x; b.y = y;
  if (b.type === "funnel") {
    b.disc.position.set(x, y + FUNNEL_OFF, 0.5);
    b.disc.material.uniforms.uCenter.value.set(x, y + FUNNEL_OFF, 0);
  } else {
    b.disc.position.set(x, y, 0.25);
  }
  b.lbl.position.set(x, y, 0.5);
}
function placeFromInventory(p) {
  if (bumpers.length >= maxOnField) { toast("Field is full — max " + maxOnField + " (merge to free a slot)"); return; }
  const c = clampInArena(p);
  if (overlapsOther(c.x, c.y, null)) return; // spot taken
  placeBumperFree(c.x, c.y, inventory[armedSlot]);
  inventory[armedSlot] = null; armedSlot = -1; updateInventory(); updateFieldUI();
}
function pickUpBumper(b) {
  const slot = inventory.indexOf(null);
  if (slot < 0) return; // inventory full -> leave it placed
  inventory[slot] = b.item;
  const i = bumpers.indexOf(b);
  scene.remove(b.disc); scene.remove(b.lbl);
  disposeDisc(b.disc);
  b.lbl.material.map.dispose(); b.lbl.material.dispose();
  bumpers.splice(i, 1); updateInventory(); updateFieldUI();
}
// Merge: only two IDENTICAL +/× tiers combine, into the next tier (this keeps
// cost honest — you can't merge a +1 and a +9 to dodge pricing).
function canMerge(a, b) { return a.type === b.type && (a.type === "add" || a.type === "mul") && a.value === b.value; }
function tierUp(type, value) { return type === "add" ? value + 1 : Math.round((value + 0.1) * 10) / 10; }
function nextTierItem(item) { // the tier-up version of an item (for merging)
  const v = tierUp(item.type, item.value);
  return { type: item.type, value: v, label: TYPES[item.type].label(v), color: item.color };
}
function setBumperValue(b, value) {
  b.value = value;
  b.item = { type: b.type, value: value, label: TYPES[b.type].label(value), color: b.item.color };
  scene.remove(b.lbl); b.lbl.material.map.dispose(); b.lbl.material.dispose();
  b.lbl = textSprite(b.item.label, BUMP_R * 1.7); b.lbl.position.set(b.x, b.y, 0.5); scene.add(b.lbl);
}
function mergeInto(target, src) {
  setBumperValue(target, tierUp(target.type, target.value));
  const i = bumpers.indexOf(src);
  scene.remove(src.disc); scene.remove(src.lbl);
  src.disc.material.dispose(); src.lbl.material.map.dispose(); src.lbl.material.dispose();
  bumpers.splice(i, 1); updateFieldUI();
}
function updateFieldUI() {
  const el = document.getElementById("fieldcount");
  if (el) el.textContent = bumpers.length + "/" + maxOnField;
}

function refreshShops() { updateUpgrades(); updateMerchant(); }

// ---- Stage system: HUD bar, board swaps, unlock toasts --------------------
const elLvl = document.getElementById("lvl");
const lvlFill = document.getElementById("lvlfill");
const stageNameEl = document.getElementById("stagename");
const toastEl = document.getElementById("toast");
function updateStageUI() {
  if (elLvl) elLvl.textContent = stage + 1;
  if (stageNameEl) stageNameEl.textContent = STAGES[stage].name;
  fieldCap = STAGES[stage].maxOnField || 99; // maxOnField (current slots) starts at 1, bought up to this
  updateFieldUI();
  updateStageBar();
}
// Progress bar = how much of the advance cost you've saved up; the button
// lights up when you can afford to pay your way to the next level.
function updateStageBar() {
  const more = stage < STAGES_MAX, cost = more ? STAGES[stage + 1].need : 0;
  if (lvlFill) lvlFill.style.width = (more ? Math.max(0, Math.min(100, (score / cost) * 100)) : 100).toFixed(1) + "%";
  if (nextBtn) {
    nextBtn.style.display = more ? "" : "none";
    if (more) {
      nextBtn.disabled = score < cost; nextBtn.textContent = "Next ▶ −" + fmtVal(cost) + " 🌰";
      if (score >= cost) tip("advance", "Goal reached! Hit <b>Next ▶</b> to clear the level (board resets)");
    }
  }
}
function toast(text) {
  if (!toastEl) return;
  toastEl.textContent = text; toastEl.classList.remove("show"); void toastEl.offsetWidth; toastEl.classList.add("show");
}
// Full reset for a fresh level: wipe field + inventory + upgrades + stats + coins.
// Only the persistent UNLOCKS (access to types/tiers, raised capacity floor) carry over.
function resetRun() {
  while (bumpers.length) {
    const b = bumpers.pop();
    scene.remove(b.disc); scene.remove(b.lbl);
    disposeDisc(b.disc);
    b.lbl.material.map.dispose(); b.lbl.material.dispose();
  }
  for (let i = 0; i < INV_SLOTS; i++) inventory[i] = null;
  armedSlot = -1;
  UPGRADES.forEach((u) => { if (!u.persist) u.level = 0; }); // persistent ones (goal/lane) carry over
  CAPACITY = baseCapacity; baseValue = 1; flowInterval = 1.0; maxOnField = 1; // GOAL_MULT persists; lanes rebuild per stage
  for (const n of nuts) n.active = false; inPlay = 0;
  score = 30; displayScore = 30;
  updateInventory(); updateFieldUI();
}
// Pay your way to the next level: keep the unlocks, then wipe everything else.
function tryAdvance() {
  if (stage >= STAGES_MAX) return;
  const cost = STAGES[stage + 1].need;
  if (score < cost) return;
  stage++;
  const s = STAGES[stage];
  if (s.unlockUpg) upgUnlocked[s.unlockUpg] = true;
  if (s.unlockMul) unlockedMul = true;
  if (s.unlockMod) modUnlocked[s.unlockMod] = true;
  if (s.unlockCap) baseCapacity += s.unlockCap;
  buildLanes(s.lanes);
  resetRun();
  toast("⬆ Level " + (stage + 1) + " — " + s.name + " · fresh start!");
  refreshShops(); updateStageUI();
  saveGame(); // a level-up must never be lost
}
const nextBtn = document.getElementById("nextbtn");
if (nextBtn) nextBtn.addEventListener("click", tryAdvance);

// ---- Save / load: full progress persists in localStorage -------------------
// Saves both the persistent unlocks AND the current run (board, coins, upgrades),
// so a reload in the same browser continues exactly where you left off.
const SAVE_KEY = "nf_save_v1";
function mkItem(type, value) {
  const t = TYPES[type];
  return { type: type, value: value, label: t.fixed ? t.label() : t.label(value), color: t.color };
}
function saveGame() {
  try {
    const upLevels = {};
    UPGRADES.forEach((u) => (upLevels[u.id] = u.level));
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      v: 1,
      stage: stage, lifetime: lifetime, unlockedMul: unlockedMul,
      upgUnlocked: upgUnlocked, modUnlocked: modUnlocked,
      baseCapacity: baseCapacity, GOAL_MULT: GOAL_MULT,
      score: score, CAPACITY: CAPACITY, baseValue: baseValue,
      flowInterval: flowInterval, maxOnField: maxOnField,
      upLevels: upLevels,
      lanes: LANES.map((ln) => ({ mult: ln.mult, lvl: ln.lvl })),
      bumpers: bumpers.map((b) => ({ type: b.type, value: b.value, x: b.x, y: b.y })),
      inventory: inventory.map((it) => (it ? { type: it.type, value: it.value } : null)),
    }));
  } catch (e) {}
}
function loadGame() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(SAVE_KEY) || "null"); } catch (e) {}
  if (!s || s.v !== 1) return false;
  try {
    stage = Math.max(0, Math.min(STAGES_MAX, s.stage | 0));
    lifetime = s.lifetime || 0; unlockedMul = !!s.unlockedMul;
    Object.assign(upgUnlocked, s.upgUnlocked || {});
    Object.assign(modUnlocked, s.modUnlocked || {});
    baseCapacity = s.baseCapacity || baseCapacity;
    GOAL_MULT = s.GOAL_MULT || 1;
    UPGRADES.forEach((u) => (u.level = (s.upLevels && s.upLevels[u.id]) || 0));
    buildLanes(STAGES[stage].lanes);
    (s.lanes || []).forEach((d, i) => {
      const ln = LANES[i]; if (!ln || !d) return;
      ln.mult = d.mult; ln.lvl = d.lvl || 0; ln.color = laneColor(ln.mult);
      ln.rim.material.color.set(ln.color);
      laneGroup.remove(ln.tag); ln.tag.material.map.dispose(); ln.tag.material.dispose();
      ln.tag = laneTag(ln); laneGroup.add(ln.tag);
    });
    score = s.score || 0; displayScore = score;
    CAPACITY = s.CAPACITY || CAPACITY; baseValue = s.baseValue || 1;
    flowInterval = s.flowInterval || 1.0; maxOnField = s.maxOnField || 1;
    (s.bumpers || []).forEach((b) => { // clampInArena: saves from before TOP_PAD may hold spots that are now illegal
      if (!TYPES[b.type]) return;
      const c = clampInArena({ x: b.x, y: b.y });
      placeBumperFree(c.x, c.y, mkItem(b.type, b.value));
    });
    (s.inventory || []).forEach((it, i) => { if (it && TYPES[it.type] && i < INV_SLOTS) inventory[i] = mkItem(it.type, it.value); });
    return true;
  } catch (e) { try { localStorage.removeItem(SAVE_KEY); } catch (e2) {} return false; }
}
loadGame();
setInterval(saveGame, 3000);                                   // steady autosave
window.addEventListener("beforeunload", saveGame);             // ...and on the way out
window.addEventListener("pagehide", saveGame);                 // mobile Safari
document.addEventListener("visibilitychange", () => { if (document.hidden) saveGame(); });

refreshShops();
updateInventory();
updateStageUI();

// ---- Sound: bounce SFX (WebAudio — cheap overlapping one-shots) -------------
let audioCtx = null, bounceBuf = null, sndOn = true, lastSndAt = 0;
try { sndOn = localStorage.getItem("nf_snd") !== "0"; } catch (e) {}
function initAudio() {
  if (audioCtx) { if (audioCtx.state === "suspended") audioCtx.resume(); return; }
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    fetch("audio/bounce.mp3")
      .then((r) => r.arrayBuffer())
      .then((b) => audioCtx.decodeAudioData(b))
      .then((buf) => (bounceBuf = buf))
      .catch(() => {});
  } catch (e) {}
}
window.addEventListener("pointerdown", initAudio); // browsers unlock audio on a gesture
function playBounce(strength) {
  if (!sndOn || !bounceBuf) return;
  const now = performance.now();
  if (now - lastSndAt < 65) return;                // rate-limit the machine gun
  lastSndAt = now;
  const src = audioCtx.createBufferSource();
  src.buffer = bounceBuf;
  src.playbackRate.value = 0.85 + Math.random() * 0.4;  // organic pitch variety
  const g = audioCtx.createGain();
  g.gain.value = Math.min(0.6, 0.15 + strength * 0.45);
  src.connect(g); g.connect(audioCtx.destination);
  src.start();
}
const sndBtn = document.getElementById("sndbtn");
function updateSndBtn() { if (sndBtn) sndBtn.textContent = sndOn ? "🔊" : "🔇"; }
if (sndBtn) sndBtn.addEventListener("click", () => {
  sndOn = !sndOn;
  try { localStorage.setItem("nf_snd", sndOn ? "1" : "0"); } catch (e) {}
  updateSndBtn();
});
updateSndBtn();

// ---- Physics + render loop -------------------------------------------------
function bounceObstacle(n, ob, radius, restitution) {
  const dx = n.x - ob.x, dy = n.y - ob.y, rr = NUT_R + radius;
  if (dx * dx + dy * dy >= rr * rr) return false;
  const d = Math.sqrt(dx * dx + dy * dy) || 1e-4, nx = dx / d, ny = dy / d;
  n.x = ob.x + nx * rr; n.y = ob.y + ny * rr;
  const vn = n.vx * nx + n.vy * ny;
  n.vx = (n.vx - 2 * vn * nx) * restitution;
  n.vy = (n.vy - 2 * vn * ny) * restitution;
  return true;
}

let last = performance.now(), fpsAcc = 0, fpsN = 0, tSec = 0;
function frame(now) {
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.05) dt = 0.05;
  tSec += dt;
  squirrelKick = Math.max(0, squirrelKick - dt);
  const sk = squirrelKick / 0.3; // 1 -> 0 over the toss
  squirrel.position.y = SQ_Y - Math.sin(sk * Math.PI) * 0.3;
  squirrel.position.x += (squirrelTargetX - squirrel.position.x) * Math.min(1, dt * 8);
  squirrel.material.rotation = Math.sin(sk * Math.PI) * 0.35;
  const bumpGlow = 0.35 + 0.3 * Math.sin(tSec * 6);
  let nFun = 0; for (const b of bumpers) if (b.type === "funnel") nFun++;
  const fSteps = Math.max(42, 72 - Math.max(0, nFun - 3) * 10); // degrade march steps as funnels pile up
  for (const b of bumpers) {
    if (b.type === "bump") b.disc.material.emissiveIntensity = bumpGlow;
    else if (b.type === "funnel") animateTornado(b.disc, tSec, fSteps); // volumetric raymarch tornado
  }
  fpsAcc += dt; fpsN++;
  if (fpsAcc >= 0.5) { elFps.textContent = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; refreshShops(); }

  // Drop nuts from the top, capped by capacity.
  emitTimer -= dt;
  if (emitTimer <= 0) { emitTimer = flowInterval; spawnTop(); }

  const active = [];
  for (const n of nuts) if (n.active) active.push(n);

  // Integrate under gravity; bounce off pegs/modifiers/walls; bank at the bottom.
  for (const n of active) {
    if (n.cool > 0) n.cool -= dt;
    n.vy += GRAVITY * dt;
    n.x += n.vx * dt; n.y += n.vy * dt;

    for (const b of bumpers) {
      if (b === dragBumper) continue; // the modifier being dragged doesn't affect nuts
      if (b.type === "funnel") { // steer nuts toward the funnel's column (no bounce)
        const fdx = b.x - n.x, fdy = n.y - b.y;
        if (fdx * fdx + fdy * fdy < 4 && fdy > -0.4) n.vx += Math.sign(fdx) * 9 * dt;
        continue;
      }
      if (bounceObstacle(n, b, BUMP_R, BUMP_BOUNCE) && n.cool <= 0) {
        if (b.type === "add") n.value += b.value;
        else if (b.type === "mul") n.value = Math.round(n.value * b.value * 10) / 10;
        else if (b.type === "split") trySplit(n);
        else if (b.type === "bump") { const sp = Math.hypot(n.vx, n.vy) || 1, k = Math.min(VMAX, sp * 1.5) / sp; n.vx *= k; n.vy *= k; } // speed boost
        playBounce(Math.hypot(n.vx, n.vy) / VMAX);
        n.cool = 0.15;
      }
    }
    // Hard speed cap — keeps fast nuts from tunnelling through walls / flying off.
    const sp = Math.hypot(n.vx, n.vy); if (sp > VMAX) { const k = VMAX / sp; n.vx *= k; n.vy *= k; }
    // Side walls + a ceiling so a boosted nut can't escape upward.
    if (n.x < -HW + NUT_R) { n.x = -HW + NUT_R; if (Math.abs(n.vx) > 3) playBounce(Math.abs(n.vx) / VMAX * 0.6); n.vx = Math.abs(n.vx) * WALL_BOUNCE; }
    else if (n.x > HW - NUT_R) { n.x = HW - NUT_R; if (Math.abs(n.vx) > 3) playBounce(Math.abs(n.vx) / VMAX * 0.6); n.vx = -Math.abs(n.vx) * WALL_BOUNCE; }
    if (n.y > SPAWN_Y + 0.5) { n.y = SPAWN_Y + 0.5; n.vy = -Math.abs(n.vy) * WALL_BOUNCE; }
    // Bottom receiver -> bank value × lane multiplier × payout.
    if (n.y < DRAIN_Y) {
      const idx = Math.max(0, Math.min(LANES.length - 1, Math.floor((n.x + HW) / LANE_W)));
      const gain = n.value * LANES[idx].mult * GOAL_MULT; // exact, fractional — no rounding/min, no inflation
      score += gain; lifetime += gain; popup(n.x, DRAIN_Y + 0.25, "+" + fmtVal(gain), "gain");
      n.active = false; inPlay--;
    }
  }

  // Nut↔nut collisions (count is capped, so O(n²) is cheap).
  for (let i = 0; i < active.length; i++)
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i], b = active[j];
      const dx = b.x - a.x, dy = b.y - a.y, rr = NUT_R * 2;
      const d2 = dx * dx + dy * dy;
      if (d2 >= rr * rr || d2 === 0) continue;
      const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, overlap = (rr - d) / 2;
      a.x -= nx * overlap; a.y -= ny * overlap; b.x += nx * overlap; b.y += ny * overlap;
      const dvn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (dvn < 0) { const imp = dvn * 0.95; a.vx += imp * nx; a.vy += imp * ny; b.vx -= imp * nx; b.vy -= imp * ny; }
    }

  // Draw instances — value reads as colour + a touch of size.
  let count = 0;
  for (const n of active) {
    const grow = 1 + Math.min(0.22, (n.value - 1) / 220); // richer nuts look a touch fatter
    dummy.position.set(n.x, n.y, 0); dummy.rotation.z = n.x * 0.6;
    dummy.scale.setScalar(grow); dummy.updateMatrix();
    nutMesh.setMatrixAt(count, dummy.matrix);
    tmpCol.copy(colLow).lerp(colHigh, Math.min(1, (n.value - 1) / 150));
    nutMesh.setColorAt(count, tmpCol);
    if (count < MAX_LABELS) { // value number centered inside the nut
      const L = labels[count]; L.spr.visible = true;
      L.spr.position.set(n.x, n.y, 0.5);
      const txt = fmtVal(n.value);
      if (L.last !== txt) { drawNum(L, txt); L.last = txt; }
    }
    count++;
  }
  for (let i = count; i < MAX_LABELS; i++) labels[i].spr.visible = false;
  nutMesh.count = count;
  nutMesh.instanceMatrix.needsUpdate = true;
  if (nutMesh.instanceColor) nutMesh.instanceColor.needsUpdate = true;

  displayScore += (score - displayScore) * Math.min(1, dt * 10);
  if (Math.abs(score - displayScore) < 0.5) displayScore = score;
  elScore.textContent = fmtVal(Math.floor(displayScore));
  elNuts.textContent = inPlay + "/" + CAPACITY;
  updateStageBar();
  updateLaneButtons();
  if (composer) composer.render(); else renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ---- Optional eye-candy: env reflections + bloom (graceful if absent) ------
try {
  const { RoomEnvironment } = await import("three/addons/environments/RoomEnvironment.js");
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.6; // glossy sheen back, but Neutral tonemap keeps it from blowing out
} catch (e) { /* no env reflections — still fine */ }
try {
  const { EffectComposer } = await import("three/addons/postprocessing/EffectComposer.js");
  const { RenderPass } = await import("three/addons/postprocessing/RenderPass.js");
  const { UnrealBloomPass } = await import("three/addons/postprocessing/UnrealBloomPass.js");
  const { OutputPass } = await import("three/addons/postprocessing/OutputPass.js");
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.6, 0.9)); // strength, radius, threshold (subtle)
  composer.addPass(new OutputPass());
} catch (e) { composer = null; /* plain render */ }

// ---- Responsive resize -----------------------------------------------------
function resize() {
  const rect = arenaEl.getBoundingClientRect();
  const w = Math.max(1, rect.width), h = Math.max(1, rect.height);
  renderer.setSize(w, h); camera.aspect = w / h;
  const t = Math.tan((camera.fov * Math.PI) / 360);
  const distH = (HH + 1.5) / t;              // fit height + the squirrel on top
  const distW = (HW + 0.4) / (t * camera.aspect); // ...and the full width
  camera.position.z = Math.max(distH, distW);
  camera.updateProjectionMatrix();
  if (composer) composer.setSize(w, h);
  positionLaneButtons();
}
window.addEventListener("resize", resize);
if (window.ResizeObserver) new ResizeObserver(resize).observe(arenaEl);
resize();
requestAnimationFrame(frame);
