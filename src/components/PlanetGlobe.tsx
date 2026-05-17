import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { createNoise3D } from 'simplex-noise';

// Seeded PRNG — gives same planet every load
function seededRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
    s ^= s >>> 16;
    return (s >>> 0) / 4294967296;
  };
}

// ── Station definitions ──────────────────────────────────
interface Station {
  id: string;
  label: string;
  href: string;
  phi: number;
  theta: number;
  color: number;
}

const STATIONS: Station[] = [
  { id: 'central-lab',   label: 'Central Lab',   href: '/central-lab',   phi: 1.35, theta: 0.5,  color: 0xe8c87a },
  { id: 'marine-lab',    label: 'Marine Lab',    href: '/marine-lab',    phi: 1.75, theta: -1.2, color: 0x5bc8e8 },
  { id: 'aerospace-lab', label: 'Aerospace Lab', href: '/aerospace-lab', phi: 0.85, theta: 2.0,  color: 0x90b8f0 },
];

// ── GLSL shaders (ocean only) ────────────────────────────
const OCEAN_VERT = /* glsl */`
  uniform float uTime;
  varying vec3 vWorldNormal;
  varying float vWaveHeight;

  void main() {
    float w =
      sin(position.x * 8.0 + uTime * 1.5) * 0.004 +
      sin(position.z * 6.0 + uTime * 1.0) * 0.003 +
      sin(position.y * 7.0 + uTime * 1.2) * 0.003 +
      sin((position.x + position.z) * 5.0 + uTime * 0.8) * 0.002;
    vWaveHeight = w;
    vWorldNormal = normalize(normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position * (1.0 + w), 1.0);
  }
`;

const OCEAN_FRAG = /* glsl */`
  uniform float uNight;
  varying vec3 vWorldNormal;
  varying float vWaveHeight;

  void main() {
    vec3 deep  = mix(vec3(0.05, 0.14, 0.38), vec3(0.01, 0.04, 0.12), uNight);
    vec3 reef  = mix(vec3(0.10, 0.52, 0.54), vec3(0.03, 0.10, 0.18), uNight);
    vec3 crest = mix(vec3(0.88, 0.96, 1.00), vec3(0.22, 0.28, 0.38), uNight);

    float lat = abs(vWorldNormal.y);
    float reefMix = (1.0 - smoothstep(0.14, 0.38, lat)) * 0.55;
    vec3 base = mix(deep, reef, reefMix);

    float light = max(dot(vWorldNormal, normalize(vec3(1.0, 1.2, 0.6))), 0.0);
    vec3 col = base * (0.72 + 0.28 * light);
    col = mix(col, crest, smoothstep(0.006, 0.012, vWaveHeight));
    gl_FragColor = vec4(col, 0.92);
  }
`;

// ── Terrain helpers ──────────────────────────────────────
function stationUnitVec(s: Station): THREE.Vector3 {
  return new THREE.Vector3(
    Math.sin(s.phi) * Math.cos(s.theta),
    Math.cos(s.phi),
    Math.sin(s.phi) * Math.sin(s.theta),
  );
}

function buildTerrain() {
  const noise   = createNoise3D(seededRng(4271));
  const rng     = seededRng(9913); // for tree placement
  const stationVecs = STATIONS.map(stationUnitVec);

  // Volcano anchor (fixed position)
  const VP = new THREE.Vector3(0.55, 0.55, 0.62).normalize();

  function height(nx: number, ny: number, nz: number): number {
    // Large continent-scale features dominate
    let h = 0;
    h += 0.60 * noise(nx * 1.6, ny * 1.6, nz * 1.6);
    h += 0.25 * noise(nx * 3.5, ny * 3.5, nz * 3.5);
    h += 0.10 * noise(nx * 8.0, ny * 8.0, nz * 8.0);
    h += 0.05 * noise(nx * 16., ny * 16., nz * 16.);
    h *= 0.20;
    // Shift sea level up → ~65 % ocean
    h -= 0.055;

    // Volcano (caldera dip at tip)
    const dv = nx * VP.x + ny * VP.y + nz * VP.z;
    if (dv > 0.93) {
      const d = 1 - dv;
      h += 0.22 * Math.exp(-d * 180) - 0.08 * Math.exp(-d * 3000);
    }

    // Guarantee flat land platform at each station
    for (const sv of stationVecs) {
      const dot = nx * sv.x + ny * sv.y + nz * sv.z;
      if (dot > 0.958) {
        const t = (dot - 0.958) / 0.042;
        h = Math.max(h, 0.018 + 0.012 * t);
      }
    }

    return h;
  }

  function biomeColor(h: number, ny: number): THREE.Color {
    const lat      = Math.abs(ny);         // 0 = equator, 1 = pole
    const tropical = lat < 0.38;
    const polar    = lat > 0.76;

    // ── Polar ice caps ──────────────────────────────
    if (polar && h > -0.04) return new THREE.Color(0xe8f2f8); // ice sheet
    if (polar && h > -0.10) return new THREE.Color(0xc8dce8); // sea ice fringe

    // ── Underwater seafloor (visible through transparent ocean) ─
    if (h < -0.06) return new THREE.Color(0x2a3830); // dark rocky seabed
    if (h < -0.01) return new THREE.Color(0xb89060); // sandy shallow seafloor

    // ── Coastline ───────────────────────────────────
    if (tropical && h < 0.008) return new THREE.Color(0xf0c070); // coral / warm sand
    if (h < 0.012) return new THREE.Color(0xe8d59a);              // beach sand

    // ── Land ────────────────────────────────────────
    if (tropical) {
      if (h < 0.060) return new THREE.Color(0x52c228); // bright tropical grass
      if (h < 0.120) return new THREE.Color(0x228818); // dense jungle
      if (h < 0.180) return new THREE.Color(0x7a6040); // tropical highland
    } else {
      if (h < 0.060) return new THREE.Color(0x72b83e); // temperate grass
      if (h < 0.120) return new THREE.Color(0x3d7a28); // forest
      if (h < 0.180) return new THREE.Color(0x8b7355); // highland
    }
    if (h < 0.245) return new THREE.Color(0xb0a090); // mountain
    return new THREE.Color(0xf0eee8);                  // snow cap
  }

  const SEG = 80;
  const geo = new THREE.SphereGeometry(1, SEG, SEG);
  const positions = geo.attributes.position;
  const colors: number[] = [];
  const tempTreePos: THREE.Vector3[] = [];   // conifers / oaks
  const palmTreePos: THREE.Vector3[] = [];   // tropical palms

  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);
    const len = Math.sqrt(x*x + y*y + z*z);
    const nx = x/len, ny = y/len, nz = z/len;

    const h   = height(nx, ny, nz);
    const lat = Math.abs(ny);
    const r   = h >= 0 ? 1.0 + Math.max(h, 0.012) : 1.0 + h;

    positions.setXYZ(i, nx * r, ny * r, nz * r);
    colors.push(...biomeColor(h, ny).toArray());

    const surfPt = new THREE.Vector3(nx * (r + 0.002), ny * (r + 0.002), nz * (r + 0.002));
    const rand   = rng();

    // Tropical palms — dense jungle zone
    if (lat < 0.36 && h >= 0.018 && h < 0.130 && rand < 0.24) {
      palmTreePos.push(surfPt);
    }
    // Temperate trees — away from tropics and poles
    else if (lat >= 0.36 && lat < 0.80 && h >= 0.020 && h < 0.145 && rand < 0.22) {
      tempTreePos.push(surfPt);
    }
  }

  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  return { mesh, tempTreePos, palmTreePos, height };
}

