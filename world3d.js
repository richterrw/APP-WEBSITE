/* Flourish — the town in real 3D.
   Loaded as a module; if anything here fails the app quietly keeps its
   2D renderer, so the game never depends on WebGL being available. */
import * as THREE from "./vendor/three.module.min.js";
import { EffectComposer } from "./vendor/pp/EffectComposer.js";
import { RenderPass } from "./vendor/pp/RenderPass.js";
import { UnrealBloomPass } from "./vendor/pp/UnrealBloomPass.js";
import { OutputPass } from "./vendor/pp/OutputPass.js";
import { RoomEnvironment } from "./vendor/env/RoomEnvironment.js";

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const rad = (d) => (d * Math.PI) / 180;

let renderer, scene, camera, sun, hemi, skyMat, ground, composer, bloom;
let lamps = [], starField = null, envRT = null;
let playerRig, playerParts, figures = {}, buildingMeshes = [], pickables = [];
let ready = false, canvasEl = null, camPos = V3(0, 60, 400);
const clock = { last: 0 };

/* ---------- procedural textures (drawn at runtime, no assets) ---------- */
const texCache = {};
function makeTex(key, size, draw, repeat) {
  if (texCache[key]) return texCache[key];
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d"), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 4;
  texCache[key] = t;
  return t;
}
function normalTex(key, size, drawHeight, strength, repeat) {
  if (texCache[key + "_n"]) return texCache[key + "_n"];
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const x = c.getContext("2d");
  drawHeight(x, size);
  const src = x.getImageData(0, 0, size, size).data;
  const out = x.createImageData(size, size);
  const H = (i, j) => {
    i = (i + size) % size; j = (j + size) % size;
    const k = (j * size + i) * 4;
    return (src[k] + src[k + 1] + src[k + 2]) / 765;
  };
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const dx = H(i + 1, j) - H(i - 1, j), dy = H(i, j + 1) - H(i, j - 1);
    let nx = -dx * strength, ny = -dy * strength, nz = 1;
    const l = Math.hypot(nx, ny, nz);
    const k = (j * size + i) * 4;
    out.data[k] = ((nx / l) * 0.5 + 0.5) * 255;
    out.data[k + 1] = ((ny / l) * 0.5 + 0.5) * 255;
    out.data[k + 2] = ((nz / l) * 0.5 + 0.5) * 255;
    out.data[k + 3] = 255;
  }
  x.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 4;
  texCache[key + "_n"] = t;
  return t;
}
function noiseWash(x, size, base, amt) {
  for (let i = 0; i < size * size * 0.16; i++) {
    const px = Math.random() * size, py = Math.random() * size;
    const v = (Math.random() - 0.5) * amt;
    x.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 255})`;
    x.fillRect(px, py, 2, 2);
  }
}
function plasterDraw(tint) {
  return (x, s) => {
    x.fillStyle = tint; x.fillRect(0, 0, s, s);
    for (let i = 0; i < 26; i++) {                       // damp patches and staining
      x.fillStyle = `rgba(120,108,88,${0.03 + Math.random() * 0.07})`;
      x.beginPath(); x.ellipse(Math.random() * s, Math.random() * s, 12 + Math.random() * 40, 10 + Math.random() * 30, Math.random(), 0, 7); x.fill();
    }
    for (let i = 0; i < 9; i++) {                        // hairline cracks
      x.strokeStyle = `rgba(70,60,48,${0.10 + Math.random() * 0.14})`;
      x.lineWidth = 0.7 + Math.random();
      let px = Math.random() * s, py = Math.random() * s;
      x.beginPath(); x.moveTo(px, py);
      for (let k = 0; k < 7; k++) { px += (Math.random() - 0.5) * 22; py += Math.random() * 14; x.lineTo(px, py); }
      x.stroke();
    }
    noiseWash(x, s, tint, 30);
  };
}
function texPlaster(tint) { return makeTex("plaster" + tint, 256, plasterDraw(tint), [2, 2]); }
function nrmPlaster() { return normalTex("plaster", 256, plasterDraw("#808080"), 1.5, [2, 2]); }
function ashlarDraw(color) {
  return (x, s) => {
    x.fillStyle = color; x.fillRect(0, 0, s, s);
    const rows = 8, hgt = s / rows;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * (s / 10);
      for (let c = -1; c < 5; c++) {
        const w = s / 4.4, xx = off + c * w;
        const g = 176 + Math.random() * 34;
        x.fillStyle = `rgb(${g},${g - 7},${g - 21})`;
        x.fillRect(xx + 2, r * hgt + 2, w - 4, hgt - 4);
        x.fillStyle = `rgba(0,0,0,${0.04 + Math.random() * 0.06})`;
        x.fillRect(xx + 2, r * hgt + hgt - 6, w - 4, 4);
      }
    }
    for (let i = 0; i < 40; i++) {
      x.fillStyle = `rgba(90,80,64,${0.03 + Math.random() * 0.05})`;
      x.beginPath(); x.ellipse(Math.random() * s, Math.random() * s, 6 + Math.random() * 16, 4 + Math.random() * 10, Math.random(), 0, 7); x.fill();
    }
    noiseWash(x, s, color, 26);
  };
}
function texStone() { return makeTex("stone", 256, ashlarDraw("#B9AF9A"), [2, 2]); }
function nrmStone() { return normalTex("stone", 256, ashlarDraw("#808080"), 2.6, [2, 2]); }
function tileDraw(flat) {
  return (x, s) => {
    x.fillStyle = "#9C3F27"; x.fillRect(0, 0, s, s);
    const rows = 7, hgt = s / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < 9; c++) {
        const w = s / 9, xx = c * w + (r % 2) * (w / 2);
        const g = 150 + Math.random() * 60;
        x.fillStyle = `rgb(${g + 40},${g - 40},${g - 70})`;
        x.beginPath();
        x.moveTo(xx, r * hgt + hgt);
        x.quadraticCurveTo(xx + w / 2, r * hgt - hgt * 0.35, xx + w, r * hgt + hgt);
        x.fill();
      }
    }
    noiseWash(x, s, "#9C3F27", 34);
  };
}
function texTile() { return makeTex("tile", 256, tileDraw(false), [3, 3]); }
function nrmTile() { return normalTex("tile", 256, tileDraw(true), 3.2, [3, 3]); }
function cobbleDraw() {
  return (x, s) => {
    x.fillStyle = "#6F675C"; x.fillRect(0, 0, s, s);
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      const w = s / 9, off = (r % 2) * (w / 2);
      const g = 128 + Math.random() * 52;
      x.fillStyle = `rgb(${g},${g - 6},${g - 16})`;
      x.beginPath();
      x.ellipse(c * w + off + w / 2, r * w + w / 2, w * 0.42, w * 0.36, Math.random(), 0, 7);
      x.fill();
    }
    noiseWash(x, s, "#6F675C", 30);
  };
}
function texCobble() { return makeTex("cobble", 256, cobbleDraw(), [7, 22]); }
function nrmCobble() { return normalTex("cobble", 256, cobbleDraw(), 3.6, [7, 22]); }
function texGrass() {
  return makeTex("grass", 256, (x, s) => {
    x.fillStyle = "#33553A"; x.fillRect(0, 0, s, s);
    for (let i = 0; i < 40; i++) {                       // patches of dry and lush
      x.fillStyle = Math.random() > 0.5 ? "rgba(120,116,70,.18)" : "rgba(46,92,58,.24)";
      x.beginPath(); x.ellipse(Math.random() * s, Math.random() * s, 20 + Math.random() * 60, 14 + Math.random() * 44, Math.random(), 0, 7); x.fill();
    }
    for (let i = 0; i < 5200; i++) {
      const g = 46 + Math.random() * 66;
      x.fillStyle = `rgb(${g - 14},${g + 28},${g - 8})`;
      x.fillRect(Math.random() * s, Math.random() * s, 1.6, 3.4);
    }
  }, [34, 34]);
}
function sandDraw(color) {
  return (x, s) => {
    x.fillStyle = color; x.fillRect(0, 0, s, s);
    const rows = 14, hgt = s / rows;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * (s / 12);
      for (let c = -1; c < 7; c++) {
        const w = s / 6, xx = off + c * w;
        const g = 190 + Math.random() * 34;
        x.fillStyle = `rgb(${g},${g - 18},${g - 48})`;
        x.fillRect(xx + 1.5, r * hgt + 1.5, w - 3, hgt - 3);
      }
    }
    for (let i = 0; i < 60; i++) {                    // wind weathering
      x.fillStyle = `rgba(150,120,80,${0.03 + Math.random() * 0.06})`;
      x.beginPath(); x.ellipse(Math.random() * s, Math.random() * s, 10 + Math.random() * 30, 3 + Math.random() * 8, 0, 0, 7); x.fill();
    }
    noiseWash(x, s, color, 28);
  };
}
function texSand() { return makeTex("sand", 256, sandDraw("#C8A66C"), [7, 7]); }
function nrmSand() { return normalTex("sand", 256, sandDraw("#808080"), 2.2, [7, 7]); }
function bumpFrom(tex, key) {
  return makeTex(key + "_b", 128, (x, s) => { x.fillStyle = "#808080"; x.fillRect(0, 0, s, s); noiseWash(x, s, "#808080", 90); }, tex.repeat.toArray());
}

/* ---------- materials & geometry helpers ---------- */
const stdMat = (color, opts = {}) => {
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: opts.rough ?? 0.85,
    metalness: opts.metal ?? 0.03,
    emissive: new THREE.Color(opts.emissive || "#000000"),
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    flatShading: !!opts.flat,
  });
  if (opts.map) m.map = opts.map;
  if (opts.normal) { m.normalMap = opts.normal; m.normalScale = new THREE.Vector2(opts.nScale ?? 1, opts.nScale ?? 1); }
  if (opts.envInt !== undefined) m.envMapIntensity = opts.envInt;
  return m;
};

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
  const skin = stdMat(look.skin || "#C98A5E", { rough: 0.72, envInt: 0.5 });
  const cloth = stdMat(look.outfit || "#45D5EC", { rough: 0.85, envInt: 0.45 });
  const dark = stdMat("#28324A", { rough: 0.9, envInt: 0.4 });
  const boot = stdMat("#3A2E24", { rough: 0.85, envInt: 0.4 });
  const hair = stdMat(look.hair || "#2A1C14", { rough: 0.95, envInt: 0.3 });
  const cap = (r, h, mat) => { const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, h, 6, 12), mat); m.castShadow = true; m.receiveShadow = true; return m; };

  const legL = cap(1.35, 5.2, dark); legL.position.set(-1.7, 5.0, 0);
  const legR = cap(1.35, 5.2, dark); legR.position.set(1.7, 5.0, 0);
  const footL = box(2.8, 1.5, 4.2, boot, -1.7, 0.1, 0.6);
  const footR = box(2.8, 1.5, 4.2, boot, 1.7, 0.1, 0.6);

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(2.9, 3.5, 7.4, 14), cloth);
  torso.position.set(0, 11.4, 0); torso.castShadow = true; torso.receiveShadow = true;
  const shoulders = cap(3.2, 1.6, cloth); shoulders.rotation.z = Math.PI / 2; shoulders.position.set(0, 14.4, 0);
  const hips = cap(2.9, 1.2, dark); hips.rotation.z = Math.PI / 2; hips.position.set(0, 8.2, 0);

  const armL = cap(1.05, 4.6, cloth); armL.position.set(-4.2, 11.6, 0);
  const armR = cap(1.05, 4.6, cloth); armR.position.set(4.2, 11.6, 0);
  const handL = new THREE.Mesh(new THREE.SphereGeometry(1.15, 10, 8), skin); handL.position.set(-4.2, 8.5, 0);
  const handR = new THREE.Mesh(new THREE.SphereGeometry(1.15, 10, 8), skin); handR.position.set(4.2, 8.5, 0);

  const neck = cap(0.95, 1.1, skin); neck.position.set(0, 15.7, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(2.5, 20, 16), skin);
  head.scale.set(1, 1.12, 0.94); head.position.set(0, 18.0, 0); head.castShadow = true;
  const crown = new THREE.Mesh(new THREE.SphereGeometry(2.62, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), hair);
  crown.scale.set(1, 1.1, 0.98); crown.position.set(0, 18.1, 0); crown.castShadow = true;

  [legL, legR, torso, shoulders, hips, armL, armR, handL, handR, neck, head, crown].forEach((m) => { m.castShadow = true; m.receiveShadow = true; });
  g.add(legL, legR, footL, footR, hips, torso, shoulders, armL, armR, handL, handR, neck, head, crown);

  if (look.gear) {
    if (look.gear.head === "helm" || look.gear.head === "crown") {
      const helm = new THREE.Mesh(new THREE.SphereGeometry(2.78, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.66),
        stdMat(look.gear.head === "crown" ? "#E7C255" : "#AEB9CC", { metal: 0.85, rough: 0.28, envInt: 1.4 }));
      helm.scale.set(1, 1.08, 1); helm.position.set(0, 18.1, 0); helm.castShadow = true;
      g.add(helm);
    }
    if (look.gear.body && look.gear.body !== "none") {
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.7, 6.2, 14),
        stdMat("#9AA6B8", { metal: 0.8, rough: 0.32, envInt: 1.3 }));
      plate.position.set(0, 11.6, 0); plate.castShadow = true;
      g.add(plate);
    }
    if (look.gear.hand && look.gear.hand !== "none") {
      const grip = cap(0.42, 3.0, stdMat("#4A3524", { rough: 0.9 })); grip.position.set(5.0, 8.6, 0);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.7, 13, 2.2),
        stdMat("#E2EAF4", { metal: 0.92, rough: 0.16, envInt: 1.6 }));
      blade.position.set(5.0, 16.5, 0); blade.castShadow = true;
      g.add(grip, blade);
    }
    if (look.gear.back && look.gear.back !== "none") {
      const capeMat = stdMat(look.gear.back === "champ" ? "#C79A2E" : "#2F4A70", { rough: 0.95, envInt: 0.4 });
      const cape = new THREE.Mesh(new THREE.CylinderGeometry(3.0, 4.4, 10, 12, 1, true, Math.PI * 0.82, Math.PI * 1.36), capeMat);
      cape.material.side = THREE.DoubleSide;
      cape.position.set(0, 11.0, 0.2); cape.castShadow = true;
      g.add(cape);
    }
  }
  return { group: g, legL, legR, armL, armR, torso, footL, footR, handL, handR };
}
function animateFigure(parts, walk, t) {
  const s = walk ? Math.sin(walk) : 0;
  const sw = s * 3.1;
  parts.legL.position.z = sw; parts.legR.position.z = -sw;
  if (parts.footL) { parts.footL.position.z = 0.6 + sw * 1.06; parts.footR.position.z = 0.6 - sw * 1.06; }
  parts.legL.rotation.x = s * 0.42; parts.legR.rotation.x = -s * 0.42;
  parts.armL.position.z = -sw * 0.8; parts.armR.position.z = sw * 0.8;
  if (parts.handL) { parts.handL.position.z = -sw * 0.95; parts.handR.position.z = sw * 0.95; }
  parts.armL.rotation.x = -s * 0.34; parts.armR.rotation.x = s * 0.34;
  parts.group.position.y = walk ? Math.abs(Math.sin(walk)) * 0.55 : Math.sin(t * 1.6) * 0.22;
  parts.group.rotation.z = walk ? Math.sin(walk) * 0.02 : 0;
}

/* ---------- buildings ---------- */
function makeBuilding(def, color) {
  const g = new THREE.Group();
  const wallC = new THREE.Color(color).lerp(new THREE.Color("#D9CFBA"), 0.86);   // a whisper of the sector hue
  const wall = stdMat("#" + wallC.getHexString(), { rough: 0.95, metal: 0.0,
    map: texPlaster("#DCD2BE"), normal: nrmPlaster(), nScale: 1.1, envInt: 0.5 });
  const trim = stdMat("#A99E88", { rough: 0.88, metal: 0.02,
    map: texStone(), normal: nrmStone(), nScale: 1.3, envInt: 0.55 });
  const roof = stdMat("#9E4A31", { rough: 0.9, metal: 0.0,
    map: texTile(), normal: nrmTile(), nScale: 1.5, envInt: 0.4 });
  const accent = stdMat(color, { rough: 0.55, metal: 0.25, envInt: 0.9 });
  const glass = stdMat("#20304A", { emissive: color, emissiveIntensity: 0.55, rough: 0.5 });

  g.add(box(56, 5, 48, trim, 0, 0, 0));       // plinth
  g.add(box(52, 3, 45, trim, 0, 5, 0));       // step
  g.add(box(50, 3, 43, wall, 0, 8, 0));
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
  g.add(groundAO(46));
  g.userData.id = def.kind === "arcade" ? "arcade" : def.pid;
  return g;
}

function makeTree(x, z, cypress) {
  const g = new THREE.Group();
  const bark = stdMat("#4E3A28", { rough: 0.98, envInt: 0.3 });
  if (cypress) {
    g.add(cyl(1.8, 2.6, 14, bark, 0, 0, 0, 8));
    const dark = stdMat("#24422E", { rough: 1, envInt: 0.25 });
    const mid = stdMat("#2C5137", { rough: 1, envInt: 0.25 });
    [[9.5, 30, 12, dark], [8.0, 26, 27, mid], [6.2, 22, 41, dark], [4.2, 17, 54, mid]]
      .forEach(([r, h, y, m]) => { const c = cone(r, h, m, 0, y, 0, 10); c.castShadow = true; g.add(c); });
  } else {
    g.add(cyl(2.1, 3.0, 20, bark, 0, 0, 0, 10));
    const tones = ["#2F5C41", "#356647", "#28513A"];
    [[0, 34, 15], [-9, 28, 11], [9.5, 29, 11.5], [2, 44, 9], [-5, 39, 9.5]]
      .forEach(([dx, dy, r], i) => {
        const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), stdMat(tones[i % 3], { rough: 1, envInt: 0.28 }));
        m.position.set(dx, dy, (i % 2 ? 3 : -3));
        m.scale.set(1, 0.86, 1);
        m.castShadow = true; m.receiveShadow = true;
        g.add(m);
      });
  }
  g.add(groundAO(cypress ? 13 : 21));
  g.position.set(x, 0, z);
  g.rotation.y = Math.random() * 6.28;
  return g;
}
/* a soft dark patch that grounds anything standing on the ground */
let aoTex = null;
function groundAO(radius) {
  if (!aoTex) {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const x = c.getContext("2d");
    const gr = x.createRadialGradient(64, 64, 4, 64, 64, 64);
    gr.addColorStop(0, "rgba(0,0,0,.5)"); gr.addColorStop(0.55, "rgba(0,0,0,.22)"); gr.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    aoTex = new THREE.CanvasTexture(c);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2),
    new THREE.MeshBasicMaterial({ map: aoTex, transparent: true, depthWrite: false, opacity: 0.85 }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.35; m.renderOrder = 1;
  return m;
}

/* ---------- build the world ---------- */
function build(opts) {
  scene = new THREE.Scene();

  const skyGeo = new THREE.SphereGeometry(2600, 24, 16);
  skyMat = new THREE.ShaderMaterial({
    uniforms: { top: { value: new THREE.Color("#3E7FB8") }, bottom: { value: new THREE.Color("#F0C48A") }, horizon: { value: 0.5 } },
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false,
  });
  const skyMesh = new THREE.Mesh(skyGeo, skyMat);
  skyMesh.renderOrder = -1;
  skyMesh.frustumCulled = false;
  scene.add(skyMesh);
  scene.userData.skyMesh = skyMesh;
  scene.fog = new THREE.Fog(0xbfd0e0, 900, 3400);

  hemi = new THREE.HemisphereLight(0xbfd8ff, 0x2c3a28, 0.28);
  scene.add(hemi);
  sun = new THREE.DirectionalLight(0xffe6bd, 1.75);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.near = 10; sc.far = 1200; sc.left = -420; sc.right = 420; sc.top = 420; sc.bottom = -420;
  sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);

  ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), stdMat("#5A7F55", { rough: 1, map: texGrass(), envInt: 0.35 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const road = new THREE.Mesh(new THREE.PlaneGeometry(130, 1100), stdMat("#9A9186", { rough: 0.96, map: texCobble(), normal: nrmCobble(), nScale: 1.6, envInt: 0.45 }));
  road.rotation.x = -Math.PI / 2; road.position.set(0, 0.2, 40); road.receiveShadow = true;
  scene.add(road);
  const cross = new THREE.Mesh(new THREE.PlaneGeometry(620, 110), stdMat("#9A9186", { rough: 0.96, map: texCobble(), normal: nrmCobble(), nScale: 1.6, envInt: 0.45 }));
  cross.rotation.x = -Math.PI / 2; cross.position.set(0, 0.21, 65); cross.receiveShadow = true;
  scene.add(cross);

  // fountain
  const f = new THREE.Group();
  f.add(cyl(30, 32, 7, stdMat("#A79C8C", { rough: 0.9, map: texStone(), normal: nrmStone(), nScale: 1.2, envInt: 0.6 }), 0, 0, 0, 20));
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

  // lamps
  lamps = [];
  [[-84, 380], [84, 380], [-84, 300], [84, 300], [-84, 210], [84, 210], [-84, 130], [84, 130],
   [-84, 40], [84, 40], [-84, -40], [84, -40], [-84, -120], [84, -120], [-84, -190], [84, -190]]
    .forEach(([lx, lz]) => {
      const g = new THREE.Group();
      g.add(cyl(1.6, 2.4, 34, stdMat("#3D4450", { metal: 0.5, rough: 0.6 }), 0, 0, 0, 8));
      const glob = new THREE.Mesh(new THREE.SphereGeometry(3.4, 12, 10),
        new THREE.MeshStandardMaterial({ color: 0xfff0cf, emissive: 0xffc46b, emissiveIntensity: 1.1, roughness: .4 }));
      glob.position.y = 37;
      g.add(glob);
      const pl = new THREE.PointLight(0xffc46b, 0, 150, 2);
      pl.position.y = 37;
      g.add(pl);
      g.position.set(lx, 0, lz);
      g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      scene.add(g);
      lamps.push({ light: pl, glob });
    });

  // stars for the night sky
  const sg2 = new THREE.BufferGeometry();
  const pts = [];
  for (let i = 0; i < 420; i++) {
    const th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 0.75 + 0.1), r = 2200;
    pts.push(Math.sin(ph) * Math.cos(th) * r, Math.cos(ph) * r, Math.sin(ph) * Math.sin(th) * r);
  }
  sg2.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  starField = new THREE.Points(sg2, new THREE.PointsMaterial({ color: 0xdCE8FF, size: 9, sizeAttenuation: true, transparent: true, opacity: 0 }));
  scene.add(starField);

  // dwellings that fill out the town
  const houseWall = stdMat("#D6CBB4", { rough: 0.95, map: texPlaster("#DCD2BE"), normal: nrmPlaster(), nScale: 1.1, envInt: 0.45 });
  const houseStone = stdMat("#A99E88", { rough: 0.9, map: texStone(), normal: nrmStone(), nScale: 1.2, envInt: 0.5 });
  const houseRoof = stdMat("#93452F", { rough: 0.9, map: texTile(), normal: nrmTile(), nScale: 1.4, envInt: 0.35 });
  const HOUSES = [
    [-268, 195, 34, 30, 0], [-268, 118, 30, 26, 1], [-272, 12, 36, 28, 0], [-266, -78, 30, 34, 1],
    [268, 195, 32, 30, 1], [272, 112, 34, 26, 0], [266, 16, 30, 30, 1], [270, -74, 36, 28, 0],
    [-268, -178, 30, 26, 0], [268, -172, 32, 28, 1],
    [-150, 330, 30, 26, 1], [150, 330, 32, 28, 0], [-262, 292, 28, 26, 0], [262, 288, 30, 26, 1]
  ];
  HOUSES.forEach(([hx, hz, hw, hh, v]) => {
    const g = new THREE.Group();
    g.add(box(hw + 6, 4, hw + 6, houseStone, 0, 0, 0));
    g.add(box(hw, hh, hw * 0.86, houseWall, 0, 4, 0));
    g.add(box(hw + 5, 4, hw * 0.86 + 5, houseStone, 0, 4 + hh, 0));
    g.add(cone(hw * 0.82, 16 + v * 6, houseRoof, 0, 8 + hh, 0));
    if (v) g.add(box(5, 16, 5, houseStone, hw * 0.28, 8 + hh, -hw * 0.2));
    const win = new THREE.MeshStandardMaterial({ color: 0x22303f, emissive: 0xffb765, emissiveIntensity: 0.5, roughness: 0.4 });
    g.add(box(6, 7, 1.2, win, -hw * 0.22, 14, -hw * 0.44));
    g.add(box(6, 7, 1.2, win, hw * 0.22, 14, -hw * 0.44));
    g.add(groundAO(hw * 1.5));
    g.position.set(hx, 0, hz);
    g.rotation.y = (hx > 0 ? -1 : 1) * 0.12;
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(g);
  });

  // town wall and gate to the south
  const wallMat = houseStone;
  [[-1, 1], [1, 1]].forEach(([sgn]) => {
    const wsec = box(300, 34, 16, wallMat, sgn * 230, 0, 400);
    wsec.receiveShadow = true; scene.add(wsec);
  });
  [-92, 92].forEach((gx) => {
    const t2 = new THREE.Group();
    t2.add(box(34, 52, 30, wallMat, 0, 0, 0));
    t2.add(box(40, 6, 36, wallMat, 0, 52, 0));
    t2.add(cone(26, 22, houseRoof, 0, 58, 0));
    t2.position.set(gx, 0, 400);
    t2.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(t2);
  });

  // greenery + skyline
  [[-100, 240, 1], [100, 240, 1], [-100, -20, 0], [100, -20, 0], [-100, -170, 1], [100, -170, 1],
   [-190, 30, 0], [190, 30, 0], [-190, -140, 1], [190, -140, 1], [-190, 220, 0], [190, 220, 0],
   [-100, 340, 1], [100, 340, 1], [-190, 340, 0], [190, 340, 0], [-350, 120, 1], [350, 120, 1],
   [-350, -40, 0], [350, -40, 0], [-350, 250, 1], [350, 250, 1], [-140, -260, 0], [140, -260, 0]]
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

  // the Spire: a sandstone monument on the plain
  const spire = new THREE.Group();
  const sandMat = stdMat("#C2A067", { rough: 0.97, metal: 0, map: texSand(), normal: nrmSand(), nScale: 1.8, envInt: 0.5 });
  const capMat = stdMat("#D8C089", { rough: 0.55, metal: 0.35, envInt: 1.2 });

  const plateau = new THREE.Mesh(new THREE.CylinderGeometry(660, 720, 40, 6), sandMat);
  plateau.position.y = -14; plateau.receiveShadow = true;
  spire.add(plateau);

  const PY_H = 430, PY_B = 560;
  const great = new THREE.Mesh(new THREE.ConeGeometry(PY_B, PY_H, 4, 24), sandMat);
  great.position.y = PY_H / 2 + 4; great.rotation.y = Math.PI / 4;
  great.castShadow = false; great.receiveShadow = true;
  spire.add(great);

  // weathered casing courses catch the light along each face
  for (let i = 1; i < 22; i++) {
    const f = i / 22, r = PY_B * (1 - f) * 1.002;
    const ring = new THREE.Mesh(new THREE.ConeGeometry(r, 3, 4, 1, true), sandMat);
    ring.position.y = 4 + PY_H * f; ring.rotation.y = Math.PI / 4;
    ring.receiveShadow = true;
    spire.add(ring);
  }
  const cap = new THREE.Mesh(new THREE.ConeGeometry(52, 62, 4), capMat);
  cap.position.y = 4 + PY_H - 26; cap.rotation.y = Math.PI / 4;
  spire.add(cap);

  // a lesser pyramid and an obelisk for scale
  const small = new THREE.Mesh(new THREE.ConeGeometry(210, 165, 4, 12), sandMat);
  small.position.set(-620, 84, 210); small.rotation.y = Math.PI / 4;
  small.receiveShadow = true;
  spire.add(small);
  const obel = new THREE.Mesh(new THREE.CylinderGeometry(11, 17, 150, 4), sandMat);
  obel.position.set(560, 75, 250); obel.rotation.y = Math.PI / 4;
  spire.add(obel);
  const obelCap = new THREE.Mesh(new THREE.ConeGeometry(16, 26, 4), capMat);
  obelCap.position.set(560, 163, 250); obelCap.rotation.y = Math.PI / 4;
  spire.add(obelCap);

  spire.position.set(0, 0, -1180);
  spire.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  scene.add(spire);
  scene.userData.tiers = [cap, obelCap];
  scene.userData.great = great;

  // a sun you can actually see
  const sunSpr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeTex("sunspr", 128, (x, sz) => {
      const gr = x.createRadialGradient(64, 64, 2, 64, 64, 64);
      gr.addColorStop(0, "rgba(255,252,238,1)"); gr.addColorStop(0.18, "rgba(255,236,190,.95)");
      gr.addColorStop(0.48, "rgba(255,190,110,.32)"); gr.addColorStop(1, "rgba(255,170,90,0)");
      x.fillStyle = gr; x.fillRect(0, 0, sz, sz);
    }),
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, opacity: 0.9,
  }));
  sunSpr.scale.set(520, 520, 1);
  sunSpr.renderOrder = -1;
  scene.add(sunSpr);
  scene.userData.sunSpr = sunSpr;

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
  renderer.toneMappingExposure = 0.86;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
  } catch (e) { envRT = null; }
  build(opts);
  if (envRT) {
    scene.environment = envRT.texture;
    if ("environmentIntensity" in scene) scene.environmentIntensity = 0.30;
  }
  try {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.22, 0.55, 0.94);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  } catch (e) { composer = null; }
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
    if (composer) composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  // time of day
  const sky = s.sky;
  skyMat.uniforms.top.value.set(sky.top);
  skyMat.uniforms.bottom.value.set(sky.bottom);
  skyMat.uniforms.horizon.value = sky.night ? 0.15 : 0.8;
  scene.fog.color.set(sky.fog);
  scene.fog.near = sky.night ? 620 : 900;
  scene.fog.far = sky.night ? 2400 : 3400;
  hemi.intensity = sky.night ? 0.16 : 0.30;
  hemi.color.set(sky.night ? "#5d74a8" : "#bfd8ff");
  sun.color.set(sky.sun);
  sun.intensity = sky.night ? 0.22 : 1.75;
  renderer.toneMappingExposure = sky.night ? 0.72 : 0.86;
  const lampOn = sky.night || sky.dim;
  lamps.forEach((l) => {
    l.light.intensity += ((lampOn ? 340 : 0) - l.light.intensity) * Math.min(1, s.dt * 2.5);
    l.glob.material.emissiveIntensity = lampOn ? 1.5 : 0.15;
  });
  if (starField) starField.material.opacity += ((sky.night ? 0.9 : 0) - starField.material.opacity) * Math.min(1, s.dt * 1.5);
  if (bloom) bloom.strength = sky.night ? 0.42 : 0.20;

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
  const prog = (s.tierScore || []).reduce((a, b) => a + b, 0) / Math.max(1, (s.tierScore || [1]).length);
  (scene.userData.tiers || []).forEach((m) => {
    m.material.emissive.set("#FFD27A");
    m.material.emissiveIntensity = 0.15 + prog * 1.5;
  });

  // camera trails you
  const want = V3(s.player.x + 30, 132, s.player.z + 238);
  camPos.lerp(want, Math.min(1, s.dt * 3.2));
  camera.position.copy(camPos);
  if (scene.userData.skyMesh) scene.userData.skyMesh.position.copy(camPos);
  if (starField) starField.position.copy(camPos);
  camera.lookAt(s.player.x, 62, s.player.z - 170);

  const spr = scene.userData.sunSpr;
  if (spr) {
    const d = V3(-0.62, 0.46, -0.64).normalize().multiplyScalar(1900);
    spr.position.set(camPos.x + d.x, d.y + 240, camPos.z + d.z);
    spr.material.opacity = sky.night ? 0.0 : 0.85;
  }

  // sun follows so shadows stay crisp near you
  sun.position.set(s.player.x - 270, 350, s.player.z + 210);
  sun.target.position.set(s.player.x, 0, s.player.z);
  sun.target.updateMatrixWorld();

  if (composer) composer.render(); else renderer.render(scene, camera);
}

function pick(nx, ny) {
  if (!ready) return null;
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(nx, ny), camera);
  const hits = ray.intersectObjects(pickables, false);
  return hits.length ? hits[0].object.userData.id : null;
}

window.World3D = { init, frame, pick, setAvatar, get ok() { return ready; }, get scene() { return scene; }, get camera() { return camera; } };
window.dispatchEvent(new Event("world3d-ready"));
