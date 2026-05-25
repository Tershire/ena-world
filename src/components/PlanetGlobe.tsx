import { useCallback, useEffect, useRef, useState } from 'react';
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

// ── Flat map constants ───────────────────────────────────
const FLAT_W  = 1.40;  // half-width  (lon –π … π → –FLAT_W … FLAT_W)
const FLAT_H  = 0.70;  // half-height (lat –π/2 … π/2 → –FLAT_H … FLAT_H)
const GRID_R  = 1.025; // grid sphere radius
// Transition timing (seconds)
const T_GRID_IN  = 0.45;
const T_MORPH    = 1.50;
const T_GRID_OUT = 0.45;
const T_TOTAL    = T_GRID_IN + T_MORPH + T_GRID_OUT; // 2.4 s

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
    vec3 crest = mix(vec3(0.68, 0.80, 0.92), vec3(0.20, 0.26, 0.36), uNight);

    float lat = abs(vWorldNormal.y);
    float reefMix = (1.0 - smoothstep(0.14, 0.38, lat)) * 0.55;
    vec3 base = mix(deep, reef, reefMix);

    float light = max(dot(vWorldNormal, normalize(vec3(1.0, 1.2, 0.6))), 0.0);
    vec3 col = base * (0.72 + 0.28 * light);
    col = mix(col, crest, 0.40 * smoothstep(0.008, 0.014, vWaveHeight));
    gl_FragColor = vec4(col, 0.92);
  }