// ── Tree helpers ─────────────────────────────────────────
function placeInstances(
  mesh: THREE.InstancedMesh,
  positions: THREE.Vector3[],
  rng: () => number,
) {
  const up   = new THREE.Vector3(0, 1, 0);
  const mat4 = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const ONE  = new THREE.Vector3(1, 1, 1);
  positions.forEach((pos, i) => {
    const normal = pos.clone().normalize();
    quat.setFromUnitVectors(up, normal);
    quat.premultiply(
      new THREE.Quaternion().setFromAxisAngle(normal, rng() * Math.PI * 2)
    );
    mat4.compose(pos, quat, ONE);
    mesh.setMatrixAt(i, mat4);
  });
  mesh.instanceMatrix.needsUpdate = true;
}

function buildTemperateTrees(positions: THREE.Vector3[]): THREE.Group {
  const rng = seededRng(1001);
  const trunkGeo   = new THREE.CylinderGeometry(0.005, 0.007, 0.024, 5);
  trunkGeo.translate(0, 0.012, 0);
  const foliageGeo  = new THREE.ConeGeometry(0.019, 0.038, 6);
  foliageGeo.translate(0, 0.043, 0);

  const trunks   = new THREE.InstancedMesh(trunkGeo,  new THREE.MeshLambertMaterial({ color: 0x7a5030 }), positions.length);
  const foliages = new THREE.InstancedMesh(foliageGeo, new THREE.MeshLambertMaterial({ color: 0x2d6e20 }), positions.length);
  placeInstances(trunks,   positions, rng);
  placeInstances(foliages, positions, seededRng(1002));

  const g = new THREE.Group();
  g.add(trunks, foliages);
  return g;
}

// Minimal geometry merge (no external dep needed)
function mergeGeos(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pArr: number[] = [], nArr: number[] = [], idx: number[] = [];
  let base = 0;
  for (const g of geos) {
    const p = g.attributes.position.array as Float32Array;
    const n = g.attributes.normal?.array as Float32Array | undefined;
    for (let i = 0; i < p.length; i++) pArr.push(p[i]);
    if (n) for (let i = 0; i < n.length; i++) nArr.push(n[i]);
    if (g.index) {
      for (let i = 0; i < g.index.array.length; i++) idx.push(g.index.array[i] + base);
    }
    base += p.length / 3;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pArr), 3));
  if (nArr.length) out.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nArr), 3));
  if (idx.length) out.setIndex(idx);
  out.computeVertexNormals();
  return out;
}

function buildPalmTrees(positions: THREE.Vector3[]): THREE.Group {
  // Trunk: tall thin cylinder (bottom at y=0, top at y=0.068)
  const trunkGeo = new THREE.CylinderGeometry(0.003, 0.005, 0.068, 5);
  trunkGeo.translate(0, 0.034, 0);

  // 7 fronds: thin elongated box, each rotated around trunk tip
  const FROND_N = 7;
  const frondGeos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < FROND_N; i++) {
    const angle = (i / FROND_N) * Math.PI * 2;
    // Thin leaf: wide at base, tapers — approximate with BoxGeometry
    const leaf = new THREE.BoxGeometry(0.006, 0.003, 0.036);
    // Offset tip downward to simulate droop
    const pos = leaf.attributes.position.array as Float32Array;
    for (let v = 0; v < pos.length / 3; v++) {
      if (pos[v * 3 + 2] < 0) pos[v * 3 + 1] -= 0.007; // droop far end
    }
    leaf.attributes.position.needsUpdate = true;
    leaf.rotateX(-Math.PI * 0.22);            // lean outward from vertical
    leaf.rotateY(angle);
    // Offset from trunk centre outward
    leaf.translate(
      Math.sin(angle) * 0.010,
      0.070,
      Math.cos(angle) * 0.010,
    );
    frondGeos.push(leaf);
  }
  const frondGeo = mergeGeos(frondGeos);

  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x9a7040 }), positions.length);
  const fronds  = new THREE.InstancedMesh(frondGeo, new THREE.MeshLambertMaterial({ color: 0x2ab810 }), positions.length);
  placeInstances(trunks, positions, seededRng(2001));
  placeInstances(fronds, positions, seededRng(2002));

  const g = new THREE.Group();
  g.add(trunks, fronds);
  return g;
}

