/* Flourish — the town in real 3D.
   Loaded as a module; if anything here fails the app quietly keeps its
   2D renderer, so the game never depends on WebGL being available. */
import * as THREE from "./vendor/three.module.min.js";

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const rad = (d) => (d * Math.PI) / 180;

let renderer, scene, camera, sun, hemi, skyMat, ground;
let playerRig, playerParts, figures = {}, buildingMeshes = [], pickables = [];
let ready = false, canvasEl = null, camPos = V3(0, 60, 400);
const clock = { last: 0 };

/* ---------- materials & geometry helpers ---------- */
const stdMat = (color, opts = {}) =>
  new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: opts.rough ?? 0.85,
    metalness: opts.metal ?? 0.03,
    emissive: new THREE.Color(opts.emissive || "#000000"),
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    flatShading: !!opts.flat,
  });

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y + h / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
function cone(r, h, mat, x = 0, y = 0, z = 0, seg = 4) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), mat);
  m.position.set(x, y + h / 2, z);
  m.rotation.y = Math.PI / 4;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
function cyl(rt, rb, h, mat, x = 0, y = 0, z = 0, seg = 12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y + h / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/* ---------- the sky ---------- */
const SKY_VERT = `varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;
const SKY_FRAG = `
uniform vec3 top; uniform vec3 bottom; uniform float horizon;
varying vec3 vP;
void main(){
  float hgt = normalize(vP).y;
  float k = smoothstep(-0.15, 0.55, hgt);
  vec3 c = mix(bottom, top, k);
  float glow = pow(max(0.0, 1.0 - abs(hgt - 0.02) * 6.0), 2.0) * horizon;
  gl_FragColor = vec4(c + vec3(glow * 0.25, glow * 0.16, glow * 0.05), 1.0);
}`;

/* ---------- a low-poly person ---------- */
function makeFigure(look) {
  const g = new THREE.Group();
  const skin = stdMat(look.skin || "#C98A5E", { rough: 0.95 });
  const cloth = stdMat(look.outfit || "#45D5EC", { rough: 0.9 });
  const dark = stdMat("#1E2A44", { rough: 0.95 });
  const hair = stdMat(look.hair || "#2A1C14", { rough: 1 });

  const legL = box(2.4, 6.4, 2.4, dark, -1.6, 0, 0);
  const legR = box(2.4, 6.4, 2.4, dark, 1.6, 0, 0);
  const torso = box(7, 7, 4, cloth, 0, 6.4, 0);
  const armL = box(1.9, 6, 1.9, cloth, -4.4, 6.6, 0);
  const armR = box(1.9, 6, 1.9, cloth, 4.4, 6.6, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(2.9, 14, 12), skin);
  head.position.set(0, 16.4, 0);
  head.castShadow = true;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(3.0, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hair);
  cap.position.set(0, 16.7, 0);
  cap.castShadow = true;

  g.add(legL, legR, torso, armL, armR, head, cap);

  // gear
  if (look.gear) {
    if (look.gear.head === "helm" || look.gear.head === "crown") {
      const helm = new THREE.Mesh(
        new THREE.SphereGeometry(3.2, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.6),
        stdMat(look.gear.head === "crown" ? "#F0C548" : "#B9C4D6", { metal: 0.7, rough: 0.35 })
      );
      helm.position.set(0, 16.6, 0);
      helm.castShadow = true;
      g.add(helm);
    }
    if (look.gear.body && look.gear.body !== "none") {
      const arm = box(7.6, 5.4, 4.6, stdMat("#98A3B5", { metal: 0.6, rough: 0.4 }), 0, 7.2, 0);
      g.add(arm);
    }
    if (look.gear.hand && look.gear.hand !== "none") {
      const grip = box(0.8, 4, 0.8, stdMat("#4A3524"), 5.4, 5.6, 0);
      const blade = box(0.9, 12, 2.6, stdMat("#DCE6F2", { metal: 0.85, rough: 0.22 }), 5.4, 9.4, 0);
      g.add(grip, blade);
    }
    if (look.gear.back && look.gear.back !== "none") {
      const cape = box(7.4, 10, 0.6, stdMat(look.gear.back === "champ" ? "#E4B23C" : "#2F4A70", { rough: 1 }), 0, 4.4, -2.6);
      g.add(cape);
    }
  }
  return { group: g, legL, legR, armL, armR, torso };
}
function animateFigure(parts, walk, t) {
  const s = walk ? Math.sin(walk) : 0;
  parts.legL.rotation.x = s * 0.7;
  parts.legR.rotation.x = -s * 0.7;
  parts.armL.rotation.x = -s * 0.5;
  parts.armR.rotation.x = s * 0.5;
  parts.group.position.y = walk ? Math.abs(Math.sin(walk)) * 0.7 : Math.sin(t * 1.6) * 0.25;
}

/* ---------- buildings ---------- */
function makeBuilding(def, color) {
  const g = new THREE.Group();
  const wallC = new THREE.Color(color).lerp(new THREE.Color("#E8E0CE"), 0.55);
  const wall = stdMat("#" + wallC.getHexString(), { rough: 0.92 });
  const trim = stdMat(color, { rough: 0.7 });
  const roof = stdMat("#A8442C", { rough: 0.85 });
  const glass = stdMat("#20304A", { emissive: color, emissiveIntensity: 0.55, rough: 0.5 });

  g.add(box(56, 5, 48, trim, 0, 0, 0));       // plinth
  g.add(box(50, 4, 43, wall, 0, 5, 0));
  const kind = def.kind === "arcade" ? "arcade" : def.pid;

  if (kind === "spiritual") {
    g.add(box(30, 14, 30, wall, 0, 9, 0));
    g.add(box(20, 60, 20, wall, 0, 23, 0));
    g.add(box(26, 6, 26, trim, 0, 83, 0));
    g.add(cone(19, 26, roof, 0, 89, 0));
    g.add(box(4, 5, 4, glass, 0, 115, 0));
  } else if (kind === "mental") {
    g.add(box(38, 16, 38, wall, 0, 9, 0));
    g.add(cyl(15, 17, 34, wall, 0, 25, 0, 14));
    const dome = new THREE.Mesh(new THREE.SphereGeometry(16, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), trim);
    dome.position.set(0, 59, 0);
    dome.castShadow = true;
    g.add(dome);
  } else if (kind === "intellectual") {
    g.add(box(56, 8, 44, wall, 0, 9, 0));
    for (let i = -2; i <= 2; i++) g.add(cyl(3, 3.4, 30, wall, i * 11, 17, -19, 10));
    g.add(box(58, 8, 46, wall, 0, 47, 0));
    g.add(cone(34, 16, roof, 0, 55, 0));
  } else if (kind === "emotional") {
    g.add(box(11, 44, 11, wall, -18, 9, 0));
    g.add(box(11, 44, 11, wall, 18, 9, 0));
    g.add(box(52, 9, 13, trim, 0, 53, 0));
    const orb = new THREE.Mesh(new THREE.SphereGeometry(7, 16, 14), stdMat(color, { emissive: color, emissiveIntensity: 1.4, rough: 0.3 }));
    orb.position.set(0, 32, 0);
    g.add(orb);
    g.userData.orb = orb;
  } else if (kind === "arcade") {
    g.add(box(46, 34, 40, wall, 0, 9, 0));
    g.add(box(52, 5, 46, trim, 0, 43, 0));
    g.add(cone(33, 20, roof, 0, 48, 0));
    const die = box(9, 9, 9, stdMat("#F2F6FF", { rough: 0.4 }), 0, 72, 0);
    g.add(die);
    g.userData.die = die;
  } else {
    g.add(box(46, 32, 40, wall, 0, 9, 0));
    g.add(box(52, 5, 46, trim, 0, 41, 0));
    g.add(cone(33, 18, roof, 0, 46, 0));
    g.add(box(9, 44, 9, wall, 16, 46, -12));   // chimney
  }
  // door + windows
  g.add(box(10, 16, 1.5, glass, 0, 9, -21.6));
  for (let i = -1; i <= 1; i++) g.add(box(5, 7, 1.2, glass, i * 14, 24, -21.6));

  g.position.set(def.x, 0, def.z);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData.id = def.kind === "arcade" ? "arcade" : def.pid;
  return g;
}

function makeTree(x, z, cypress) {
  const g = new THREE.Group();
  g.add(cyl(2, 2.6, cypress ? 12 : 18, stdMat("#4A3524"), 0, 0, 0, 8));
  if (cypress) g.add(cone(7, 58, stdMat("#1F3D2A", { rough: 1 }), 0, 10, 0, 8));
  else {
    const leaf = stdMat("#2E5D46", { rough: 1 });
    [[0, 20, 14], [-8, 14, 10], [9, 15, 10]].forEach(([dx, dy, r]) => {
      const s = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), leaf);
      s.position.set(dx, 18 + dy, 0);
      s.castShadow = true;
      g.add(s);
    });
  }
  g.position.set(x, 0, z);
  return g;
}

/* ---------- build the world ---------- */
function build(opts) {
  scene = new THREE.Scene();

  const skyGeo = new THREE.SphereGeometry(2600, 24, 16);
  skyMat = new THREE.ShaderMaterial({
    uniforms: { top: { value: new THREE.Color("#3E7FB8") }, bottom: { value: new THREE.Color("#F0C48A") }, horizon: { value: 0.5 } },
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false,
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));
  scene.fog = new THREE.Fog(0xbfd0e0, 700, 2300);

  hemi = new THREE.HemisphereLight(0xbfd8ff, 0x2c3a28, 0.75);
  scene.add(hemi);
  sun = new THREE.DirectionalLight(0xffe6bd, 2.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera;
  sc.near = 10; sc.far = 900; sc.left = -340; sc.right = 340; sc.top = 340; sc.bottom = -340;
  sun.shadow.bias = -0.0012;
  scene.add(sun, sun.target);

  ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), stdMat("#33543C", { rough: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const road = new THREE.Mesh(new THREE.PlaneGeometry(130, 900), stdMat("#8E8579", { rough: 1 }));
  road.rotation.x = -Math.PI / 2; road.position.set(0, 0.2, 40); road.receiveShadow = true;
  scene.add(road);
  const cross = new THREE.Mesh(new THREE.PlaneGeometry(620, 110), stdMat("#8E8579", { rough: 1 }));
  cross.rotation.x = -Math.PI / 2; cross.position.set(0, 0.21, 65); cross.receiveShadow = true;
  scene.add(cross);

  // fountain
  const f = new THREE.Group();
  f.add(cyl(30, 32, 7, stdMat("#8B8478", { rough: 0.9 }), 0, 0, 0, 20));
  const water = new THREE.Mesh(new THREE.CircleGeometry(27, 24), stdMat("#3E9FC4", { rough: 0.15, metal: 0.35, emissive: "#10384A", emissiveIntensity: 0.4 }));
  water.rotation.x = -Math.PI / 2; water.position.y = 7.4;
  f.add(water);
  f.add(cyl(3, 5, 22, stdMat("#8B8478"), 0, 7, 0, 10));
  f.position.set(0, 0, 65);
  f.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  scene.add(f);

  // buildings
  buildingMeshes = []; pickables = [];
  opts.town.forEach((def) => {
    const color = def.kind === "arcade" ? opts.arcadeColor : opts.colors[def.pid];
    const g = makeBuilding(def, color);
    scene.add(g);
    buildingMeshes.push(g);
    g.traverse((o) => { if (o.isMesh) { o.userData.id = g.userData.id; pickables.push(o); } });
  });

  // greenery + skyline
  [[-100, 240, 1], [100, 240, 1], [-100, -20, 0], [100, -20, 0], [-100, -170, 1], [100, -170, 1],
   [-250, 30, 0], [250, 30, 0], [-250, -140, 1], [250, -140, 1], [-250, 220, 0], [250, 220, 0]]
    .forEach(([x, z, cy2]) => scene.add(makeTree(x, z, !!cy2)));

  [-330, 330].forEach((x) => {
    const g = new THREE.Group();
    g.add(box(40, 10, 40, stdMat("#C9BCA0"), 0, 0, 0));
    g.add(box(30, 150, 30, stdMat("#D3C7AC"), 0, 10, 0));
    g.add(box(36, 8, 36, stdMat("#C9BCA0"), 0, 160, 0));
    g.add(cone(26, 44, stdMat("#A8442C"), 0, 168, 0));
    g.position.set(x, 0, -560);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    scene.add(g);
  });

  // the Spire on the horizon
  const spire = new THREE.Group();
  const tiers = opts.tierOrder.map((pid, i) => {
    const half = 200 * (1 - (i / 5) * 0.78);
    const m = box(half * 2, 46, half * 2, stdMat(opts.colors[pid], { rough: 0.8 }), 0, i * 50, 0);
    spire.add(m);
    return m;
  });
  spire.position.set(0, 0, -1250);
  spire.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  scene.add(spire);
  scene.userData.tiers = tiers;

  // the player
  const pf = makeFigure(opts.avatar);
  playerRig = pf.group; playerParts = pf;
  scene.add(playerRig);

  camera = new THREE.PerspectiveCamera(46, 1, 1, 3000);
  scene.add(camera);
}

/* ---------- public api ---------- */
function init(opts) {
  canvasEl = opts.canvas;
  renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  build(opts);
  ready = true;
}

function setAvatar(look) {
  if (!playerRig) return;
  scene.remove(playerRig);
  const pf = makeFigure(look);
  playerRig = pf.group; playerParts = pf;
  scene.add(playerRig);
}

function frame(s) {
  if (!ready) return;
  const w = canvasEl.clientWidth, h = canvasEl.clientHeight;
  if (!w || !h) return;
  if (canvasEl.width !== Math.floor(w * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  // time of day
  const sky = s.sky;
  skyMat.uniforms.top.value.set(sky.top);
  skyMat.uniforms.bottom.value.set(sky.bottom);
  skyMat.uniforms.horizon.value = sky.night ? 0.15 : 0.8;
  scene.fog.color.set(sky.fog);
  scene.fog.near = sky.night ? 500 : 700;
  scene.fog.far = sky.night ? 1700 : 2300;
  hemi.intensity = sky.night ? 0.42 : 0.95;
  hemi.color.set(sky.night ? "#5d74a8" : "#bfd8ff");
  sun.color.set(sky.sun);
  sun.intensity = sky.night ? 0.35 : 2.1;
  renderer.toneMappingExposure = sky.night ? 0.88 : 1.06;

  // player
  playerRig.position.set(s.player.x, 0, s.player.z);
  playerRig.rotation.y = s.player.face < 0 ? rad(200) : rad(-20);
  if (s.player.moving) playerRig.rotation.y = Math.atan2(s.player.dx || 0, s.player.dz || 1);
  animateFigure(playerParts, s.player.walk, s.t);

  // townsfolk
  (s.agents || []).forEach((a) => {
    let fig = figures[a.id];
    if (!fig) {
      fig = makeFigure(a.look);
      figures[a.id] = fig;
      scene.add(fig.group);
    }
    fig.group.position.set(a.x, 0, a.z);
    fig.group.rotation.y = Math.atan2(a.dx || 0, a.dz || 1);
    animateFigure(fig, a.walk, s.t);
  });

  // buildings react to your day
  buildingMeshes.forEach((g) => {
    const lit = s.lit && s.lit[g.userData.id];
    if (g.userData.die) { g.userData.die.rotation.y = s.t * 0.9; g.userData.die.rotation.x = Math.sin(s.t) * 0.3; }
    if (g.userData.orb) {
      const k = 1.1 + Math.sin(s.t * 4) * 0.25;
      g.userData.orb.scale.setScalar(k);
      g.userData.orb.material.emissiveIntensity = lit ? 2.2 : 1.0;
    }
    g.traverse((o) => {
      if (o.isMesh && o.material && o.material.emissive && o.material.emissiveIntensity !== undefined && !g.userData.orb) {
        // only the glass panels carry emissive
      }
    });
  });

  // spire tiers glow with progress
  (scene.userData.tiers || []).forEach((m, i) => {
    const v = (s.tierScore && s.tierScore[i]) || 0;
    m.material.emissive.set(m.material.color);
    m.material.emissiveIntensity = 0.55 + v * 0.8;
  });

  // camera trails you
  const want = V3(s.player.x + 30, 132, s.player.z + 238);
  camPos.lerp(want, Math.min(1, s.dt * 3.2));
  camera.position.copy(camPos);
  camera.lookAt(s.player.x, 62, s.player.z - 170);

  // sun follows so shadows stay crisp near you
  sun.position.set(s.player.x - 270, 350, s.player.z + 210);
  sun.target.position.set(s.player.x, 0, s.player.z);
  sun.target.updateMatrixWorld();

  renderer.render(scene, camera);
}

function pick(nx, ny) {
  if (!ready) return null;
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(nx, ny), camera);
  const hits = ray.intersectObjects(pickables, false);
  return hits.length ? hits[0].object.userData.id : null;
}

window.World3D = { init, frame, pick, setAvatar, get ok() { return ready; } };
window.dispatchEvent(new Event("world3d-ready"));