`;

// ── Aurora shaders ───────────────────────────────────────
const AURORA_VERT = /* glsl */`
  attribute float aAngle;
  attribute float aHeight;
  varying float vAngle;
  varying float vHeight;

  void main() {
    vAngle  = aAngle;
    vHeight = aHeight;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const AURORA_FRAG = /* glsl */`
  uniform float uTime;
  uniform float uNight;
  varying float vAngle;
  varying float vHeight;

  void main() {
    vec3 teal = vec3(0.00, 0.52, 0.82);

    float bcut1 = 0.18
      + sin(vAngle *  4.0 + uTime * 0.34) * 0.05
      + sin(vAngle * 10.0 - uTime * 0.26) * 0.03;
    float spike1 = 0.55
      + sin(vAngle *  6.0 + uTime * 0.80) * 0.10
      + sin(vAngle * 11.0 - uTime * 1.10) * 0.07
      + sin(vAngle *  8.0 + uTime * 0.55) * 0.04
      + sin(vAngle * 18.0 + uTime * 0.92) * 0.03;
    spike1 = clamp(spike1, 0.34, 0.80);

    float fade1   = smoothstep(bcut1, bcut1 + 0.07, vHeight)
                  * (1.0 - smoothstep(spike1 * 0.65, spike1, vHeight));
    float bright1 = 0.55 + 0.45 * (sin(vAngle * 6.0 + uTime * 0.22) * 0.5 + 0.5);
    vec3  col1    = mix(vec3(0.05, 0.88, 0.42), teal, smoothstep(0.0, 0.6, vHeight));
    float a1      = fade1 * bright1 * uNight * 0.45;

    float bcut2 = 0.14
      + sin(vAngle *  6.0 - uTime * 0.31 + 1.2) * 0.03
      + sin(vAngle * 12.0 + uTime * 0.22 + 2.7) * 0.02;
    float spike2 = 0.36
      + sin(vAngle *  8.0 - uTime * 0.70 + 0.8) * 0.07
      + sin(vAngle * 15.0 + uTime * 0.90 + 3.1) * 0.04
      + sin(vAngle *  4.0 - uTime * 0.45 + 1.9) * 0.04
      + sin(vAngle * 21.0 + uTime * 1.10 + 4.5) * 0.02;
    spike2 = clamp(spike2, 0.21, 0.52);

    float fade2   = smoothstep(bcut2, bcut2 + 0.06, vHeight)
                  * (1.0 - smoothstep(spike2 * 0.65, spike2, vHeight));
    float bright2 = 0.50 + 0.50 * (sin(vAngle * 8.0 + uTime * 0.35 + 1.5) * 0.5 + 0.5);
    vec3  col2    = mix(vec3(0.65, 0.05, 0.85), vec3(0.82, 0.18, 0.62), smoothstep(0.1, 0.8, vHeight));
    float a2      = fade2 * bright2 * uNight * 0.35;

    vec3 additive = col1 * a1 + col2 * a2;
    gl_FragColor = vec4(additive, 1.0);
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
  const rng     = seededRng(9913);
  const stationVecs = STATIONS.map(stationUnitVec);

  const VP = new THREE.Vector3(0.55, 0.55, 0.62).normalize();

  function height(nx: number, ny: number, nz: number): number {
    let h = 0;
    h += 0.60 * noise(nx * 1.6, ny * 1.6, nz * 1.6);
    h += 0.25 * noise(nx * 3.5, ny * 3.5, nz * 3.5);
    h += 0.10 * noise(nx * 8.0, ny * 8.0, nz * 8.0);
    h += 0.05 * noise(nx * 16., ny * 16., nz * 16.);
    h *= 0.20;
    h -= 0.055;

    const dv = nx * VP.x + ny * VP.y + nz * VP.z;
    if (dv > 0.93) {
      const d = 1 - dv;
      h += 0.22 * Math.exp(-d * 180) - 0.08 * Math.exp(-d * 3000);
    }

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
    const lat      = Math.abs(ny);
    const tropical = lat < 0.38;
    const polar    = lat > 0.76;

    if (polar && h > -0.04) return new THREE.Color(0xe8f2f8);
    if (polar && h > -0.10) return new THREE.Color(0xc8dce8);

    if (h < -0.06) return new THREE.Color(0x2a3830);
    if (h < -0.01) return new THREE.Color(0xb89060);

    if (tropical && h < 0.008) return new THREE.Color(0xf0c070);
    if (h < 0.012) return new THREE.Color(0xe8d59a);

    if (tropical) {
      if (h < 0.060) return new THREE.Color(0x52c228);
      if (h < 0.120) return new THREE.Color(0x228818);
      if (h < 0.180) return new THREE.Color(0x7a6040);
    } else {
      if (h < 0.060) return new THREE.Color(0x72b83e);
      if (h < 0.120) return new THREE.Color(0x3d7a28);
      if (h < 0.180) return new THREE.Color(0x8b7355);
    }
    if (h < 0.245) return new THREE.Color(0xb0a090);
    return new THREE.Color(0xf0eee8);
  }

  const SEG = 80;
  // phiStart=3π/2 places the geometry seam at -Z (back of planet = date line in flat map)
  // so no triangle spans the ±π date-line discontinuity when flattening to equirectangular
  const geo = new THREE.SphereGeometry(1, SEG, SEG, Math.PI * 1.5);
  const positions = geo.attributes.position;
  const uvs = geo.attributes.uv;
  const colors: number[] = [];
  const tempTreePos: THREE.Vector3[] = [];
  const palmTreePos: THREE.Vector3[] = [];

  // Flat map morph target buffers
  const spherePositions = new Float32Array(positions.count * 3);
  const flatPositions   = new Float32Array(positions.count * 3);
  const sphereColors    = new Float32Array(positions.count * 3);
  const flatColors      = new Float32Array(positions.count * 3);

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
    spherePositions[i*3]     = nx * r;
    spherePositions[i*3 + 1] = ny * r;
    spherePositions[i*3 + 2] = nz * r;

    const sc = biomeColor(h, ny);
    colors.push(sc.r, sc.g, sc.b);
    sphereColors[i*3] = sc.r; sphereColors[i*3+1] = sc.g; sphereColors[i*3+2] = sc.b;

    // Flat: water areas get ocean blue instead of seafloor colors
    const fc = h < -0.01 ? new THREE.Color(h < -0.06 ? 0x0d2e5c : 0x1a6090) : sc;
    flatColors[i*3] = fc.r; flatColors[i*3+1] = fc.g; flatColors[i*3+2] = fc.b;

    // Flat position via UV: seam vertices have u=0/u=1 → map to ±FLAT_W edges (no stretch)
    const u = uvs.getX(i);
    const v = uvs.getY(i);
    flatPositions[i*3]     = (u - 0.5) * 2 * FLAT_W;
    flatPositions[i*3 + 1] = (v - 0.5) * 2 * FLAT_H;
    flatPositions[i*3 + 2] = 0;

    const surfPt = new THREE.Vector3(nx * (r + 0.002), ny * (r + 0.002), nz * (r + 0.002));
    const rand   = rng();

    if (lat < 0.36 && h >= 0.018 && h < 0.130 && rand < 0.24) {
      palmTreePos.push(surfPt);
    } else if (lat >= 0.36 && lat < 0.80 && h >= 0.020 && h < 0.145 && rand < 0.22) {
      tempTreePos.push(surfPt);
    }
  }

  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
  geo.computeVertexNormals();
  // Snapshot sphere normals for blending during flat transition
  const sphereNormals = new Float32Array(geo.attributes.normal.array as Float32Array);

  // DoubleSide: back-hemisphere triangles are visible after flattening
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  return { mesh, tempTreePos, palmTreePos, height, spherePositions, flatPositions, sphereNormals, sphereColors, flatColors };
}

// ── Grid ─────────────────────────────────────────────────
function buildGrid(): {
  lines: THREE.LineSegments;
  spherePos: Float32Array;
  flatPos: Float32Array;
} {
  const N = 64;
  const parallels_deg = [-60, -30, 0, 30, 60];
  const meridians_deg = Array.from({ length: 12 }, (_, i) => -180 + i * 30);

  const sphPts: number[] = [];
  const fltPts: number[] = [];

  function seg(ax: number, ay: number, az: number, bx: number, by: number, bz: number,
               fax: number, fay: number, fbx: number, fby: number) {
    sphPts.push(ax, ay, az, bx, by, bz);
    fltPts.push(fax, fay, 0.003, fbx, fby, 0.003);
  }

  for (const lat_deg of parallels_deg) {
    const lat = lat_deg * Math.PI / 180;
    const fy  = lat / (Math.PI * 0.5) * FLAT_H;
    const cosLat = Math.cos(lat), sinLat = Math.sin(lat);
    for (let i = 0; i < N; i++) {
      const lon0 = (i / N) * 2 * Math.PI - Math.PI;
      const lon1 = ((i + 1) / N) * 2 * Math.PI - Math.PI;
      seg(
        GRID_R * cosLat * Math.sin(lon0), GRID_R * sinLat, GRID_R * cosLat * Math.cos(lon0),
        GRID_R * cosLat * Math.sin(lon1), GRID_R * sinLat, GRID_R * cosLat * Math.cos(lon1),
        lon0 / Math.PI * FLAT_W, fy,
        lon1 / Math.PI * FLAT_W, fy,
      );
    }
  }

  for (const lon_deg of meridians_deg) {
    const lon = lon_deg * Math.PI / 180;
    const fx  = lon / Math.PI * FLAT_W;
    for (let i = 0; i < N; i++) {
      const lat0 = (i / N) * Math.PI - Math.PI * 0.5;
      const lat1 = ((i + 1) / N) * Math.PI - Math.PI * 0.5;
      const c0 = Math.cos(lat0), s0 = Math.sin(lat0);
      const c1 = Math.cos(lat1), s1 = Math.sin(lat1);
      seg(
        GRID_R * c0 * Math.sin(lon), GRID_R * s0, GRID_R * c0 * Math.cos(lon),
        GRID_R * c1 * Math.sin(lon), GRID_R * s1, GRID_R * c1 * Math.cos(lon),
        fx, lat0 / (Math.PI * 0.5) * FLAT_H,
        fx, lat1 / (Math.PI * 0.5) * FLAT_H,
      );
    }
  }

  const spherePos = new Float32Array(sphPts);
  const flatPos   = new Float32Array(fltPts);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(spherePos.slice(), 3));

  const mat = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.renderOrder = 5;

  return { lines, spherePos, flatPos };
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
  const trunkGeo = new THREE.CylinderGeometry(0.003, 0.005, 0.068, 5);
  trunkGeo.translate(0, 0.034, 0);

  const FROND_N = 7;
  const frondGeos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < FROND_N; i++) {
    const angle = (i / FROND_N) * Math.PI * 2;
    const leaf = new THREE.BoxGeometry(0.006, 0.003, 0.036);
    const pos = leaf.attributes.position.array as Float32Array;
    for (let v = 0; v < pos.length / 3; v++) {
      if (pos[v * 3 + 2] < 0) pos[v * 3 + 1] -= 0.007;
    }
    leaf.attributes.position.needsUpdate = true;
    leaf.rotateX(-Math.PI * 0.22);
    leaf.rotateY(angle);
    leaf.translate(Math.sin(angle) * 0.010, 0.070, Math.cos(angle) * 0.010);
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

// ── Coastal pier ─────────────────────────────────────────
function buildCoastalPier(
  stationVec: THREE.Vector3,
  getHeight: (nx: number, ny: number, nz: number) => number,
): { group: THREE.Group; lampMat: THREE.MeshLambertMaterial } {
  const group   = new THREE.Group();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const n       = stationVec.clone().normalize();
  const rt      = new THREE.Vector3().crossVectors(n, worldUp).normalize();
  const fw      = new THREE.Vector3().crossVectors(rt, n).normalize();

  // Prefer equatorial (east/west) directions so shore stays tropical; -fw (south) is last resort
  const dirs: THREE.Vector3[] = [
    rt.clone(),
    rt.clone().negate(),
    new THREE.Vector3().addScaledVector(fw, -0.5).addScaledVector(rt,  0.87).normalize(),
    new THREE.Vector3().addScaledVector(fw, -0.5).addScaledVector(rt, -0.87).normalize(),
    new THREE.Vector3().addScaledVector(fw,  0.5).addScaledVector(rt,  0.87).normalize(),
    new THREE.Vector3().addScaledVector(fw,  0.5).addScaledVector(rt, -0.87).normalize(),
    fw.clone().negate(),
  ];

  let shoreVec: THREE.Vector3 | null = null;
  let outDir:   THREE.Vector3 | null = null;

  outer: for (const dir of dirs) {
    for (let d = 0.020; d < 0.38; d += 0.004) {
      const s = stationVec.clone().addScaledVector(dir, d).normalize();
      if (getHeight(s.x, s.y, s.z) <= 0.003) {
        const land = stationVec.clone().addScaledVector(dir, Math.max(0.005, d - 0.014)).normalize();
        if (getHeight(land.x, land.y, land.z) > 0.001) {
          shoreVec = land;
          outDir   = dir.clone();
          break outer;
        }
      }
    }
  }

  const lampMat = new THREE.MeshLambertMaterial({
    color: 0xffe8a0, emissive: new THREE.Color(0xffcc44), emissiveIntensity: 0,
  });
  if (!shoreVec || !outDir) return { group, lampMat };

  const hS    = getHeight(shoreVec.x, shoreVec.y, shoreVec.z);
  const baseR = 1.0 + Math.max(hS, 0.001);

  // Local pier axes: pUp = radial outward, pFwd = toward water, pRt = sideways
  const pUp  = shoreVec.clone();
  const pFwd = outDir.clone()
    .sub(pUp.clone().multiplyScalar(outDir.dot(pUp)))
    .normalize();
  const pRt  = new THREE.Vector3().crossVectors(pUp, pFwd).normalize();
  const quat = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(pRt, pUp, pFwd),
  );

  const place = (
    geo: THREE.BufferGeometry, mat: THREE.MeshLambertMaterial,
    dr: number, dy: number, df: number,
  ) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position
      .copy(pUp).multiplyScalar(baseR + dy)
      .addScaledVector(pRt,  dr)
      .addScaledVector(pFwd, df);
    mesh.quaternion.copy(quat);
    group.add(mesh);
  };

  const LEN    = 0.145;
  const W      = 0.026;
  const THICK  = 0.005;
  const N_BAYS = 4;
  const STEP   = LEN / N_BAYS;
  const POST_R = 0.0036;
  const POST_H = 0.032;
  const PLAT_W = W * 2.4;
  const PLAT_D = W * 2.6;

  const concreteMat  = new THREE.MeshLambertMaterial({ color: 0xb8b2aa });
  const pileMat      = new THREE.MeshLambertMaterial({ color: 0x9a9490 });
  const steelMat     = new THREE.MeshLambertMaterial({ color: 0x5c6470 });
  const annexWallMat = new THREE.MeshLambertMaterial({ color: 0xe2e0d8 });
  const annexRoofMat = new THREE.MeshLambertMaterial({ color: 0x2a4060 });
  const winMat       = new THREE.MeshLambertMaterial({ color: 0x7aaec8 });
  const craneMat     = new THREE.MeshLambertMaterial({ color: 0xe8a830 });
  const boatMat      = new THREE.MeshLambertMaterial({ color: 0x2e3c4c });
  const boatTrimMat  = new THREE.MeshLambertMaterial({ color: 0xcac0a8 });

  // ── Main deck ─────────────────────────────────
  const deckGeo = new THREE.BoxGeometry(W, THICK, LEN);
  deckGeo.translate(0, THICK / 2, LEN / 2);
  place(deckGeo, concreteMat, 0, 0, 0);

  // ── Pilings ───────────────────────────────────
  const pilingBase = new THREE.CylinderGeometry(POST_R, POST_R * 1.25, POST_H, 8);
  pilingBase.translate(0, -POST_H / 2, 0);
  for (let b = 0; b <= N_BAYS; b++) {
    for (const side of [-1, 1]) {
      place(pilingBase.clone(), pileMat, side * (W / 2 + POST_R), 0, b * STEP);
    }
  }

  // ── Steel handrail ────────────────────────────
  const rPostGeo = new THREE.CylinderGeometry(0.0011, 0.0011, 0.018, 5);
  rPostGeo.translate(0, THICK + 0.009, 0);
  const rBarGeo = new THREE.BoxGeometry(0.0010, 0.0010, LEN);
  rBarGeo.translate(0, THICK + 0.018, LEN / 2);
  for (const side of [-1, 1]) {
    const xOff = side * (W / 2 - 0.002);
    for (let b = 0; b <= N_BAYS; b++) place(rPostGeo.clone(), steelMat, xOff, 0, b * STEP);
    place(rBarGeo.clone(), steelMat, xOff, 0, 0);
  }

  // ── Mid-pier utility cabinet ──────────────────
  const cabGeo = new THREE.BoxGeometry(0.013, 0.018, 0.016);
  cabGeo.translate(0, 0.009 + THICK, 0);
  place(cabGeo, steelMat, W / 2 - 0.007, 0, LEN * 0.52);

  // ── End platform ──────────────────────────────
  const platGeo = new THREE.BoxGeometry(PLAT_W, THICK, PLAT_D);
  platGeo.translate(0, THICK / 2, LEN + PLAT_D / 2);
  place(platGeo, concreteMat, 0, 0, 0);

  // Platform corner pilings
  for (const dr of [-1, 1]) for (const df of [0, 1]) {
    place(pilingBase.clone(), pileMat, dr * PLAT_W / 2, 0, LEN + df * PLAT_D);
  }

  // ── Mooring cleats ────────────────────────────
  const cleatHGeo = new THREE.BoxGeometry(0.009, 0.003, 0.003);
  cleatHGeo.translate(0, THICK + 0.0015, 0);
  const cleatVGeo = new THREE.BoxGeometry(0.002, 0.005, 0.003);
  cleatVGeo.translate(0, THICK + 0.0025, 0);
  for (const side of [-1, 1]) {
    for (const zf of [0.22, 0.78]) {
      place(cleatHGeo.clone(), steelMat, side * PLAT_W * 0.42, 0, LEN + PLAT_D * zf);
      place(cleatVGeo.clone(), steelMat, side * PLAT_W * 0.42, 0, LEN + PLAT_D * zf);
    }
  }

  // ── Shelter canopy over end platform ──────────
  const CANOPY_H = 0.038;
  const cpX = PLAT_W * 0.38;
  const cpGeo = new THREE.CylinderGeometry(0.0012, 0.0014, CANOPY_H, 5);
  cpGeo.translate(0, CANOPY_H / 2 + THICK, 0);
  for (const dr of [-1, 1]) {
    place(cpGeo.clone(), steelMat, dr * cpX, 0, LEN + PLAT_D * 0.14);
    place(cpGeo.clone(), steelMat, dr * cpX, 0, LEN + PLAT_D * 0.82);
  }
  const canRoofGeo = new THREE.BoxGeometry(PLAT_W * 0.84, 0.004, PLAT_D * 0.72);
  canRoofGeo.translate(0, THICK + CANOPY_H + 0.002, 0);
  place(canRoofGeo, annexRoofMat, 0, 0, LEN + PLAT_D * 0.48);

  // ── Lamp post ─────────────────────────────────
  const poleGeo = new THREE.CylinderGeometry(0.0013, 0.0016, 0.050, 6);
  poleGeo.translate(0, 0.025, 0);
  place(poleGeo, steelMat, -PLAT_W * 0.38, THICK, LEN + PLAT_D * 0.48);
  const armGeo = new THREE.BoxGeometry(0.022, 0.0012, 0.0012);
  armGeo.translate(0.011, 0.051, 0);
  place(armGeo, steelMat, -PLAT_W * 0.38, THICK, LEN + PLAT_D * 0.48);
  const globeGeo = new THREE.SphereGeometry(0.0042, 6, 5);
  globeGeo.translate(0.022, 0.052, 0);
  place(globeGeo, lampMat, -PLAT_W * 0.38, THICK, LEN + PLAT_D * 0.48);

  // ── Crane ─────────────────────────────────────
  const CRANE_H  = 0.064;
  const CRANE_BM = 0.042;
  const craneMastGeo = new THREE.BoxGeometry(0.006, CRANE_H, 0.006);
  craneMastGeo.translate(0, CRANE_H / 2 + THICK, 0);
  place(craneMastGeo, craneMat, PLAT_W * 0.38, 0, LEN + PLAT_D * 0.28);
  const boomGeo = new THREE.BoxGeometry(0.004, 0.004, CRANE_BM);
  boomGeo.translate(0, CRANE_H + THICK - 0.002, CRANE_BM / 2);
  place(boomGeo, craneMat, PLAT_W * 0.38, 0, LEN + PLAT_D * 0.28);
  const cableGeo = new THREE.CylinderGeometry(0.0006, 0.0006, CRANE_H * 0.55, 3);
  cableGeo.translate(0, -CRANE_H * 0.275, 0);
  place(cableGeo, steelMat, PLAT_W * 0.38, THICK + CRANE_H - 0.002, LEN + PLAT_D * 0.28 + CRANE_BM);
  const hookGeo = new THREE.BoxGeometry(0.009, 0.0025, 0.007);
  hookGeo.translate(0, 0, 0);
  place(hookGeo, steelMat, PLAT_W * 0.38, THICK + CRANE_H * 0.45 - 0.004, LEN + PLAT_D * 0.28 + CRANE_BM);

  // ── Shore annex building ───────────────────────
  const AW = 0.058;
  const AH = 0.034;
  const AD = 0.038;
  const ASIDE = W / 2 + 0.012 + AW / 2;

  const aBodyGeo = new THREE.BoxGeometry(AW, AH, AD);
  aBodyGeo.translate(0, AH / 2, 0);
  place(aBodyGeo, annexWallMat, ASIDE, 0, AD / 2 + 0.006);

  // Flat roof with parapet
  const aRoofGeo = new THREE.BoxGeometry(AW + 0.006, 0.007, AD + 0.006);
  place(aRoofGeo, annexRoofMat, ASIDE, AH + 0.0035, AD / 2 + 0.006);

  // Windows on pier-facing side (df ≈ 0)
  const winGeo = new THREE.BoxGeometry(0.012, 0.014, 0.001);
  winGeo.translate(0, AH * 0.56, 0.001);
  for (const wr of [-1, 1]) {
    place(winGeo.clone(), winMat, ASIDE + wr * 0.016, 0, 0.006);
  }

  // Door
  const doorGeo = new THREE.BoxGeometry(0.011, 0.024, 0.001);
  doorGeo.translate(0, 0.012, 0.001);
  place(doorGeo, steelMat, ASIDE, 0, 0.006);

  // Sign panel above door
  const signGeo = new THREE.BoxGeometry(0.028, 0.008, 0.001);
  signGeo.translate(0, AH * 0.84, 0.001);
  place(signGeo, new THREE.MeshLambertMaterial({ color: 0x1a3550 }), ASIDE, 0, 0.006);

  // Antenna mast on roof
  const antGeo = new THREE.CylinderGeometry(0.0009, 0.0009, 0.028, 4);
  antGeo.translate(0, 0.014, 0);
  place(antGeo, steelMat, ASIDE - AW * 0.30, AH + 0.007, AD * 0.28 + 0.006);

  // ── Small boat tied alongside pier ────────────
  const BOAT_L  = 0.066;
  const BOAT_BW = 0.021;
  const BOAT_H  = 0.012;
  const boatHullGeo = new THREE.CapsuleGeometry(BOAT_BW / 2, BOAT_L - BOAT_BW, 3, 8);
  boatHullGeo.rotateX(Math.PI / 2);
  boatHullGeo.translate(0, -BOAT_H * 0.3, 0);
  place(boatHullGeo, boatMat, -(W / 2 + BOAT_BW / 2 + 0.007), 0, LEN * 0.48 + BOAT_L * 0.15);
  const boatRimGeo = new THREE.BoxGeometry(BOAT_BW, 0.004, BOAT_L * 0.72);
  boatRimGeo.translate(0, BOAT_H * 0.15, 0);
  place(boatRimGeo, boatTrimMat, -(W / 2 + BOAT_BW / 2 + 0.007), 0, LEN * 0.48 + BOAT_L * 0.15);

  return { group, lampMat };
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

  const right   = new THREE.Vector3().crossVectors(normal, new THREE.Vector3(0, 1, 0)).normalize();
  const forward = new THREE.Vector3().crossVectors(right, normal).normalize();
  const up      = new THREE.Vector3(0, 1, 0);
  const quat    = new THREE.Quaternion().setFromUnitVectors(up, normal);

  const wallColor = s.id === 'central-lab'   ? 0xf2e6cc
                  : s.id === 'marine-lab'    ? 0xe8e8e0
                  :                            0xd0cfc8;
  const roofColor = s.id === 'central-lab'   ? 0xa03828
                  : s.id === 'marine-lab'    ? 0x2a4a60
                  :                            0x484848;
  const roofRatio = s.id === 'central-lab'   ? 0.72
                  : s.id === 'aerospace-lab' ? 0.18
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

  addBuilding(0.036, 0.030, 0.028,  0.000,  0.000);
  addBuilding(0.020, 0.020, 0.018,  0.030,  0.008);
  addBuilding(0.012, 0.038, 0.012, -0.024,  0.006);
  addBuilding(0.026, 0.015, 0.020,  0.004, -0.026);

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

  if (s.id === 'marine-lab') {
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

    const dockMat = new THREE.MeshLambertMaterial({ color: 0x8b6840 });
    const subMat  = new THREE.MeshLambertMaterial({ color: 0x2a3a2a });

    const pierLen = 0.075;
    const pierGeo = new THREE.BoxGeometry(0.012, 0.004, pierLen);
    pierGeo.translate(0, 0.002, 0);
    const pier = new THREE.Mesh(pierGeo, dockMat);
    const pierPos = normal.clone().multiplyScalar(r)
      .addScaledVector(forward, -pierLen / 2 - 0.018);
    pier.position.copy(pierPos); pier.quaternion.copy(quat); group.add(pier);

    const crossGeo = new THREE.BoxGeometry(0.040, 0.004, 0.010);
    crossGeo.translate(0, 0.002, 0);
    const cross = new THREE.Mesh(crossGeo, dockMat);
    const crossPos = normal.clone().multiplyScalar(r).addScaledVector(forward, -pierLen - 0.018);
    cross.position.copy(crossPos); cross.quaternion.copy(quat); group.add(cross);

    const postGeo = new THREE.CylinderGeometry(0.003, 0.003, 0.010, 5);
    const postMat = new THREE.MeshLambertMaterial({ color: 0x5a4020 });
    [[-0.014, -0.035], [0.014, -0.035], [-0.014, -0.065], [0.014, -0.065]].forEach(([or, of]) => {
      const post = new THREE.Mesh(postGeo, postMat);
      const pPos = normal.clone().multiplyScalar(r + 0.005)
        .addScaledVector(right, or).addScaledVector(forward, of);
      post.position.copy(pPos); post.quaternion.copy(quat); group.add(post);
    });

    const subHullGeo = new THREE.CapsuleGeometry(0.013, 0.058, 6, 8);
    subHullGeo.rotateZ(Math.PI / 2);
    const sub = new THREE.Mesh(subHullGeo, subMat);
    const subR = 1.006;
    const subPos = normal.clone().multiplyScalar(subR)
      .addScaledVector(right,   0.038)
      .addScaledVector(forward, -pierLen - 0.020);
    sub.position.copy(subPos); sub.quaternion.copy(quat); group.add(sub);

    const towerGeo = new THREE.BoxGeometry(0.012, 0.016, 0.010);
    towerGeo.translate(0, 0.020, 0);
    const tower = new THREE.Mesh(towerGeo, subMat);
    tower.position.copy(subPos); tower.quaternion.copy(quat); group.add(tower);
  }

  if (s.id === 'aerospace-lab') {
    const concreteMat = new THREE.MeshLambertMaterial({ color: 0xa0a0a0 });
    const gantryMat   = new THREE.MeshLambertMaterial({ color: 0xc07828 });
    const rocketMat   = new THREE.MeshLambertMaterial({ color: 0xf0ede8 });
    const shuttleMat  = new THREE.MeshLambertMaterial({ color: 0xf0ece4 });

    const runwayGeo = new THREE.BoxGeometry(0.140, 0.002, 0.018);
    runwayGeo.translate(0, 0.001, 0);
    const runway = new THREE.Mesh(runwayGeo, concreteMat);
    runway.position.copy(normal.clone().multiplyScalar(r).addScaledVector(right, 0.060));
    runway.quaternion.copy(quat); group.add(runway);

    const lineGeo = new THREE.BoxGeometry(0.120, 0.0025, 0.003);
    lineGeo.translate(0, 0.001, 0);
    const line = new THREE.Mesh(lineGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }));
    line.position.copy(normal.clone().multiplyScalar(r).addScaledVector(right, 0.060));
    line.quaternion.copy(quat); group.add(line);

    const padPos = normal.clone().multiplyScalar(r)
      .addScaledVector(right, -0.055).addScaledVector(forward, -0.018);

    const slabGeo = new THREE.BoxGeometry(0.042, 0.002, 0.042);
    slabGeo.translate(0, 0.001, 0);
    const slab = new THREE.Mesh(slabGeo, concreteMat);
    slab.position.copy(padPos); slab.quaternion.copy(quat); group.add(slab);

    const towerH = 0.090;
    const towerGeo = new THREE.BoxGeometry(0.005, towerH, 0.005);
    towerGeo.translate(0, towerH / 2, 0);
    const towerPos = padPos.clone().addScaledVector(right, -0.015).addScaledVector(forward, -0.015);
    const gantry = new THREE.Mesh(towerGeo, gantryMat);
    gantry.position.copy(towerPos); gantry.quaternion.copy(quat); group.add(gantry);

    const armGeo = new THREE.BoxGeometry(0.030, 0.004, 0.004);
    const arm = new THREE.Mesh(armGeo, gantryMat);
    arm.position.copy(towerPos.clone().addScaledVector(normal, towerH * 0.82));
    arm.quaternion.copy(quat); group.add(arm);

    const rocketH = 0.078;
    const rocketGeo = new THREE.CapsuleGeometry(0.008, rocketH, 4, 8);
    rocketGeo.translate(0, rocketH / 2 + 0.008, 0);
    const rocket = new THREE.Mesh(rocketGeo, rocketMat);
    rocket.position.copy(padPos); rocket.quaternion.copy(quat); group.add(rocket);

    const boosterMat = new THREE.MeshLambertMaterial({ color: 0xe0d8c8 });
    [-1, 1].forEach((side) => {
      const bGeo = new THREE.CapsuleGeometry(0.004, 0.048, 4, 6);
      bGeo.translate(0, 0.048 / 2 + 0.006, 0);
      const booster = new THREE.Mesh(bGeo, boosterMat);
      booster.position.copy(padPos.clone().addScaledVector(right, side * 0.013));
      booster.quaternion.copy(quat); group.add(booster);
    });

    const shuttlePos = normal.clone().multiplyScalar(r + 0.008)
      .addScaledVector(right, 0.060).addScaledVector(forward, -0.038);

    const sFuseGeo = new THREE.CapsuleGeometry(0.008, 0.040, 4, 8);
    sFuseGeo.rotateZ(Math.PI / 2);
    const sFuse = new THREE.Mesh(sFuseGeo, shuttleMat);
    sFuse.position.copy(shuttlePos); sFuse.quaternion.copy(quat); group.add(sFuse);

    [-1, 1].forEach((side) => {
      const dwGeo = new THREE.BoxGeometry(0.030, 0.002, 0.022);
      dwGeo.translate(side * 0.024, 0, 0);
      const dw = new THREE.Mesh(dwGeo, shuttleMat);
      dw.position.copy(shuttlePos); dw.quaternion.copy(quat); group.add(dw);
    });

    const sVStabGeo = new THREE.BoxGeometry(0.002, 0.014, 0.018);
    sVStabGeo.translate(0, 0.007, 0);
    const sVStab = new THREE.Mesh(sVStabGeo, shuttleMat);
    sVStab.position.copy(shuttlePos.clone().addScaledVector(right, -0.020));
    sVStab.quaternion.copy(quat); group.add(sVStab);
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

function makeFinPrism(
  p0: [number,number,number], p1: [number,number,number], p2: [number,number,number],
  thickAxis: [number,number,number],
): THREE.BufferGeometry {
  const [dx, dy, dz] = thickAxis;
  const pos = new Float32Array([
    p0[0]+dx, p0[1]+dy, p0[2]+dz,  p1[0]+dx, p1[1]+dy, p1[2]+dz,  p2[0]+dx, p2[1]+dy, p2[2]+dz,
    p0[0]-dx, p0[1]-dy, p0[2]-dz,  p1[0]-dx, p1[1]-dy, p1[2]-dz,  p2[0]-dx, p2[1]-dy, p2[2]-dz,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex([0,1,2, 3,5,4, 0,3,4, 0,4,1, 1,4,5, 1,5,2, 2,5,3, 2,3,0]);
  geo.computeVertexNormals();
  return geo;
}

function buildDolphin(): { group: THREE.Group; tail: THREE.Group } {
  const g   = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0x5a8aaa });

  const bodyGeo = new THREE.CapsuleGeometry(0.008, 0.036, 4, 8);
  bodyGeo.rotateX(Math.PI / 2);
  g.add(new THREE.Mesh(bodyGeo, mat));

  const rostrumGeo = new THREE.BoxGeometry(0.005, 0.004, 0.008);
  rostrumGeo.translate(0, 0.001, 0.030);
  g.add(new THREE.Mesh(rostrumGeo, mat));

  g.add(new THREE.Mesh(makeFinPrism(
    [0, 0.008,  0.004], [0, 0.008, -0.008], [0, 0.018, -0.001], [0.0015, 0, 0],
  ), mat));

  [-1, 1].forEach((s) => {
    g.add(new THREE.Mesh(makeFinPrism(
      [s*0.008, -0.001,  0.011], [s*0.008, -0.001,  0.002], [s*0.019, -0.003,  0.005], [0, 0.001, 0],
    ), mat));
  });

  const tail = new THREE.Group();
  tail.position.set(0, 0, -0.020);
  [-1, 1].forEach((s) => {
    tail.add(new THREE.Mesh(makeFinPrism(
      [s*0.001,  0,  0.002], [s*0.002,  0, -0.010], [s*0.020,  0, -0.007], [0, 0.0014, 0],
    ), mat));
  });
  g.add(tail);

  return { group: g, tail };
}

// ── Aurora crown geometry ────────────────────────────────
function buildAuroraCrown(): THREE.BufferGeometry {
  const N      = 96;
  const LAT_Y  = 0.88;
  const R_BASE = 1.02;
  const R_TOP  = 1.46;

  const r_ring = Math.sqrt(1 - LAT_Y * LAT_Y);
  const positions: number[] = [];
  const angles:    number[] = [];
  const heights:   number[] = [];
  const indices:   number[] = [];

  for (const pole of [-1, 1]) {
    const yF    = pole * LAT_Y;
    const vBase = positions.length / 3;

    for (let i = 0; i <= N; i++) {
      const a  = (i / N) * Math.PI * 2;
      const nx = r_ring * Math.cos(a);
      const nz = r_ring * Math.sin(a);

      positions.push(nx * R_BASE, yF * R_BASE, nz * R_BASE);
      angles.push(a); heights.push(0);
      positions.push(nx * R_TOP, yF * R_TOP, nz * R_TOP);
      angles.push(a); heights.push(1);
    }

    for (let i = 0; i < N; i++) {
      const v0 = vBase + i * 2;
      const v1 = vBase + i * 2 + 1;
      const v2 = vBase + (i + 1) * 2;
      const v3 = vBase + (i + 1) * 2 + 1;
      indices.push(v0, v2, v1,  v1, v2, v3);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('aAngle',   new THREE.BufferAttribute(new Float32Array(angles),   1));
  geo.setAttribute('aHeight',  new THREE.BufferAttribute(new Float32Array(heights),  1));
  geo.setIndex(indices);
  return geo;
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

  const fuseGeo = new THREE.CapsuleGeometry(0.009, 0.056, 4, 8);
  fuseGeo.rotateX(Math.PI / 2);
  g.add(new THREE.Mesh(fuseGeo, metalMat));

  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.080, 0.002, 0.012), metalMat));

  const hStab = new THREE.BoxGeometry(0.038, 0.002, 0.009);
  hStab.translate(0, 0, -0.034);
  g.add(new THREE.Mesh(hStab, metalMat));

  const vFin = new THREE.BoxGeometry(0.002, 0.018, 0.014);
  vFin.translate(0, 0.009, -0.032);
  g.add(new THREE.Mesh(vFin, metalMat));

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

  const navGeo = new THREE.SphereGeometry(0.0028, 4, 4);
  const navGreen = new THREE.Mesh(navGeo, new THREE.MeshBasicMaterial({ color: 0x00ee44, transparent: true }));
  navGreen.position.set(-0.040, 0, 0);
  const navRed = new THREE.Mesh(navGeo.clone(), new THREE.MeshBasicMaterial({ color: 0xff2222, transparent: true }));
  navRed.position.set(0.040, 0, 0);
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

  // Shared refs for button ↔ animation loop communication
  const mapModeRef     = useRef<'globe' | 'map'>('globe');
  const transActiveRef = useRef(false);
  const [mapModeDisplay, setMapModeDisplay] = useState<'globe' | 'map'>('globe');

  const toggleMap = useCallback(() => {
    if (transActiveRef.current) return;
    const next = mapModeRef.current === 'globe' ? 'map' : 'globe';
    mapModeRef.current = next;
    setMapModeDisplay(next);
  }, []);

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
    const GLOBE_Z = 4.0;
    const MAP_Z   = FLAT_H / Math.tan((camera.fov / 2) * Math.PI / 180);

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
    const {
      mesh: terrainMesh, tempTreePos, palmTreePos, height: getHeight,
      spherePositions: terrainSphPos, flatPositions: terrainFlatPos,
      sphereNormals: terrainSphNor,
      sphereColors: terrainSphCol, flatColors: terrainFlatCol,
    } = buildTerrain();
    const terrainPosBuf = terrainMesh.geometry.attributes.position as THREE.BufferAttribute;
    const terrainNorBuf = terrainMesh.geometry.attributes.normal   as THREE.BufferAttribute;
    const terrainColBuf = terrainMesh.geometry.attributes.color    as THREE.BufferAttribute;
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

    // ── Aurora ────────────────────────────────────────
    const auroraUniforms = { uTime: { value: 0 }, uNight: { value: 0 } };
    const aurora = new THREE.Mesh(
      buildAuroraCrown(),
      new THREE.ShaderMaterial({
        uniforms:           auroraUniforms,
        vertexShader:       AURORA_VERT,
        fragmentShader:     AURORA_FRAG,
        transparent:        true,
        depthWrite:         false,
        blending:           THREE.CustomBlending,
        blendEquation:      THREE.AddEquation,
        blendSrc:           THREE.OneFactor,
        blendDst:           THREE.OneFactor,
        blendEquationAlpha: THREE.AddEquation,
        blendSrcAlpha:      THREE.ZeroFactor,
        blendDstAlpha:      THREE.OneFactor,
        side:               THREE.DoubleSide,
      }),
    );
    aurora.renderOrder = 3;
    scene.add(aurora);

    // ── Trees ─────────────────────────────────────────
    const tempTrees = buildTemperateTrees(tempTreePos);
    const palmTrees = buildPalmTrees(palmTreePos);
    scene.add(tempTrees, palmTrees);

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

    // ── Grid ──────────────────────────────────────────
    const { lines: gridLines, spherePos: gridSpherePos, flatPos: gridFlatPos } = buildGrid();
    scene.add(gridLines);
    const gridPosBuf = gridLines.geometry.attributes.position as THREE.BufferAttribute;

    // ── Dark mode setup ───────────────────────────────
    const nightTintFactor = new THREE.Color(0.22, 0.25, 0.36);
    interface TintEntry { mat: THREE.MeshLambertMaterial; day: THREE.Color; night: THREE.Color }
    const tintEntries: TintEntry[] = [];
    const _tintColor = new THREE.Color();

    tintEntries.push({
      mat: terrainMesh.material as THREE.MeshLambertMaterial,
      day: new THREE.Color(1, 1, 1),
      night: new THREE.Color(nightTintFactor),
    });
    [tempTrees, palmTrees].forEach((group) => {
      group.traverse((obj) => {
        if (!(obj instanceof THREE.InstancedMesh)) return;
        const mat = obj.material as THREE.MeshLambertMaterial;
        const day = mat.color.clone();
        tintEntries.push({ mat, day, night: day.clone().multiply(nightTintFactor) });
      });
    });

    const daySunCol  = new THREE.Color(0xfff0d0);  const nightSunCol  = new THREE.Color(0xaabbee);
    const dayAmbCol  = new THREE.Color(0x445566);  const nightAmbCol  = new THREE.Color(0x05090f);
    const dayFillCol = new THREE.Color(0xaaccff);  const nightFillCol = new THREE.Color(0x0d1a35);

    let darkTarget = document.documentElement.dataset.theme === 'dark' ? 1.0 : 0.0;
    let darkBlend  = darkTarget;

    new MutationObserver(() => {
      darkTarget = document.documentElement.dataset.theme === 'dark' ? 1.0 : 0.0;
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    // ── Station buildings ──────────────────────────
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

    // Coastal pier at Marine Lab shoreline
    const marineVec = stationUnitVec(STATIONS.find(s => s.id === 'marine-lab')!);
    const { group: pierGroup, lampMat: pierLampMat } = buildCoastalPier(marineVec, getHeight);
    scene.add(pierGroup);
    stationGroups.push(pierGroup);       // rotates with planet, hides in flat-map mode
    stationEmissiveMats.push(pierLampMat); // lamp glows in dark mode

    // ── Animated airplane ──────────────────────────
    const aeroStation = STATIONS.find(s => s.id === 'aerospace-lab')!;
    const aeroVec     = stationUnitVec(aeroStation);
    const aeroRight   = new THREE.Vector3().crossVectors(aeroVec, new THREE.Vector3(0, 1, 0)).normalize();
    const aeroH       = getHeight(aeroVec.x, aeroVec.y, aeroVec.z);
    const planeParkR  = 1.0 + Math.max(aeroH, 0.010) + 0.012;
    const ORBIT_SPEED_VAL = (Math.PI * 2) / 35;
    const ORBIT_ALT       = 0.10;
    const TAKEOFF_SPAN    = 0.40;
    const PLANE_WAIT      = 8.0;

    const _pSide = new THREE.Vector3().crossVectors(aeroVec, aeroRight).normalize();
    const _pFwdO = new THREE.Vector3().crossVectors(_pSide, aeroVec).normalize();
    const planeParkQ = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(_pSide, aeroVec, _pFwdO)
    );

    const { group: planeGroup, windowMats: planeWindowMats, navGreen, navRed } = buildAnimatedPlane();
    scene.add(planeGroup);

    let planePhase: 'parked' | 'flying' = 'parked';
    let planeOrbitAngle = 0;
    let planeWaitTimer  = 5.0;

    // ── Wildlife ──────────────────────────────────
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
      state: 'swim' | 'jump'; timer: number; jumpProgress: number;
      wanderAngle: number; seed: number;
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
               wanderAngle: 0, seed: i * 2.7 };
    });

    // ── Station raycasting ─────────────────────────
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

    const orbGeo = new THREE.SphereGeometry(0.016, 10, 10);
    const orbs: THREE.Mesh[] = STATIONS.map((s, i) => {
      const orbMat = new THREE.MeshBasicMaterial({ color: s.color });
      const orb = new THREE.Mesh(orbGeo, orbMat);
      orb.position.copy(pinMeshes[i].position);
      scene.add(orb);
      return orb;
    });

    // ── Flat map station markers ──────────────────
    // Each station's flat XY position in world space
    const stationFlatXY = STATIONS.map((s) => {
      const sv  = stationUnitVec(s);
      const lat = Math.asin(Math.max(-1, Math.min(1, sv.y)));
      const lon = Math.atan2(sv.x, sv.z);
      return new THREE.Vector2(lon / Math.PI * FLAT_W, lat / (Math.PI * 0.5) * FLAT_H);
    });

    // Ring + dot meshes, both tracked explicitly
    const flatRings: THREE.Mesh[] = [];
    const flatDots:  THREE.Mesh[] = [];
    STATIONS.forEach((s, i) => {
      const { x, y } = stationFlatXY[i];
      const ringMat = new THREE.MeshBasicMaterial({
        color: s.color, transparent: true, opacity: 0,
        side: THREE.DoubleSide, depthWrite: false,
      });
      const dotMat = ringMat.clone();
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.022, 0.036, 32), ringMat);
      const dot  = new THREE.Mesh(new THREE.CircleGeometry(0.010, 24),      dotMat);
      ring.position.set(x, y, 0.015);
      dot.position.set(x,  y, 0.016);
      ring.renderOrder = 6; dot.renderOrder = 7;
      scene.add(ring); scene.add(dot);
      flatRings.push(ring); flatDots.push(dot);
    });

    // HTML labels appended to canvas container (position:absolute, clipped by parent overflow:hidden)
    const flatLabels: HTMLDivElement[] = STATIONS.map((s) => {
      const div = document.createElement('div');
      div.textContent = s.label;
      div.style.cssText = `
        position:absolute; pointer-events:none; z-index:150;
        color:#e8d8b8; font-family:'Palatino Linotype',Palatino,serif;
        font-size:0.68rem; letter-spacing:0.10em; text-transform:uppercase;
        text-shadow:0 1px 4px rgba(0,0,0,0.9);
        opacity:0; white-space:nowrap;
        transform:translateX(-50%);
      `;
      el.appendChild(div);
      return div;
    });

    // ── Tooltip ───────────────────────────────────
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

    // ── Raycasting ────────────────────────────────
    const raycaster = new THREE.Raycaster();
    const pointer   = new THREE.Vector2();

    function toNDC(e: PointerEvent) {
      const rect = el!.getBoundingClientRect();
      pointer.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
      pointer.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
    }

    function onMove(e: PointerEvent) {
      if (dragging || mapModeRef.current === 'map' || transActiveRef.current) return;
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
      if (dragMoved || mapModeRef.current === 'map' || transActiveRef.current) return;
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

    // ── Drag rotation ─────────────────────────────
    let dragging = false, dragMoved = false;
    let lastX = 0, lastY = 0;
    let velX = 0, velY = 0;

    // Initial rotation: centers Central Lab (phi=1.35, theta=0.5) toward camera
    // rotX ≈ atan(ny/nz), rotY ≈ atan2(-nx, nz_after_rotX)
    let rotY = -1.029;
    let rotX =  0.438;

    el.addEventListener('pointerdown', (e) => {
      if (mapModeRef.current === 'map' || transActiveRef.current) return;
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

    // ── Resize ────────────────────────────────────
    const onResize = () => {
      camera.aspect = el.clientWidth / el.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(el.clientWidth, el.clientHeight);
    };
    window.addEventListener('resize', onResize);

    // ── Map transition state ───────────────────────
    let prevMapMode: 'globe' | 'map' = 'globe';
    let transDir    = 1;    // +1 = going to map, -1 = going to globe
    let transElapsed = 0;
    let mapBlend    = 0;    // 0 = globe, 1 = flat  (current rendered value)
    let savedRotX   = rotX;
    let savedRotY   = rotY;

    // "Secondary" mesh visibility (ocean, trees, buildings, aurora, atm)
    // they fade out while going to map and fade in while going to globe
    const secondaryMeshes: THREE.Object3D[] = [
      ocean, aurora, atm1, atm2, tempTrees, palmTrees,
      ...stationGroups, planeGroup,
      ...parrots.map(p => p.group),
      ...dolphins.map(d => d.group),
    ];
    let secondaryOpacity = 1; // 0 = hidden, 1 = visible

    function setSecondaryOpacity(alpha: number) {
      secondaryOpacity = alpha;
      // ocean uses ShaderMaterial — opacity property has no effect, use visible
      ocean.visible = alpha > 0.01;
      [atm1, atm2].forEach(m => {
        (m.material as THREE.MeshBasicMaterial).opacity = alpha *
          (m === atm1 ? 0.07 : 0.05);
      });
      aurora.visible = alpha > 0.01;
      [tempTrees, palmTrees].forEach(g => {
        g.traverse(obj => {
          if (obj instanceof THREE.InstancedMesh) {
            obj.visible = alpha > 0.01;
          }
        });
      });
      stationGroups.forEach(g => { g.visible = alpha > 0.01; });
      planeGroup.visible = alpha > 0.01;
      parrots.forEach(p => { p.group.visible = alpha > 0.01; });
      dolphins.forEach(d => { d.group.visible = alpha > 0.01; });
      orbs.forEach(orb => { orb.visible = alpha > 0.01; });
      pinMeshes.forEach(pin => { pin.visible = alpha > 0.01; });
    }

    // ── Animation loop ────────────────────────────
    let raf: number;
    const t0 = performance.now();
    const euler = new THREE.Euler();
    let prevT = 0;
    const planetQuat = new THREE.Quaternion();

    function easeInOut(t: number): number {
      return t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
    }

    function animate() {
      raf = requestAnimationFrame(animate);
      const t = (performance.now() - t0) / 1000;
      const dt = Math.min(t - prevT, 0.05);
      prevT = t;
      oceanUniforms.uTime.value  = t;
      auroraUniforms.uTime.value = t;
      starUniforms.uTime.value   = t;

      // ── Map mode transition detection ─────────────
      const currentMapMode = mapModeRef.current;
      if (currentMapMode !== prevMapMode) {
        prevMapMode = currentMapMode;
        transDir    = currentMapMode === 'map' ? 1 : -1;
        transElapsed = 0;
        transActiveRef.current = true;
        if (transDir === 1) {
          // Going to map: save current rotation
          savedRotX = rotX;
          savedRotY = rotY;
          velX = velY = 0;
        }
      }

      // ── Transition update ─────────────────────────
      if (transActiveRef.current) {
        transElapsed += dt;
        const tNorm = Math.min(transElapsed / T_TOTAL, 1);

        // Grid opacity: in for first segment, out for last segment
        let gridOpacity: number;
        const tIn  = T_GRID_IN / T_TOTAL;
        const tOut = (T_GRID_IN + T_MORPH) / T_TOTAL;
        if (tNorm < tIn) {
          gridOpacity = easeInOut(tNorm / tIn);
        } else if (tNorm < tOut) {
          gridOpacity = 1;
        } else {
          gridOpacity = easeInOut(1 - (tNorm - tOut) / (T_GRID_OUT / T_TOTAL));
        }
        (gridLines.material as THREE.LineBasicMaterial).opacity = gridOpacity * 0.55;

        // Morph blend: ramps during middle segment
        let morphProgress: number;
        if (tNorm <= tIn) {
          morphProgress = 0;
        } else if (tNorm >= tOut) {
          morphProgress = 1;
        } else {
          morphProgress = easeInOut((tNorm - tIn) / (T_MORPH / T_TOTAL));
        }

        // Secondary mesh opacity: fade out fast then stay out (or in)
        const secAlpha = transDir === 1
          ? Math.max(0, 1 - morphProgress * 3)     // globe→map: fade out quickly
          : Math.min(1, (morphProgress - 0.7) * 3); // map→globe: fade in at end
        setSecondaryOpacity(Math.max(0, Math.min(1, secAlpha)));

        const blendTarget = transDir === 1 ? morphProgress : 1 - morphProgress;
        mapBlend = blendTarget;

        // CPU-lerp grid positions
        const ga = gridPosBuf.array as Float32Array;
        for (let i = 0; i < gridPosBuf.count * 3; i++) {
          ga[i] = gridSpherePos[i] + (gridFlatPos[i] - gridSpherePos[i]) * mapBlend;
        }
        gridPosBuf.needsUpdate = true;

        // CPU-lerp terrain positions + normals toward (0,0,1) + colors toward flat ocean
        const ta = terrainPosBuf.array as Float32Array;
        const na = terrainNorBuf.array as Float32Array;
        const ca = terrainColBuf.array as Float32Array;
        const mb = mapBlend, mb1 = 1 - mapBlend;
        for (let i = 0; i < terrainPosBuf.count; i++) {
          const si = i * 3;
          ta[si]   = terrainSphPos[si]   * mb1 + terrainFlatPos[si]   * mb;
          ta[si+1] = terrainSphPos[si+1] * mb1 + terrainFlatPos[si+1] * mb;
          ta[si+2] = terrainSphPos[si+2] * mb1 + terrainFlatPos[si+2] * mb;
          // Blend normals: sphere normals → (0,0,1) so flat terrain is lit from camera
          na[si]   = terrainSphNor[si]   * mb1;
          na[si+1] = terrainSphNor[si+1] * mb1;
          na[si+2] = terrainSphNor[si+2] * mb1 + mb;
          // Blend colors: seafloor → ocean blue for h<0 areas
          ca[si]   = terrainSphCol[si]   * mb1 + terrainFlatCol[si]   * mb;
          ca[si+1] = terrainSphCol[si+1] * mb1 + terrainFlatCol[si+1] * mb;
          ca[si+2] = terrainSphCol[si+2] * mb1 + terrainFlatCol[si+2] * mb;
        }
        terrainPosBuf.needsUpdate = true;
        terrainNorBuf.needsUpdate = true;
        terrainColBuf.needsUpdate = true;

        if (tNorm >= 1) {
          transActiveRef.current = false;
          (gridLines.material as THREE.LineBasicMaterial).opacity = 0;
          // Ensure secondary objects land at correct final opacity
          setSecondaryOpacity(transDir === 1 ? 0 : 1);
        }
      }

      // ── Dark mode blend ────────────────────────────
      darkBlend += (darkTarget - darkBlend) * 0.04;
      oceanUniforms.uNight.value  = darkBlend;
      auroraUniforms.uNight.value = darkBlend;

      // Zoom camera toward flat map so it fills the viewport
      camera.position.z = GLOBE_Z + (MAP_Z - GLOBE_Z) * mapBlend;

      // In flat mode boost ambient so vertex colors show correctly on flat normals
      const flatLit = mapBlend;
      sun.color.copy(daySunCol).lerp(nightSunCol, darkBlend);
      sun.intensity   = (2.4 - 1.9 * darkBlend) * (1 - flatLit * 0.85);
      ambient.color.copy(dayAmbCol).lerp(nightAmbCol, darkBlend);
      ambient.intensity = (1.0 - 0.4 * darkBlend) + flatLit * 1.2;
      fill.color.copy(dayFillCol).lerp(nightFillCol, darkBlend);
      fill.intensity  = (0.4 - 0.25 * darkBlend) * (1 - flatLit * 0.6);

      // Flat map station markers — fade in near end of transition
      flatRings.forEach((ring, i) => {
        const alpha = mapBlend * (0.55 + 0.45 * Math.sin(t * 2.5 + i * 2.1));
        (ring.material as THREE.MeshBasicMaterial).opacity = alpha;
        (flatDots[i].material as THREE.MeshBasicMaterial).opacity = mapBlend * 0.9;

        // Project flat 3D position to canvas pixel coords for HTML label
        const wp = new THREE.Vector3(stationFlatXY[i].x, stationFlatXY[i].y, 0.015);
        wp.project(camera);
        const sx = ( wp.x * 0.5 + 0.5) * el.clientWidth;
        const sy = (-wp.y * 0.5 + 0.5) * el.clientHeight;
        const lbl = flatLabels[i];
        lbl.style.opacity = String(Math.min(1, mapBlend * 2));
        lbl.style.left    = `${sx}px`;
        lbl.style.top     = `${sy + 24}px`;
      });

      tintEntries.forEach(({ mat, day, night }) => {
        _tintColor.copy(day).lerp(night, darkBlend);
        mat.color.copy(_tintColor);
      });

      // ── Rotation (globe mode only) ─────────────────
      if (!dragging && mapBlend < 1) {
        velX *= 0.92;
        velY *= 0.92;
        rotY += velX;
        rotX = Math.max(-0.55, Math.min(0.55, rotX + velY));
      }

      // In map mode, rotation fades to 0 as mapBlend increases
      const dispRotX = rotX * (1 - mapBlend);
      const dispRotY = rotY * (1 - mapBlend);
      euler.set(dispRotX, dispRotY, 0);
      planetQuat.setFromEuler(euler);

      terrainMesh.rotation.copy(euler);
      ocean.rotation.copy(euler);
      aurora.rotation.copy(euler);
      tempTrees.rotation.copy(euler);
      palmTrees.rotation.copy(euler);
      gridLines.rotation.copy(euler);
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
      if (mapBlend < 0.01) {
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
        planeWindowMats.forEach(m => { m.emissiveIntensity = darkBlend * 0.7; });
        const blinkOn = Math.floor(t * 1.5) % 2 === 0;
        (navGreen.material as THREE.MeshBasicMaterial).opacity = blinkOn ? 1.0 : 0.0;
        (navRed.material   as THREE.MeshBasicMaterial).opacity = blinkOn ? 1.0 : 0.0;
      }

      // ── Orbs ────────────────────────────────────────
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

      pinMeshes.forEach((pin, i) => { pin.position.copy(orbs[i].position); });

      // ── Parrots ─────────────────────────────────────
      if (mapBlend < 0.01) {
        for (const p of parrots) {
          p.timer -= dt;
          if (p.state === 'fly') {
            stepSphere(p.pos, p.dir, 0.20 * dt, p.turnBias);
            const flap = Math.sin(t * 14) * 0.75;
            p.lWing.rotation.z =  flap;
            p.rWing.rotation.z = -flap;
            placeAnimal(p.group, p.pos, p.dir, 1.025, planetQuat);
            if (p.timer <= 0) { p.state = 'perch'; p.timer = 2.5 + Math.random() * 4.0; }
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

        // ── Dolphins ──────────────────────────────────
        for (const d of dolphins) {
          d.timer -= dt;
          if (d.state === 'swim') {
            d.wanderAngle += (Math.random() - 0.5) * 0.003;
            d.wanderAngle *= 0.97;
            d.wanderAngle = Math.max(-0.018, Math.min(0.018, d.wanderAngle));
            const ahead = d.pos.clone().addScaledVector(d.dir, 0.18).normalize();
            const aheadH = getHeight(ahead.x, ahead.y, ahead.z);
            const tb = d.wanderAngle + (aheadH > 0.004 ? 0.022 : 0);
            stepSphere(d.pos, d.dir, 0.10 * dt, tb);
            const swing = Math.sin(t * 6.5 + d.seed);
            d.tail.rotation.x = swing * 0.45;
            const bobR = 1.003 + Math.sin(t * 2.8 + d.seed) * 0.003;
            placeAnimal(d.group, d.pos, d.dir, bobR, planetQuat);
            d.group.quaternion.multiply(
              new THREE.Quaternion().setFromAxisAngle(
                new THREE.Vector3(1, 0, 0), Math.sin(t * 6.5 + d.seed + 0.5) * 0.06,
              )
            );
            if (d.timer <= 0) { d.state = 'jump'; d.timer = 1.2; d.jumpProgress = 0; }
          } else {
            d.jumpProgress += dt / 1.2;
            const arc = Math.sin(Math.min(d.jumpProgress, 1.0) * Math.PI);
            d.tail.rotation.x = Math.sin(t * 4.0) * 0.30;
            placeAnimal(d.group, d.pos, d.dir, 1.003 + arc * 0.065, planetQuat);
            d.group.quaternion.multiply(
              new THREE.Quaternion().setFromAxisAngle(
                new THREE.Vector3(1, 0, 0),
                (d.jumpProgress < 0.5 ? -1 : 1) * arc * 0.7,
              )
            );
            if (d.timer <= 0) { d.state = 'swim'; d.timer = 7.0 + Math.random() * 8.0; }
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
      flatLabels.forEach(div => { if (el.contains(div)) el.removeChild(div); });
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointerup', () => { dragging = false; });
    };
  }, [base]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}>
      <div
        ref={mountRef}
        style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}
      />
      <button
        onClick={toggleMap}
        style={{
          position: 'absolute',
          bottom: '1.6rem',
          left: '1.6rem',
          zIndex: 100,
          background: 'rgba(10, 18, 30, 0.72)',
          color: '#c8d8e8',
          border: '1px solid rgba(140, 180, 220, 0.35)',
          borderRadius: '4px',
          fontFamily: "'Courier New', Courier, monospace",
          fontSize: '0.72rem',
          letterSpacing: '0.12em',
          padding: '0.5em 0.7em',
          cursor: 'pointer',
          backdropFilter: 'blur(6px)',
          textTransform: 'uppercase',
          transition: 'border-color 0.2s, color 0.2s',
          userSelect: 'none',
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(140,200,255,0.7)';
          (e.currentTarget as HTMLButtonElement).style.color = '#e8f4ff';
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(140,180,220,0.35)';
          (e.currentTarget as HTMLButtonElement).style.color = '#c8d8e8';
        }}
      >
        {mapModeDisplay === 'globe' ? (
          /* flat-map icon: rectangle with grid lines */
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <rect x="2" y="5" width="16" height="10" rx="1"/>
            <line x1="7.5" y1="5" x2="7.5" y2="15"/>
            <line x1="12.5" y1="5" x2="12.5" y2="15"/>
            <line x1="2" y1="10" x2="18" y2="10"/>
          </svg>
        ) : (
          /* globe icon: circle with meridian and equator */
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="10" cy="10" r="7.5"/>
            <ellipse cx="10" cy="10" rx="3.8" ry="7.5"/>
            <line x1="2.5" y1="10" x2="17.5" y2="10"/>
          </svg>
        )}
      </button>
    </div>
  );
}