// ── Research station buildings ───────────────────────────
function buildStation(
  s: Station,
  getHeight: (nx: number, ny: number, nz: number) => number
): { group: THREE.Group; emissiveMats: THREE.MeshLambertMaterial[] } {
  const group  = new THREE.Group();
  const emissiveMats: THREE.MeshLambertMaterial[] = [];
  const sv     = stationUnitVec(s);
  const h      = getHeight(sv.x, sv.y, sv.z);
  const r      = 1.0 + Math.max(h, 0.010) + 0.003;
  const normal = sv.clone();

  // Tangent frame (right = east-ish, forward = north-ish)
  const right   = new THREE.Vector3().crossVectors(normal, new THREE.Vector3(0, 1, 0)).normalize();
  const forward = new THREE.Vector3().crossVectors(right, normal).normalize();
  const up      = new THREE.Vector3(0, 1, 0);
  const quat    = new THREE.Quaternion().setFromUnitVectors(up, normal);

  // Per-station appearance
  const wallColor = s.id === 'central-lab'   ? 0xf2e6cc   // warm cream house
                  : s.id === 'marine-lab'    ? 0xe8e8e0   // weathered white
                  :                            0xd0cfc8;  // concrete grey
  const roofColor = s.id === 'central-lab'   ? 0xa03828   // terracotta
                  : s.id === 'marine-lab'    ? 0x2a4a60   // slate blue
                  :                            0x484848;  // flat dark
  const roofRatio = s.id === 'central-lab'   ? 0.72       // steep house gable
                  : s.id === 'aerospace-lab' ? 0.18       // nearly flat
                  :                            0.45;

  const wallMat = new THREE.MeshLambertMaterial({ color: wallColor });
  const roofMat = new THREE.MeshLambertMaterial({ color: roofColor });

  function addBuilding(w: number, ht: number, d: number, ox: number, oz: number) {
    const pos = normal.clone().multiplyScalar(r)
      .addScaledVector(right, ox).addScaledVector(forward, oz);

    const boxGeo = new THREE.BoxGeometry(w, ht, d);
    boxGeo.translate(0, ht / 2, 0);
    const box = new THREE.Mesh(boxGeo, wallMat);
    box.position.copy(pos); box.quaternion.copy(quat);
    group.add(box);

    const roofGeo = new THREE.ConeGeometry(Math.max(w, d) * 0.72, ht * roofRatio, 4);
    roofGeo.rotateY(Math.PI / 4);
    roofGeo.translate(0, ht + ht * 0.22, 0);
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.copy(pos); roof.quaternion.copy(quat);
    group.add(roof);
  }

  // Main cluster
  addBuilding(0.036, 0.030, 0.028,  0.000,  0.000);
  addBuilding(0.020, 0.020, 0.018,  0.030,  0.008);
  addBuilding(0.012, 0.038, 0.012, -0.024,  0.006);
  addBuilding(0.026, 0.015, 0.020,  0.004, -0.026);

  // ── Central lab: chimney on main house ───────────────
  if (s.id === 'central-lab') {
    const chimneyGeo = new THREE.BoxGeometry(0.007, 0.018, 0.007);
    chimneyGeo.translate(0, 0.009, 0);
    const chimney = new THREE.Mesh(chimneyGeo, new THREE.MeshLambertMaterial({ color: 0x8a4030 }));
    chimney.position.copy(
      normal.clone().multiplyScalar(r + 0.026).addScaledVector(right, -0.008).addScaledVector(forward, 0.005)
    );
    chimney.quaternion.copy(quat);
    group.add(chimney);
  }

  // ── Marine lab extras: lighthouse, harbour, submarine ─
  if (s.id === 'marine-lab') {
    // Lighthouse
    const lhPos = normal.clone().multiplyScalar(r).addScaledVector(right, -0.036).addScaledVector(forward, 0.020);
    const lhBodyGeo = new THREE.CylinderGeometry(0.007, 0.009, 0.058, 8);
    lhBodyGeo.translate(0, 0.029, 0);
    const lhBody = new THREE.Mesh(lhBodyGeo, new THREE.MeshLambertMaterial({ color: 0xf4f0e8 }));
    lhBody.position.copy(lhPos); lhBody.quaternion.copy(quat); group.add(lhBody);
    const lhLampGeo = new THREE.CylinderGeometry(0.009, 0.009, 0.011, 8);
    lhLampGeo.translate(0, 0.058 + 0.0055, 0);
    const lhLampMat = new THREE.MeshLambertMaterial({ color: 0xffe878, emissive: new THREE.Color(0xffdd44), emissiveIntensity: 0 });
    emissiveMats.push(lhLampMat);
    const lhLamp = new THREE.Mesh(lhLampGeo, lhLampMat);
    lhLamp.position.copy(lhPos); lhLamp.quaternion.copy(quat); group.add(lhLamp);
    const lhCapGeo = new THREE.ConeGeometry(0.011, 0.010, 8);
    lhCapGeo.translate(0, 0.058 + 0.011 + 0.005, 0);
    const lhCap = new THREE.Mesh(lhCapGeo, new THREE.MeshLambertMaterial({ color: 0x8a2820 }));
    lhCap.position.copy(lhPos); lhCap.quaternion.copy(quat); group.add(lhCap);

    const dockMat = new THREE.MeshLambertMaterial({ color: 0x8b6840 }); // weathered wood
    const subMat  = new THREE.MeshLambertMaterial({ color: 0x2a3a2a }); // dark military green

    // Pier: extends from shore (forward direction = toward ocean)
    const pierLen = 0.075;
    const pierGeo = new THREE.BoxGeometry(0.012, 0.004, pierLen);
    pierGeo.translate(0, 0.002, 0);
    const pier = new THREE.Mesh(pierGeo, dockMat);
    const pierPos = normal.clone().multiplyScalar(r)
      .addScaledVector(forward, -pierLen / 2 - 0.018); // extends outward to sea
    pier.position.copy(pierPos);
    pier.quaternion.copy(quat);
    group.add(pier);

    // Cross-plank at pier end
    const crossGeo = new THREE.BoxGeometry(0.040, 0.004, 0.010);
    crossGeo.translate(0, 0.002, 0);
    const cross = new THREE.Mesh(crossGeo, dockMat);
    const crossPos = normal.clone().multiplyScalar(r)
      .addScaledVector(forward, -pierLen - 0.018);
    cross.position.copy(crossPos);
    cross.quaternion.copy(quat);
    group.add(cross);

    // Mooring posts (4 small cylinders)
    const postGeo = new THREE.CylinderGeometry(0.003, 0.003, 0.010, 5);
    const postMat = new THREE.MeshLambertMaterial({ color: 0x5a4020 });
    [[-0.014, -0.035], [0.014, -0.035], [-0.014, -0.065], [0.014, -0.065]].forEach(([or, of]) => {
      const post = new THREE.Mesh(postGeo, postMat);
      const pPos = normal.clone().multiplyScalar(r + 0.005)
        .addScaledVector(right, or).addScaledVector(forward, of);
      post.position.copy(pPos);
      post.quaternion.copy(quat);
      group.add(post);
    });

    // Submarine: CapsuleGeometry hull, oriented along `right` axis
    const subHullGeo = new THREE.CapsuleGeometry(0.013, 0.058, 6, 8);
    subHullGeo.rotateZ(Math.PI / 2); // horizontal
    const sub = new THREE.Mesh(subHullGeo, subMat);
    // Float at sea level, beside pier end
    const subR = 1.006; // just above ocean sphere
    const subPos = normal.clone().multiplyScalar(subR)
      .addScaledVector(right,   0.038)
      .addScaledVector(forward, -pierLen - 0.020);
    sub.position.copy(subPos);
    sub.quaternion.copy(quat);
    group.add(sub);

    // Conning tower
    const towerGeo = new THREE.BoxGeometry(0.012, 0.016, 0.010);
    towerGeo.translate(0, 0.020, 0);
    const tower = new THREE.Mesh(towerGeo, subMat);
    tower.position.copy(subPos);
    tower.quaternion.copy(quat);
    group.add(tower);
  }

  // ── Aerospace lab extras: runway, plane, launch pad, rocket, shuttle ──
  if (s.id === 'aerospace-lab') {
    const concreteMat = new THREE.MeshLambertMaterial({ color: 0xa0a0a0 });
    const gantryMat   = new THREE.MeshLambertMaterial({ color: 0xc07828 });
    const rocketMat   = new THREE.MeshLambertMaterial({ color: 0xf0ede8 });
    const shuttleMat  = new THREE.MeshLambertMaterial({ color: 0xf0ece4 });

    // Runway — extends along `right`
    const runwayGeo = new THREE.BoxGeometry(0.140, 0.002, 0.018);
    runwayGeo.translate(0, 0.001, 0);
    const runway = new THREE.Mesh(runwayGeo, concreteMat);
    runway.position.copy(normal.clone().multiplyScalar(r).addScaledVector(right, 0.060));
    runway.quaternion.copy(quat);
    group.add(runway);

    // Centerline stripe
    const lineGeo = new THREE.BoxGeometry(0.120, 0.0025, 0.003);
    lineGeo.translate(0, 0.001, 0);
    const line = new THREE.Mesh(lineGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }));
    line.position.copy(normal.clone().multiplyScalar(r).addScaledVector(right, 0.060));
    line.quaternion.copy(quat);
    group.add(line);

    // Launch pad
    const padPos = normal.clone().multiplyScalar(r)
      .addScaledVector(right, -0.055).addScaledVector(forward, -0.018);

    const slabGeo = new THREE.BoxGeometry(0.042, 0.002, 0.042);
    slabGeo.translate(0, 0.001, 0);
    const slab = new THREE.Mesh(slabGeo, concreteMat);
    slab.position.copy(padPos);
    slab.quaternion.copy(quat);
    group.add(slab);

    // Gantry tower + arm
    const towerH = 0.090;
    const towerGeo = new THREE.BoxGeometry(0.005, towerH, 0.005);
    towerGeo.translate(0, towerH / 2, 0);
    const towerPos = padPos.clone().addScaledVector(right, -0.015).addScaledVector(forward, -0.015);
    const gantry = new THREE.Mesh(towerGeo, gantryMat);
    gantry.position.copy(towerPos);
    gantry.quaternion.copy(quat);
    group.add(gantry);

    const armGeo = new THREE.BoxGeometry(0.030, 0.004, 0.004);
    const arm = new THREE.Mesh(armGeo, gantryMat);
    arm.position.copy(towerPos.clone().addScaledVector(normal, towerH * 0.82));
    arm.quaternion.copy(quat);
    group.add(arm);

    // Rocket on pad
    const rocketH = 0.078;
    const rocketGeo = new THREE.CapsuleGeometry(0.008, rocketH, 4, 8);
    rocketGeo.translate(0, rocketH / 2 + 0.008, 0);
    const rocket = new THREE.Mesh(rocketGeo, rocketMat);
    rocket.position.copy(padPos);
    rocket.quaternion.copy(quat);
    group.add(rocket);

    // Side boosters
    const boosterMat = new THREE.MeshLambertMaterial({ color: 0xe0d8c8 });
    [-1, 1].forEach((side) => {
      const bGeo = new THREE.CapsuleGeometry(0.004, 0.048, 4, 6);
      bGeo.translate(0, 0.048 / 2 + 0.006, 0);
      const booster = new THREE.Mesh(bGeo, boosterMat);
      booster.position.copy(padPos.clone().addScaledVector(right, side * 0.013));
      booster.quaternion.copy(quat);
      group.add(booster);
    });

    // Space shuttle (parked on apron)
    const shuttlePos = normal.clone().multiplyScalar(r + 0.008)
      .addScaledVector(right, 0.060).addScaledVector(forward, -0.038);

    const sFuseGeo = new THREE.CapsuleGeometry(0.008, 0.040, 4, 8);
    sFuseGeo.rotateZ(Math.PI / 2);
    const sFuse = new THREE.Mesh(sFuseGeo, shuttleMat);
    sFuse.position.copy(shuttlePos);
    sFuse.quaternion.copy(quat);
    group.add(sFuse);

    // Delta wings (left + right)
    [-1, 1].forEach((side) => {
      const dwGeo = new THREE.BoxGeometry(0.030, 0.002, 0.022);
      dwGeo.translate(side * 0.024, 0, 0);
      const dw = new THREE.Mesh(dwGeo, shuttleMat);
      dw.position.copy(shuttlePos);
      dw.quaternion.copy(quat);
      group.add(dw);
    });

    // Shuttle vertical stabilizer
    const sVStabGeo = new THREE.BoxGeometry(0.002, 0.014, 0.018);
    sVStabGeo.translate(0, 0.007, 0);
    const sVStab = new THREE.Mesh(sVStabGeo, shuttleMat);
    sVStab.position.copy(shuttlePos.clone().addScaledVector(right, -0.020));
    sVStab.quaternion.copy(quat);
    group.add(sVStab);
  }

  return { group, emissiveMats };
}

