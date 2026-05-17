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
  varying vec3 vWorldNormal;
  varying float vWaveHeight;

  void main() {
    vec3 deep  = vec3(0.05, 0.14, 0.38);   // dark navy deep water
    vec3 reef  = vec3(0.10, 0.52, 0.54);   // tropical reef teal
    vec3 crest = vec3(0.88, 0.96, 1.00);   // wave foam

    // Latitude: 0 = equator, 1 = pole (use normal.y since sphere normal = position direction)
    float lat = abs(vWorldNormal.y);
    float reefMix = (1.0 - smoothstep(0.14, 0.38, lat)) * 0.55;
    vec3 base = mix(deep, reef, reefMix);

    float light = max(dot(vWorldNormal, normalize(vec3(1.0, 1.2, 0.6))), 0.0);
    vec3 col = base * (0.72 + 0.28 * light);
    col = mix(col, crest, smoothstep(0.006, 0.012, vWaveHeight));
    gl_FragColor = vec4(col, 1.0);
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
    if (lat < 0.36 && h >= 0.035 && h < 0.125 && rand < 0.30) {
      palmTreePos.push(surfPt);
    }
    // Temperate trees — away from tropics and poles
    else if (lat >= 0.36 && lat < 0.80 && h >= 0.040 && h < 0.130 && rand < 0.26) {
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
): THREE.Group {
  const group  = new THREE.Group();
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
    const lhLamp = new THREE.Mesh(lhLampGeo, new THREE.MeshLambertMaterial({ color: 0xffe878 }));
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
    const metalMat    = new THREE.MeshLambertMaterial({ color: 0xd0d8e0 });
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

    // Airplane (fuselage + wings + tail fin)
    const planePos = normal.clone().multiplyScalar(r + 0.009)
      .addScaledVector(right, 0.055).addScaledVector(forward, 0.018);

    const fuseGeo = new THREE.CapsuleGeometry(0.007, 0.044, 4, 8);
    fuseGeo.rotateZ(Math.PI / 2);
    const fuseM = new THREE.Mesh(fuseGeo, metalMat);
    fuseM.position.copy(planePos);
    fuseM.quaternion.copy(quat);
    group.add(fuseM);

    const wingGeo = new THREE.BoxGeometry(0.068, 0.002, 0.018);
    const wingM = new THREE.Mesh(wingGeo, metalMat);
    wingM.position.copy(planePos);
    wingM.quaternion.copy(quat);
    group.add(wingM);

    const tailFinGeo = new THREE.BoxGeometry(0.002, 0.012, 0.012);
    tailFinGeo.translate(0, 0.006, 0);
    const tailFin = new THREE.Mesh(tailFinGeo, metalMat);
    tailFin.position.copy(planePos.clone().addScaledVector(right, -0.022));
    tailFin.quaternion.copy(quat);
    group.add(tailFin);

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

  return group;
}

// ── Stars ────────────────────────────────────────────────
function buildStars(): THREE.Points {
  const count = 2000;
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count * 3; i++) pos[i] = (Math.random() - 0.5) * 90;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(
    geo,
    new THREE.PointsMaterial({ color: 0xfff8e8, size: 0.065, sizeAttenuation: true })
  );
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
    scene.add(new THREE.AmbientLight(0x445566, 1.0));
    // Soft fill from opposite side
    const fill = new THREE.DirectionalLight(0xaaccff, 0.4);
    fill.position.set(-2, -1, -2);
    scene.add(fill);

    // ── Stars ─────────────────────────────────────────
    scene.add(buildStars());

    // ── Terrain ───────────────────────────────────────
    const { mesh: terrainMesh, tempTreePos, palmTreePos, height: getHeight } = buildTerrain();
    scene.add(terrainMesh);

    // ── Ocean ─────────────────────────────────────────
    const oceanUniforms = { uTime: { value: 0 } };
    const oceanGeo = new THREE.SphereGeometry(1.0, 80, 80);
    const oceanMat = new THREE.ShaderMaterial({
      uniforms:       oceanUniforms,
      vertexShader:   OCEAN_VERT,
      fragmentShader: OCEAN_FRAG,
    });
    oceanMat.depthWrite          = true;
    oceanMat.polygonOffset       = true;
    oceanMat.polygonOffsetFactor = -1;
    const ocean = new THREE.Mesh(oceanGeo, oceanMat);
    scene.add(ocean);

    // ── Trees & coral ─────────────────────────────────
    const tempTrees = buildTemperateTrees(tempTreePos);
    const palmTrees = buildPalmTrees(palmTreePos);
    scene.add(tempTrees, palmTrees);

    // ── Research station buildings ─────────────────
    const stationGroups: THREE.Group[] = [];
    STATIONS.forEach((s) => {
      const g = buildStation(s, getHeight);
      scene.add(g);
      stationGroups.push(g);
    });

    // ── Atmosphere ────────────────────────────────────
    const atm1 = new THREE.Mesh(
      new THREE.SphereGeometry(1.13, 32, 32),
      new THREE.MeshBasicMaterial({ color: 0x99ccff, transparent: true, opacity: 0.07, side: THREE.BackSide })
    );
    const atm2 = new THREE.Mesh(
      new THREE.SphereGeometry(1.06, 32, 32),
      new THREE.MeshBasicMaterial({ color: 0xbbddff, transparent: true, opacity: 0.05 })
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

    function animate() {
      raf = requestAnimationFrame(animate);
      const t = (performance.now() - t0) / 1000;
      oceanUniforms.uTime.value = t;

      // Inertia + auto-spin
      if (!dragging) {
        velX *= 0.92;
        velY *= 0.92;
        rotY += velX;
        rotX = Math.max(-0.55, Math.min(0.55, rotX + velY));
      }

      euler.set(rotX, rotY, 0);
      terrainMesh.rotation.copy(euler);
      ocean.rotation.copy(euler);
      tempTrees.rotation.copy(euler);
      palmTrees.rotation.copy(euler);
      stationGroups.forEach((g) => { g.rotation.copy(euler); });

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
