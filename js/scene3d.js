/*
 * 절대 색감 — 3D 장면 (three.js)
 * 비스듬히 내려다보는 카메라, 팔레트, 두께가 있는 물감 면, 물감 튜브 8개, 헤라, 돋보기.
 * 물감의 섞임·양은 game.js 가 격자로 계산하고, 여기서는 그 결과(두께·색 텍스처)를 그리기만 한다.
 *
 * 좌표: 팔레트 가운데가 원점, x 오른쪽, z 화면 아래쪽(카메라 쪽), y 위.
 * 격자 (gx, gy) ↔ 월드 (x, z) : x = -PW/2 + gx*CELL, z = -PD/2 + gy*CELL
 */
import * as THREE from 'three';
import { RoomEnvironment } from '../vendor/three/RoomEnvironment.js';

export const PW = 9, PD = 12;           // 팔레트 가로·세로 (월드 단위)
const PAL_T = 0.1;                      // 팔레트 두께 (윗면 높이)
const HSCALE = 0.55;                    // 물감 두께 1 → 월드 높이
const TUBE_Z = 7.55;                    // 튜브가 서 있는 줄
const TUBE_GAP = 1.1;
// 조명 아래 평평한 물감이 원래 색으로 보이도록 맞춘 밝기 보정 (test/calibrate 로 측정)
export const EXPOSURE = 0.82;
// 같은 빛에서 물감 재질(광택 코팅)이 팔레트보다 어둡게 나와서 물감 색만 따로 보정
const PAINT_GAIN = 1.5;