// ── Wildlife helpers ─────────────────────────────────────

function initTangentDir(pos: THREE.Vector3): THREE.Vector3 {
  const ref = Math.abs(pos.y) < 0.9
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(1, 0, 0);
  return new THREE.Vector3().crossVectors(pos, ref).normalize();
}

function stepSphere(
  pos: THREE.Vector3, dir: THREE.Vector3, speed: number, turnBias: number,
): void {
  const newPos = pos.clone().addScaledVector(dir, speed).normalize();
  let d = dir.clone().sub(newPos.clone().multiplyScalar(dir.dot(newPos))).normalize();
  const right = new THREE.Vector3().crossVectors(d, newPos).normalize();
  d.addScaledVector(right, turnBias);
  const dp = d.dot(newPos);
  if (!isNaN(dp)) d.sub(newPos.clone().multiplyScalar(dp)).normalize();
  pos.copy(newPos);
  dir.copy(d);
}

function placeAnimal(
  group: THREE.Group, pos: THREE.Vector3, dir: THREE.Vector3,
  r: number, pq: THREE.Quaternion,
): void {
  group.position.copy(pos.clone().multiplyScalar(r).applyQuaternion(pq));
  const up    = pos.clone().normalize();
  const right = new THREE.Vector3().crossVectors(up, dir).normalize();
  const fwd   = new THREE.Vector3().crossVectors(right, up).normalize();
  const lq    = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(right, up, fwd),
  );
  group.quaternion.copy(pq).multiply(lq);
}