export function createScene(canvas, opts) {
  const { GX, GY, pigments, lensR, bg } = opts;
  const CELL = PW / GX;
  const toWorld = (gx, gy) => [-PW / 2 + gx * CELL, -PD / 2 + gy * CELL];
  const toGrid = (x, z) => [(x + PW / 2) / CELL, (z + PD / 2) / CELL];

  // ---------- 렌더러 ----------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.LinearToneMapping;
  renderer.toneMappingExposure = EXPOSURE;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(bg);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  scene.environment = envTex;

  const camera = new THREE.PerspectiveCamera(30, 1, 1, 200);

  // ---------- 조명 ----------
  const key = new THREE.DirectionalLight(0xffffff, 1.25);
  key.position.set(-7, 18, -6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -11, right: 11, top: 13, bottom: -13, near: 1, far: 50 });
  key.shadow.bias = -0.0025;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 4;
  scene.add(key);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8d8f94, 0.25));

  // ---------- 탁자 (그림자만 받음) + 팔레트 ----------
  const table = new THREE.Mesh(new THREE.PlaneGeometry(120, 120).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.22 }));
  table.receiveShadow = true;
  scene.add(table);

  const palette = new THREE.Mesh(
    new THREE.BoxGeometry(PW, PAL_T, PD),
    new THREE.MeshStandardMaterial({ color: opts.paper, roughness: 0.6, metalness: 0, envMapIntensity: 0.45 }),
  );
  palette.position.y = PAL_T / 2;
  palette.castShadow = true; palette.receiveShadow = true;
  scene.add(palette);

  // ---------- 물감 면 ----------
  // 두께(높이)·색 텍스처는 game.js 가 칸당 RS×RS 해상도로 만들어 넘겨준다
  let texW = 0, texH = 0, heightTex = null, colorTex = null;
  const uniforms = {
    uHeight: { value: null }, uColor: { value: null },
    uTexel: { value: new THREE.Vector2(1, 1) }, uHS: { value: HSCALE },
    uSize: { value: new THREE.Vector2(PW, PD) }, uGain: { value: PAINT_GAIN },
  };
  const paintMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.34, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.2,
    envMapIntensity: 0.25, transparent: true,
  });
  paintMat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uHeight; uniform float uHS; varying vec2 vPUv;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vPUv = uv;
        transformed.y += texture2D(uHeight, uv).r * uHS;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uHeight; uniform sampler2D uColor; uniform vec2 uTexel; uniform float uHS; uniform vec2 uSize; uniform float uGain;
        varying vec2 vPUv;`)
      .replace('#include <map_fragment>', `
        vec4 pc = texture2D(uColor, vPUv);
        // pc.a = 두께/(2·COV1). 덮임 경계를 픽셀 단위로 계산 (칸 계단 없이 매끈하고 또렷한 물감 가장자리)
        float aw = max(fwidth(pc.a), 0.004);
        float cov = smoothstep(0.30 - aw, 0.40 + aw, pc.a);   // 경계는 또렷하게, 계단 없이
        if (cov < 0.01) discard;
        diffuseColor.rgb *= pc.rgb * uGain;
        diffuseColor.a *= cov;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          float hL = texture2D(uHeight, vPUv - vec2(uTexel.x, 0.0)).r;
          float hR = texture2D(uHeight, vPUv + vec2(uTexel.x, 0.0)).r;
          float hU = texture2D(uHeight, vPUv + vec2(0.0, uTexel.y)).r;   // v+ = 화면 위쪽(-z)
          float hD = texture2D(uHeight, vPUv - vec2(0.0, uTexel.y)).r;
          float dx = (hR - hL) * uHS / (2.0 * uTexel.x * uSize.x);
          float dz = (hD - hU) * uHS / (2.0 * uTexel.y * uSize.y);
          vec3 nW = normalize(vec3(-dx, 1.0, -dz));
          normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
        }`)
      .replace('#include <clearcoat_normal_fragment_maps>', `#include <clearcoat_normal_fragment_maps>
        clearcoatNormal = normal;`);
  };
  // 물감도 그림자를 드리우도록, 그림자용 깊이 재질에도 같은 높이 변형을 넣는다
  const paintDepthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  paintDepthMat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uHeight; uniform float uHS; varying vec2 vPUv;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vPUv = uv;
        transformed.y += texture2D(uHeight, uv).r * uHS;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uColor; varying vec2 vPUv;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        if (texture2D(uColor, vPUv).a < 0.35) discard;`);
  };
  let paintMesh = null;
  function buildPaintMesh(w, h) {
    if (paintMesh) { scene.remove(paintMesh); paintMesh.geometry.dispose(); }
    const geo = new THREE.PlaneGeometry(PW, PD, w - 1, h - 1).rotateX(-Math.PI / 2);
    paintMesh = new THREE.Mesh(geo, paintMat);
    paintMesh.position.y = PAL_T + 0.002;
    paintMesh.receiveShadow = true;
    paintMesh.castShadow = true;
    paintMesh.customDepthMaterial = paintDepthMat;
    paintMesh.renderOrder = 1;
    scene.add(paintMesh);
  }

  /** heightHalf: Uint16Array(w*h) half-float, colorRGBA: Uint8Array(w*h*4) sRGB + 덮임(alpha). 행 0 = 팔레트 위쪽(-z) */
  function updatePaint(w, h, heightHalf, colorRGBA) {
    if (w !== texW || h !== texH) {
      texW = w; texH = h;
      heightTex && heightTex.dispose(); colorTex && colorTex.dispose();
      heightTex = new THREE.DataTexture(heightHalf, w, h, THREE.RedFormat, THREE.HalfFloatType);
      colorTex = new THREE.DataTexture(colorRGBA, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
      colorTex.colorSpace = THREE.SRGBColorSpace;
      for (const t of [heightTex, colorTex]) {
        t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
        t.flipY = true;                      // 데이터 행 0(위쪽) → uv v=1(-z)
        t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      }
      uniforms.uHeight.value = heightTex; uniforms.uColor.value = colorTex;
      uniforms.uTexel.value.set(1 / w, 1 / h);
      buildPaintMesh(w, h);
    } else {
      heightTex.image.data = heightHalf; colorTex.image.data = colorRGBA;
    }
    heightTex.needsUpdate = true; colorTex.needsUpdate = true;
  }

  // ---------- 공통 재질 ----------
  const chrome = new THREE.MeshStandardMaterial({ color: 0xdfe2e6, metalness: 0.85, roughness: 0.28, envMapIntensity: 1.0 });
  const greyPlastic = new THREE.MeshStandardMaterial({ color: 0xbfc2c6, metalness: 0.1, roughness: 0.45 });
  const darkPlastic = new THREE.MeshStandardMaterial({ color: 0x1d1d20, metalness: 0.1, roughness: 0.4 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4228, metalness: 0, roughness: 0.55 });
  const shadowAll = o => o.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });

  // ---------- 튜브 ----------
  // 서 있는 튜브: 바닥(납작하게 접힌 끝) → 몸통 → 어깨 → 목 → 뚜껑(톱니 왕관)
  function makeTube(css) {
    const g = new THREE.Group();
    const R = 0.31;
    const base = new THREE.Mesh(new THREE.BoxGeometry(R * 2.2, 0.16, R * 1.5), greyPlastic);   // 받침
    base.position.y = 0.08; g.add(base);
    const crimp = new THREE.Mesh(new THREE.BoxGeometry(R * 2.05, 0.3, 0.12), chrome);          // 납작하게 접힌 끝
    crimp.position.y = 0.3; g.add(crimp);
    const body = new THREE.Mesh(new THREE.LatheGeometry([
      new THREE.Vector2(0.1, 0.42), new THREE.Vector2(R * 0.92, 0.55), new THREE.Vector2(R, 0.75),
      new THREE.Vector2(R, 2.35), new THREE.Vector2(R * 0.9, 2.52), new THREE.Vector2(0.15, 2.64),
    ], 40), chrome);
    g.add(body);
    const label = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.006, R + 0.006, 1.05, 40, 1, true),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(css), metalness: 0.05, roughness: 0.45 }));
    label.position.y = 1.4; g.add(label);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.16, 20), chrome);
    neck.position.y = 2.7; g.add(neck);
    // 뚜껑 (잡으면 사라지고 노즐 끝 물감이 보인다)
    const cap = new THREE.Group();
    const capBody = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.34, 12), greyPlastic);
    capBody.position.y = 0.17; cap.add(capBody);
    for (let k = 0; k < 6; k++) {                       // 왕관 모양 톱니
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.09), greyPlastic);
      const a = k / 6 * Math.PI * 2;
      t.position.set(Math.cos(a) * 0.15, 0.39, Math.sin(a) * 0.15); t.rotation.y = -a; cap.add(t);
    }
    cap.position.y = 2.77; g.add(cap);
    const drop = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12),
      new THREE.MeshPhysicalMaterial({ color: new THREE.Color(css), roughness: 0.25, clearcoat: 0.6 }));
    drop.position.y = 2.8; drop.visible = false; g.add(drop);
    shadowAll(g);
    g.userData = { cap, drop };
    return g;
  }
  const tubes = pigments.map((p, i) => {
    const t = makeTube(p.css);
    t.userData.index = i;
    t.userData.rest = new THREE.Vector3((i - (pigments.length - 1) / 2) * TUBE_GAP, 0, TUBE_Z);
    t.position.copy(t.userData.rest);
    scene.add(t);
    return t;
  });

  // ---------- 헤라 (팔레트 나이프) ----------
  // 원점 = 날 끝. 날은 -x 쪽으로 뻗고, 손잡이는 +x 쪽
  const knife = new THREE.Group();
  {
    const s = new THREE.Shape();
    s.moveTo(0, 0); s.quadraticCurveTo(0.45, 0.32, 1.25, 0.22); s.lineTo(1.4, 0); s.lineTo(1.25, -0.22); s.quadraticCurveTo(0.45, -0.32, 0, 0);
    const blade = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.025, bevelEnabled: false }).rotateX(Math.PI / 2), chrome);
    blade.position.y = 0.03; knife.add(blade);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.75, 10).rotateZ(Math.PI / 2), chrome);
    neck.position.set(1.72, 0.16, 0); neck.rotation.z = -0.38; knife.add(neck);
    const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.22, 16).rotateZ(Math.PI / 2), chrome);
    ferrule.position.set(2.18, 0.3, 0); knife.add(ferrule);
    const handle = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 1.5, 6, 16).rotateZ(Math.PI / 2), wood);
    handle.position.set(3.1, 0.34, 0); knife.add(handle);
    knife.children.forEach(m => { m.castShadow = true; });
  }
  scene.add(knife);
  const KNIFE_REST = { x: 0.9, z: 3.0, yaw: -Math.PI / 4 };   // 팔레트 오른쪽 아래, 손잡이가 오른쪽 아래로

  // ---------- 돋보기 ----------
  const lensRw = lensR * CELL;
  const LENS_H = 0.42;
  const lens = new THREE.Group();
  {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(lensRw, 0.065, 16, 64).rotateX(Math.PI / 2), chrome);
    lens.add(ring);
    const glass = new THREE.Mesh(new THREE.CircleGeometry(lensRw, 64).rotateX(-Math.PI / 2),
      new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.12, clearcoat: 1, envMapIntensity: 1.2, depthWrite: false }));
    glass.renderOrder = 2; lens.add(glass);
    const hand = new THREE.Group();
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.32, 12).rotateZ(Math.PI / 2), chrome);
    neck.position.x = lensRw + 0.2; hand.add(neck);
    const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 1.05, 6, 16).rotateZ(Math.PI / 2), darkPlastic);
    grip.position.x = lensRw + 0.95; hand.add(grip);
    hand.rotation.y = -Math.PI / 4;                       // 손잡이: 오른쪽 아래(+x, +z)
    lens.add(hand);
    ring.castShadow = true; neck.castShadow = true; grip.castShadow = true;
  }
  lens.position.y = PAL_T + LENS_H;
  scene.add(lens);

  // ---------- 카메라 맞추기 ----------
  let W = 1, H = 1, topRoom = 0;           // topRoom: 팔레트 위에 띄울 HTML 목표 카드 자리(px)
  let ELEV = 54 * Math.PI / 180;                         // 내려다보는 각도 (세로로 긴 화면은 더 위에서)
  const bounds = [
    [-PW / 2, 0, -PD / 2], [PW / 2, 0, -PD / 2], [-PW / 2, 0, PD / 2], [PW / 2, 0, PD / 2],
    [-4.2, 3.3, TUBE_Z], [4.2, 3.3, TUBE_Z], [-4.3, 0, TUBE_Z + 0.4], [4.3, 0, TUBE_Z + 0.4],
  ].map(v => new THREE.Vector3(...v));
  const tmp = new THREE.Vector3();
  function place(dist, tz) {
    camera.position.set(0, Math.sin(ELEV) * dist, tz + Math.cos(ELEV) * dist);
    camera.lookAt(0, 0, tz);
    camera.updateMatrixWorld(); camera.updateProjectionMatrix();
  }
  function ndcBox() {
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const b of bounds) { tmp.copy(b).project(camera); x0 = Math.min(x0, tmp.x); x1 = Math.max(x1, tmp.x); y0 = Math.min(y0, tmp.y); y1 = Math.max(y1, tmp.y); }
    return { x0, x1, y0, y1 };
  }
  function fit() {
    camera.aspect = W / H; camera.updateProjectionMatrix();
    const asp = W / H;
    ELEV = (asp < 0.62 ? 60 : asp < 0.9 ? 57 : 52) * Math.PI / 180;
    let tz = 1.2, lo = 5, hi = 200;
    for (let it = 0; it < 3; it++) {
      lo = 5; hi = 200;
      const yTop = 0.97 - (topRoom / H) * 2;
      for (let k = 0; k < 40; k++) {
        const mid = (lo + hi) / 2; place(mid, tz);
        const b = ndcBox();
        if (b.x0 < -0.97 || b.x1 > 0.97 || b.y0 < -0.97 || b.y1 - b.y0 > yTop + 0.97) lo = mid; else hi = mid;
      }
      place(hi, tz);
      // 남는 세로 공간은 위아래로 나눈다 (목표 카드는 팔레트 바로 위에 붙여서 그린다)
      const b = ndcBox(), top = 0.97 - (topRoom / H) * 2;
      const want = (top + -0.97) / 2, mid = (b.y0 + b.y1) / 2;
      tz -= (mid - want) * 6;
    }
    place(hi, tz);
  }

  function resize(w, h, dpr, room = 0) {
    W = w; H = h; topRoom = room;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    fit();
  }

  // ---------- 화면 ↔ 팔레트 ----------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), -PAL_T);
  function setRay(cx, cy) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  }
  /** 화면 좌표 → 팔레트 면(위로 lift 만큼 띄운 평면) 위 격자 좌표 */
  function pick(cx, cy, lift = 0) {
    setRay(cx, cy);
    ground.constant = -(PAL_T + lift);
    const p = ray.ray.intersectPlane(ground, tmp);
    if (!p) return null;
    const [gx, gy] = toGrid(p.x, p.z);
    return { gx, gy, x: p.x, z: p.z };
  }
  function pickTube(cx, cy) {
    setRay(cx, cy);
    const hit = ray.intersectObjects(tubes, true)[0];
    if (!hit) return -1;
    let o = hit.object; while (o && o.userData.index === undefined) o = o.parent;
    return o ? o.userData.index : -1;
  }
  /** 격자 좌표(팔레트 면) → 캔버스 안 CSS 픽셀 */
  function project(gx, gy, y = PAL_T) {
    const [x, z] = toWorld(gx, gy);
    tmp.set(x, y, z).project(camera);
    return [(tmp.x + 1) / 2 * W, (1 - tmp.y) / 2 * H];
  }
  function tubeScreen(i) {
    const t = tubes[i]; tmp.copy(t.userData.rest); tmp.y = 1.0; tmp.project(camera);
    return [(tmp.x + 1) / 2 * W, (1 - tmp.y) / 2 * H];
  }
  /** 화면에서 팔레트 위쪽 모서리 폭 (HTML 목표 카드 폭 맞추기용) */
  function paletteTopEdge() {
    const a = project(0, 0), b = project(GX, 0);
    return { left: a[0], right: b[0], top: a[1] };
  }

  // ---------- 상태 반영 ----------
  function setLens(gx, gy) { const [x, z] = toWorld(gx, gy); lens.position.x = x; lens.position.z = z; }
  /** 들고 있는 튜브: 노즐 끝이 (gx, gy) 위에 오도록 거꾸로 기울여 든다. idx<0 이면 모두 제자리 */
  const HELD_TILT = 2.6;                                  // 거의 거꾸로 (노즐이 아래)
  function setHeldTube(idx, gx, gy) {
    tubes.forEach((t, i) => {
      const held = i === idx;
      t.userData.cap.visible = !held;
      t.userData.drop.visible = held;
      if (!held) { t.position.copy(t.userData.rest); t.rotation.set(0, 0, 0); return; }
      const [x, z] = toWorld(gx, gy);
      t.rotation.set(-HELD_TILT, 0, 0);
      // 노즐 끝(로컬 y≈2.2)이 팔레트 위 0.25 에 오게
      const tip = new THREE.Vector3(0, 2.86, 0).applyEuler(t.rotation);
      t.position.set(x - tip.x, PAL_T + 0.25 - tip.y, z - tip.z);
    });
  }
  let knifeYaw = KNIFE_REST.yaw;
  function setKnife(active, gx, gy, dirX, dirY) {
    if (!active) {
      knife.position.set(KNIFE_REST.x, PAL_T + 0.005, KNIFE_REST.z);
      knife.rotation.set(0, KNIFE_REST.yaw, 0); knifeYaw = KNIFE_REST.yaw;
      return;
    }
    const [x, z] = toWorld(gx, gy);
    if (dirX * dirX + dirY * dirY > 1e-4) {
      // 손잡이가 움직이는 방향 뒤쪽에 오도록 (날이 앞장선다)
      const want = Math.atan2(dirY, -dirX);
      let d = want - knifeYaw; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
      knifeYaw += d * 0.25;
    }
    knife.position.set(x, PAL_T + 0.02, z);
    knife.rotation.set(0, knifeYaw, 0.12);
  }
  setKnife(false);

  function render() { renderer.render(scene, camera); }

  return {
    renderer, camera, resize, render, updatePaint, pick, pickTube, project, tubeScreen, paletteTopEdge,
    setLens, setHeldTube, setKnife, toWorld, toGrid, CELL,
    setExposure(v) { renderer.toneMappingExposure = v; },
  };
}