function buildParrot(): { group: THREE.Group; lWing: THREE.Mesh; rWing: THREE.Mesh } {
  const g       = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0xdd2211 });
  const wingMat = new THREE.MeshLambertMaterial({ color: 0x1a44cc });

  const bodyGeo = new THREE.CapsuleGeometry(0.006, 0.015, 4, 6);
  bodyGeo.rotateX(Math.PI / 2);
  g.add(new THREE.Mesh(bodyGeo, bodyMat));

  const headGeo = new THREE.SphereGeometry(0.005, 6, 6);
  headGeo.translate(0, 0.001, 0.012);
  g.add(new THREE.Mesh(headGeo, new THREE.MeshLambertMaterial({ color: 0xffcc22 })));

  const tailGeo = new THREE.BoxGeometry(0.004, 0.002, 0.018);
  tailGeo.translate(0, 0, -0.018);
  g.add(new THREE.Mesh(tailGeo, new THREE.MeshLambertMaterial({ color: 0x22aa44 })));

  const lWing = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.002, 0.013), wingMat);
  const rWing = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.002, 0.013), wingMat);
  lWing.position.set(-0.011, 0, 0);
  rWing.position.set( 0.011, 0, 0);
  g.add(lWing, rWing);

  return { group: g, lWing, rWing };
}

function buildDolphin(): { group: THREE.Group; tail: THREE.Group } {
  const g   = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0x5a8aaa });

  const bodyGeo = new THREE.CapsuleGeometry(0.008, 0.036, 4, 8);
  bodyGeo.rotateX(Math.PI / 2);
  g.add(new THREE.Mesh(bodyGeo, mat));

  const dorsalGeo = new THREE.BoxGeometry(0.003, 0.009, 0.008);
  dorsalGeo.translate(0, 0.008, -0.002);
  g.add(new THREE.Mesh(dorsalGeo, mat));

  // Tail pivot group — rotated to flap flukes up/down
  const tail = new THREE.Group();
  tail.position.set(0, 0, -0.020);
  [-1, 1].forEach((s) => {
    const fg = new THREE.BoxGeometry(0.014, 0.002, 0.008);
    fg.translate(s * 0.007, 0, -0.004);
    tail.add(new THREE.Mesh(fg, mat));
  });
  g.add(tail);

  return { group: g, tail };
}

// ── Animated airplane ────────────────────────────────────
function smoothStep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function buildAnimatedPlane(): {
  group:      THREE.Group;
  windowMats: THREE.MeshLambertMaterial[];
  navGreen:   THREE.Mesh;
  navRed:     THREE.Mesh;
} {
  const g        = new THREE.Group();
  const metalMat = new THREE.MeshLambertMaterial({ color: 0xd0d8e0 });
  const windowMats: THREE.MeshLambertMaterial[] = [];

  // Fuselage — fatter radius (0.009) and longer (0.056), length along +Z (forward)
  const fuseGeo = new THREE.CapsuleGeometry(0.009, 0.056, 4, 8);
  fuseGeo.rotateX(Math.PI / 2);
  g.add(new THREE.Mesh(fuseGeo, metalMat));

  // Main wings — higher aspect ratio: wider span, narrower chord
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.080, 0.002, 0.012), metalMat));

  // Horizontal stabilizer at tail
  const hStab = new THREE.BoxGeometry(0.038, 0.002, 0.009);
  hStab.translate(0, 0, -0.034);
  g.add(new THREE.Mesh(hStab, metalMat));

  // Vertical fin
  const vFin = new THREE.BoxGeometry(0.002, 0.018, 0.014);
  vFin.translate(0, 0.009, -0.032);
  g.add(new THREE.Mesh(vFin, metalMat));

  // Windows — 5 per side (front 1 and rear 2 removed), spacing slightly widened
  for (const side of [-1, 1]) {
    for (let wi = 0; wi < 5; wi++) {
      const wGeo = new THREE.BoxGeometry(0.0014, 0.0026, 0.0030);
      wGeo.translate(side * 0.0094, 0.001, -0.013 + wi * 0.008);
      const wMat = new THREE.MeshLambertMaterial({
        color: 0xfff0d8,
        emissive: new THREE.Color(0xff9944),
        emissiveIntensity: 0,
      });
      windowMats.push(wMat);
      g.add(new THREE.Mesh(wGeo, wMat));
    }
  }

  // Navigation lights — sd = cross(up,fwd) points port (left), so:
  // starboard (right) = −sd = −X  → green
  // port (left)       = +sd = +X  → red
  const navGeo = new THREE.SphereGeometry(0.0028, 4, 4);
  const navGreen = new THREE.Mesh(
    navGeo,
    new THREE.MeshBasicMaterial({ color: 0x00ee44, transparent: true }),
  );
  navGreen.position.set(-0.040, 0, 0); // starboard (right wing)
  const navRed = new THREE.Mesh(
    navGeo.clone(),
    new THREE.MeshBasicMaterial({ color: 0xff2222, transparent: true }),
  );
  navRed.position.set(0.040, 0, 0); // port (left wing)
  g.add(navGreen, navRed);

  return { group: g, windowMats, navGreen, navRed };
}

// ── Stars ────────────────────────────────────────────────
const STAR_VERT = /* glsl */`
  uniform float uTime;
  attribute float aPhase;
  attribute float aSpeed;
  varying float vBrightness;

  void main() {
    // Each star twinkles at its own rate and phase
    vBrightness = 0.35 + 0.65 * abs(sin(uTime * aSpeed + aPhase));
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = 78.0 / -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const STAR_FRAG = /* glsl */`
  varying float vBrightness;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float r = length(uv);
    if (r > 0.5) discard;
    // Soft circular falloff * twinkle brightness
    float alpha = (0.5 - r) * 2.0 * vBrightness;
    gl_FragColor = vec4(1.0, 0.97, 0.91, alpha);
  }
`;

function buildStars(): { points: THREE.Points; uniforms: { uTime: { value: number } } } {
  const count = 2800;
  const pos   = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  const speed = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    pos[i * 3]     = (Math.random() - 0.5) * 90;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 90;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 90;
    phase[i] = Math.random() * Math.PI * 2;
    // Mix of slow (0.3) and fast (2.5) twinklers
    speed[i] = 0.3 + Math.random() * 2.2;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos,   3));
  geo.setAttribute('aPhase',   new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('aSpeed',   new THREE.BufferAttribute(speed, 1));

  const uniforms = { uTime: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader:   STAR_VERT,
    fragmentShader: STAR_FRAG,
    transparent: true,
    depthWrite:  false,
  });

  return { points: new THREE.Points(geo, mat), uniforms };
}

// ── Main component ───────────────────────────────────────
export default function PlanetGlobe({ base }: { base: string }) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    // ── Renderer ──────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);

    // ── Scene & camera ────────────────────────────────
    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, el.clientWidth / el.clientHeight, 0.1, 200);
    camera.position.set(0, 0, 4.0);

    // ── Lights ────────────────────────────────────────
    const sun = new THREE.DirectionalLight(0xfff0d0, 2.4);
    sun.position.set(3, 2, 2);
    scene.add(sun);
    const ambient = new THREE.AmbientLight(0x445566, 1.0);
    scene.add(ambient);
    const fill = new THREE.DirectionalLight(0xaaccff, 0.4);
    fill.position.set(-2, -1, -2);
    scene.add(fill);

    // ── Stars ─────────────────────────────────────────
    const { points: starPoints, uniforms: starUniforms } = buildStars();
    scene.add(starPoints);

    // ── Terrain ───────────────────────────────────────
    const { mesh: terrainMesh, tempTreePos, palmTreePos, height: getHeight } = buildTerrain();
    scene.add(terrainMesh);

    // ── Ocean ─────────────────────────────────────────
    const oceanUniforms = { uTime: { value: 0 }, uNight: { value: 0 } };
    const oceanGeo = new THREE.SphereGeometry(1.0, 80, 80);
    const oceanMat = new THREE.ShaderMaterial({
      uniforms:       oceanUniforms,
      vertexShader:   OCEAN_VERT,
      fragmentShader: OCEAN_FRAG,
    });
    oceanMat.transparent = true;
    oceanMat.depthWrite  = false;
    const ocean = new THREE.Mesh(oceanGeo, oceanMat);
    ocean.renderOrder = 2;
    scene.add(ocean);

    // ── Trees & coral ─────────────────────────────────
    const tempTrees = buildTemperateTrees(tempTreePos);
    const palmTrees = buildPalmTrees(palmTreePos);
    scene.add(tempTrees, palmTrees);

    // ── Dark mode setup ───────────────────────────────
    // Collect all tintable materials (terrain + trees) with their original colors
    const nightTintFactor = new THREE.Color(0.22, 0.25, 0.36);
    interface TintEntry { mat: THREE.MeshLambertMaterial; day: THREE.Color; night: THREE.Color }
    const tintEntries: TintEntry[] = [];
    const _tintColor = new THREE.Color(); // scratch

    // Terrain uses vertex colors; material.color multiplies them (default white = no tint)
    tintEntries.push({
      mat: terrainMesh.material as THREE.MeshLambertMaterial,
      day: new THREE.Color(1, 1, 1),
      night: new THREE.Color(nightTintFactor),
    });
    // Trees: save original + compute darkened version
    [tempTrees, palmTrees].forEach((group) => {
      group.traverse((obj) => {
        if (!(obj instanceof THREE.InstancedMesh)) return;
        const mat = obj.material as THREE.MeshLambertMaterial;
        const day = mat.color.clone();
        tintEntries.push({ mat, day, night: day.clone().multiply(nightTintFactor) });
      });
    });

    // Day/night light configs (Color objects, reused each frame)
    const daySunCol  = new THREE.Color(0xfff0d0);  const nightSunCol  = new THREE.Color(0xaabbee);
    const dayAmbCol  = new THREE.Color(0x445566);  const nightAmbCol  = new THREE.Color(0x05090f);
    const dayFillCol = new THREE.Color(0xaaccff);  const nightFillCol = new THREE.Color(0x0d1a35);

    let darkTarget = document.documentElement.dataset.theme === 'dark' ? 1.0 : 0.0;
    let darkBlend  = darkTarget; // start at final value to avoid flash on load

    new MutationObserver(() => {
      darkTarget = document.documentElement.dataset.theme === 'dark' ? 1.0 : 0.0;
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    // ── Research station buildings ─────────────────
    const stationGroups: THREE.Group[] = [];
    const stationLights: THREE.PointLight[] = [];
    const stationEmissiveMats: THREE.MeshLambertMaterial[] = [];
    STATIONS.forEach((s) => {
      const { group, emissiveMats } = buildStation(s, getHeight);
      scene.add(group);
      stationGroups.push(group);
      stationEmissiveMats.push(...emissiveMats);

      const sv = stationUnitVec(s);
      const h  = getHeight(sv.x, sv.y, sv.z);
      const r  = 1.0 + Math.max(h, 0.010) + 0.04;
      const warmColor = s.id === 'central-lab' ? 0xff6611 : 0xffaa55;
      const light = new THREE.PointLight(warmColor, 0, 0.12);
      light.position.copy(sv.clone().multiplyScalar(r));
      scene.add(light);
      stationLights.push(light);
    });

    // ── Animated airplane (Aerospace Lab) ─────────────
    const aeroStation = STATIONS.find(s => s.id === 'aerospace-lab')!;
    const aeroVec     = stationUnitVec(aeroStation);
    const aeroRight   = new THREE.Vector3().crossVectors(aeroVec, new THREE.Vector3(0, 1, 0)).normalize();
    const aeroH       = getHeight(aeroVec.x, aeroVec.y, aeroVec.z);
    const planeParkR  = 1.0 + Math.max(aeroH, 0.010) + 0.012;
    const ORBIT_SPEED_VAL = (Math.PI * 2) / 35; // one orbit in 35 s
    const ORBIT_ALT       = 0.10;
    const TAKEOFF_SPAN    = 0.40;
    const PLANE_WAIT      = 8.0;

    // Precompute parked orientation quaternion (constant in planet-local frame)
    const _pSide = new THREE.Vector3().crossVectors(aeroVec, aeroRight).normalize();
    const _pFwdO = new THREE.Vector3().crossVectors(_pSide, aeroVec).normalize();
    const planeParkQ = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(_pSide, aeroVec, _pFwdO)
    );

    const { group: planeGroup, windowMats: planeWindowMats, navGreen, navRed } = buildAnimatedPlane();
    scene.add(planeGroup);

    let planePhase: 'parked' | 'flying' = 'parked';
    let planeOrbitAngle = 0;
    let planeWaitTimer  = 5.0; // initial delay before first takeoff

    // ── Wildlife ──────────────────────────────────────
    interface ParrotState {
      pos: THREE.Vector3; dir: THREE.Vector3;
      group: THREE.Group; lWing: THREE.Mesh; rWing: THREE.Mesh;
      state: 'fly' | 'perch'; timer: number; turnBias: number;
    }
    const parrots: ParrotState[] = (
      [[1.25, 0.7], [1.40, 2.8], [1.10, -0.3]] as [number, number][]
    ).map(([phi, theta], i) => {
      const pos = new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta),
      );
      const { group, lWing, rWing } = buildParrot();
      scene.add(group);
      return { pos, dir: initTangentDir(pos), group, lWing, rWing,
               state: 'fly' as const, timer: 2 + i * 1.7, turnBias: 0 };
    });

    interface DolphinState {
      pos: THREE.Vector3; dir: THREE.Vector3;
      group: THREE.Group; tail: THREE.Group;
      state: 'swim' | 'jump'; timer: number; jumpProgress: number; turnBias: number;
    }
    const dolphins: DolphinState[] = (
      [[1.57, -0.6], [1.50, 1.8]] as [number, number][]
    ).map(([phi, theta], i) => {
      const pos = new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta),
      );
      const { group, tail } = buildDolphin();
      scene.add(group);
      return { pos, dir: initTangentDir(pos), group, tail,
               state: 'swim' as const, timer: 2 + i * 2.3, jumpProgress: 0,
               turnBias: i * 2.1 }; // repurposed as turnPhase seed
    });

    // ── Atmosphere ────────────────────────────────────
    const atm1 = new THREE.Mesh(
      new THREE.SphereGeometry(1.13, 32, 32),
      new THREE.MeshBasicMaterial({ color: 0x99ccff, transparent: true, opacity: 0.07, side: THREE.BackSide, depthWrite: false })
    );
    const atm2 = new THREE.Mesh(
      new THREE.SphereGeometry(1.06, 32, 32),
      new THREE.MeshBasicMaterial({ color: 0xbbddff, transparent: true, opacity: 0.05, depthWrite: false })
    );
    scene.add(atm1, atm2);

    // ── Station raycasting pins ────────────────────
    // Invisible hit-test spheres at each station
    const pinGeo = new THREE.SphereGeometry(0.06, 8, 8);
    const pinMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 });
    const pinMeshes: THREE.Mesh[] = STATIONS.map((s) => {
      const sv = stationUnitVec(s);
      const h  = getHeight(sv.x, sv.y, sv.z);
      const r  = 1.0 + Math.max(h, 0.010) + 0.06;
      const pin = new THREE.Mesh(pinGeo, pinMat.clone());
      pin.position.copy(sv.clone().multiplyScalar(r));
      pin.userData = s;
      scene.add(pin);
      return pin;
    });

    // Visible glowing orbs at each station
    const orbGeo = new THREE.SphereGeometry(0.016, 10, 10);
    const orbs: THREE.Mesh[] = STATIONS.map((s, i) => {
      const orbMat = new THREE.MeshBasicMaterial({ color: s.color });
      const orb = new THREE.Mesh(orbGeo, orbMat);
      orb.position.copy(pinMeshes[i].position);
      scene.add(orb);
      return orb;
    });

    // ── Tooltip ───────────────────────────────────────
    const tooltip = document.createElement('div');
    tooltip.style.cssText = `
      position:fixed; pointer-events:none; z-index:200;
      background:rgba(20,14,6,0.88); color:#f5ead6;
      font-family:'Palatino Linotype',Palatino,serif;
      font-size:0.8rem; letter-spacing:0.1em; text-transform:uppercase;
      padding:0.4em 0.9em; border-radius:4px;
      border:1px solid rgba(196,154,108,0.45);
      opacity:0; transition:opacity 0.15s; white-space:nowrap;
    `;
    document.body.appendChild(tooltip);

    // ── Raycasting ────────────────────────────────────
    const raycaster = new THREE.Raycaster();
    const pointer   = new THREE.Vector2();

    function toNDC(e: PointerEvent) {
      const rect = el!.getBoundingClientRect();
      pointer.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
      pointer.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
    }

    function onMove(e: PointerEvent) {
      if (dragging) return;
      toNDC(e);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(pinMeshes);
      if (hits.length) {
        const s = hits[0].object.userData as Station;
        tooltip.textContent = s.label;
        tooltip.style.opacity = '1';
        tooltip.style.left = `${e.clientX + 14}px`;
        tooltip.style.top  = `${e.clientY - 10}px`;
        el!.style.cursor = 'pointer';
      } else {
        tooltip.style.opacity = '0';
        el!.style.cursor = 'default';
      }
    }

    function onClick(e: PointerEvent) {
      if (dragMoved) return;
      toNDC(e);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(pinMeshes);
      if (hits.length) {
        const s = hits[0].object.userData as Station;
        window.location.href = base.replace(/\/$/, '') + s.href;
      }
    }

    el.addEventListener('pointermove', onMove);
    el.addEventListener('click', onClick as EventListener);

    // ── Drag rotation ─────────────────────────────────
    let dragging = false, dragMoved = false;
    let lastX = 0, lastY = 0;
    let velX = 0, velY = 0;
    let rotY = 0, rotX = 0;

    el.addEventListener('pointerdown', (e) => {
      dragging = true; dragMoved = false;
      lastX = e.clientX; lastY = e.clientY;
      velX = velY = 0;
    });
    window.addEventListener('pointerup', () => { dragging = false; });
    el.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      if (Math.abs(dx) + Math.abs(dy) > 3) dragMoved = true;
      velX = dx * 0.005;
      velY = dy * 0.005;
      rotY += velX;
      rotX = Math.max(-0.55, Math.min(0.55, rotX + velY));
      lastX = e.clientX; lastY = e.clientY;
    });

    // ── Resize ────────────────────────────────────────
    const onResize = () => {
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(el.clientWidth, el.clientHeight);
    };
    window.addEventListener('resize', onResize);

    // ── Animation loop ────────────────────────────────
    let raf: number;
    const t0 = performance.now();
    const euler = new THREE.Euler();
    let prevT = 0;
    const planetQuat = new THREE.Quaternion();

    function animate() {
      raf = requestAnimationFrame(animate);
      const t = (performance.now() - t0) / 1000;
      const dt = Math.min(t - prevT, 0.05);
      prevT = t;
      oceanUniforms.uTime.value = t;
      starUniforms.uTime.value  = t;

      // ── Dark mode blend ──────────────────────────────
      darkBlend += (darkTarget - darkBlend) * 0.04; // ~0.5 s transition at 60 fps
      oceanUniforms.uNight.value = darkBlend;

      // Lights
      sun.color.copy(daySunCol).lerp(nightSunCol, darkBlend);
      sun.intensity   = 2.4 - 1.9 * darkBlend;
      ambient.color.copy(dayAmbCol).lerp(nightAmbCol, darkBlend);
      ambient.intensity = 1.0 - 0.4 * darkBlend;
      fill.color.copy(dayFillCol).lerp(nightFillCol, darkBlend);
      fill.intensity  = 0.4 - 0.25 * darkBlend;

      // Terrain + tree tint
      tintEntries.forEach(({ mat, day, night }) => {
        _tintColor.copy(day).lerp(night, darkBlend);
        mat.color.copy(_tintColor);
      });

      // Inertia + auto-spin
      if (!dragging) {
        velX *= 0.92;
        velY *= 0.92;
        rotY += velX;
        rotX = Math.max(-0.55, Math.min(0.55, rotX + velY));
      }

      euler.set(rotX, rotY, 0);
      planetQuat.setFromEuler(euler);
      terrainMesh.rotation.copy(euler);
      ocean.rotation.copy(euler);
      tempTrees.rotation.copy(euler);
      palmTrees.rotation.copy(euler);
      stationGroups.forEach((g) => { g.rotation.copy(euler); });
      stationLights.forEach((light, i) => {
        const sv = stationUnitVec(STATIONS[i]);
        const h  = getHeight(sv.x, sv.y, sv.z);
        const r  = 1.0 + Math.max(h, 0.010) + 0.04;
        light.position.copy(sv.clone().multiplyScalar(r).applyEuler(euler));
        light.intensity = darkBlend * 0.18;
      });
      stationEmissiveMats.forEach((mat) => { mat.emissiveIntensity = darkBlend * 0.45; });

      // ── Animated airplane ───────────────────────────
      {
        const TWO_PI = Math.PI * 2;
        if (planePhase === 'parked') {
          planeWaitTimer -= dt;
          planeGroup.position.copy(
            aeroVec.clone().multiplyScalar(planeParkR).applyQuaternion(planetQuat)
          );
          planeGroup.quaternion.copy(planetQuat).multiply(planeParkQ);
          if (planeWaitTimer <= 0) { planePhase = 'flying'; planeOrbitAngle = 0; }
        } else {
          planeOrbitAngle += ORBIT_SPEED_VAL * dt;
          const theta = planeOrbitAngle;
          const cosT  = Math.cos(theta);
          const sinT  = Math.sin(theta);
          // Position and forward on great-circle orbit
          const up  = new THREE.Vector3(
            cosT * aeroVec.x + sinT * aeroRight.x,
            cosT * aeroVec.y + sinT * aeroRight.y,
            cosT * aeroVec.z + sinT * aeroRight.z,
          );
          const fwd = new THREE.Vector3(
            -sinT * aeroVec.x + cosT * aeroRight.x,
            -sinT * aeroVec.y + cosT * aeroRight.y,
            -sinT * aeroVec.z + cosT * aeroRight.z,
          );
          // Smooth altitude ramp for takeoff / landing
          let altFrac: number;
          if (theta < TAKEOFF_SPAN)               altFrac = smoothStep(0, TAKEOFF_SPAN, theta);
          else if (theta > TWO_PI - TAKEOFF_SPAN) altFrac = smoothStep(0, TAKEOFF_SPAN, TWO_PI - theta);
          else                                     altFrac = 1;
          const r    = planeParkR + altFrac * ORBIT_ALT;
          const sd   = new THREE.Vector3().crossVectors(up, fwd).normalize();
          const fwdO = new THREE.Vector3().crossVectors(sd, up).normalize();
          planeGroup.position.copy(up.clone().multiplyScalar(r).applyQuaternion(planetQuat));
          planeGroup.quaternion.copy(planetQuat).multiply(
            new THREE.Quaternion().setFromRotationMatrix(
              new THREE.Matrix4().makeBasis(sd, up, fwdO)
            )
          );
          if (theta >= TWO_PI) { planePhase = 'parked'; planeWaitTimer = PLANE_WAIT; }
        }
        // Window glow at night
        planeWindowMats.forEach(m => { m.emissiveIntensity = darkBlend * 0.7; });
        // Nav lights blink regardless of day/night
        const blinkOn = Math.floor(t * 1.5) % 2 === 0;
        (navGreen.material as THREE.MeshBasicMaterial).opacity = blinkOn ? 1.0 : 0.0;
        (navRed.material   as THREE.MeshBasicMaterial).opacity = blinkOn ? 1.0 : 0.0;
      }

      // Animate orbs (pulse + correct position follows planet rotation)
      orbs.forEach((orb, i) => {
        const s = STATIONS[i];
        const sv = stationUnitVec(s);
        const h  = getHeight(sv.x, sv.y, sv.z);
        const rr = 1.0 + Math.max(h, 0.010) + 0.06;
        const v  = sv.clone().multiplyScalar(rr).applyEuler(euler);
        orb.position.copy(v);
        const mat = orb.material as THREE.MeshBasicMaterial;
        mat.opacity = 0.65 + 0.35 * Math.sin(t * 2.8 + i * 2.1);
        mat.transparent = true;
      });

      // Sync invisible hit-test pin positions
      pinMeshes.forEach((pin, i) => {
        pin.position.copy(orbs[i].position);
      });

      // ── Parrots ─────────────────────────────────────
      for (const p of parrots) {
        p.timer -= dt;
        if (p.state === 'fly') {
          stepSphere(p.pos, p.dir, 0.20 * dt, p.turnBias);
          const flap = Math.sin(t * 14) * 0.75;
          p.lWing.rotation.z =  flap;
          p.rWing.rotation.z = -flap;
          placeAnimal(p.group, p.pos, p.dir, 1.025, planetQuat);
          if (p.timer <= 0) {
            p.state = 'perch';
            p.timer = 2.5 + Math.random() * 4.0;
          }
        } else {
          p.lWing.rotation.z =  0.1;
          p.rWing.rotation.z = -0.1;
          placeAnimal(p.group, p.pos, p.dir, 1.016, planetQuat);
          if (p.timer <= 0) {
            p.state = 'fly';
            p.timer = 5.0 + Math.random() * 6.0;
            p.turnBias = (Math.random() - 0.5) * 0.12;
          }
        }
      }

      // ── Dolphins ────────────────────────────────────
      for (const d of dolphins) {
        d.timer -= dt;
        if (d.state === 'swim') {
          const tb = Math.sin(t * 0.18 + d.turnBias) * 0.0013;
          stepSphere(d.pos, d.dir, 0.10 * dt, tb);
          d.tail.rotation.x = Math.sin(t * 6.5) * 0.50;
          placeAnimal(d.group, d.pos, d.dir, 1.003, planetQuat);
          if (d.timer <= 0) {
            d.state = 'jump';
            d.timer = 1.2;
            d.jumpProgress = 0;
          }
        } else {
          d.jumpProgress += dt / 1.2;
          const arc = Math.sin(Math.min(d.jumpProgress, 1.0) * Math.PI);
          d.tail.rotation.x = Math.sin(t * 4.0) * 0.30;
          placeAnimal(d.group, d.pos, d.dir, 1.003 + arc * 0.065, planetQuat);
          const pitchQ = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(1, 0, 0),
            (d.jumpProgress < 0.5 ? -1 : 1) * arc * 0.7,
          );
          d.group.quaternion.multiply(pitchQ);
          if (d.timer <= 0) {
            d.state = 'swim';
            d.timer = 7.0 + Math.random() * 8.0;
          }
        }
      }

      renderer.render(scene, camera);
    }

    animate();

    return () => {
      cancelAnimationFrame(raf);
      renderer.dispose();
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
      document.body.removeChild(tooltip);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointerup', () => { dragging = false; });
    };
  }, [base]);

  return (
    <div
      ref={mountRef}
      style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}
    />
  );
}
