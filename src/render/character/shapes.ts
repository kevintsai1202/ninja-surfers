import * as THREE from 'three';

/**
 * 角色建模用的幾何小工具：旋轉曲面衣身、錐形肢體、彎曲髮束、弧形金屬片、緞帶等。
 * 角色面向 −z；旋轉曲面（Lathe）的接縫刻意放在正面（被拉鍊蓋住）。
 */

/**
 * 旋轉曲面（衣身、領口）：profile 是 [半徑, 高度] 點列，繞 y 軸旋轉一圈。
 * 接縫放在正面（phi 從 π 開始），所以 u = 0.5 是背後正中央（畫紋章用）。
 * @param sx x 方向縮放（身體比較寬）
 * @param sz z 方向縮放（身體比較扁）
 */
export function latheBody(
  profile: [number, number][],
  sx = 1,
  sz = 1,
  segments = 32,
  phiStart = Math.PI,
  phiLength = Math.PI * 2,
): THREE.BufferGeometry {
  const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(pts, segments, phiStart, phiLength);
  g.scale(sx, 1, sz);
  g.computeVertexNormals();
  return g;
}

/**
 * 錐形肢體（上臂、前臂、大腿、小腿）：從原點往 −y 延伸 length，上粗下細。
 * @param rotateY 繞 y 軸旋轉（讓貼圖上的側邊條紋對到外側）
 */
export function taperedLimb(rTop: number, rBottom: number, length: number, rotateY = 0, radial = 18): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBottom, length, radial, 3, true);
  g.translate(0, -length / 2, 0);
  if (rotateY) g.rotateY(rotateY);
  return g;
}

/** 有厚度的圓環帶（袖口、褲口、護額布帶、繃帶）：高 h、內外半徑 r 與 r + t */
export function ringBand(r: number, h: number, t: number, segments = 28): THREE.BufferGeometry {
  const profile: [number, number][] = [
    [r, -h / 2],
    [r + t, -h / 2 + t * 0.4],
    [r + t, h / 2 - t * 0.4],
    [r, h / 2],
  ];
  return latheBody(profile, 1, 1, segments, 0, Math.PI * 2);
}

/**
 * 沿著一串點做成的細管（拉鍊、繩子、電線）。
 */
export function tubeAlong(points: THREE.Vector3[], radius: number, segments = 24): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.TubeGeometry(curve, segments, radius, 6, false);
}

/**
 * 髮束：五角錐體，尖端往局部 +z 彎（髮尾往後翹），略扁；頂點色做出髮根暗、髮尖亮。
 * 局部座標：底部在原點、沿 +y 長出去。
 * @param bend 尖端往 +z 彎曲的比例（相對長度）
 * @param flat z 方向的扁平比例（1 = 圓）
 */
export function hairLock(length: number, radius: number, bend: number, flat = 0.72): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(radius, length, 6, 5, false);
  g.translate(0, length / 2, 0);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = Math.max(0, Math.min(1, y / length));
    const z = pos.getZ(i) * flat + bend * length * t * t;
    pos.setXYZ(i, pos.getX(i), y, z);
    // 髮根 0.72 → 髮尖 1.12（超過 1 會讓顏色更亮）
    const c = 0.72 + 0.4 * t;
    colors[i * 3] = c;
    colors[i * 3 + 1] = c;
    colors[i * 3 + 2] = c;
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * 把髮束擺到頭上：底部放在 dir 方向、距頭心 baseR 的位置，局部 +y 朝 dir，
 * 局部 +z（髮尾彎曲方向）朝「往後」的方向（back 投影到垂直 dir 的平面）。
 */
export function placeLock(
  mesh: THREE.Object3D,
  dir: THREE.Vector3,
  baseR: number,
  back = new THREE.Vector3(0, -0.15, 1),
): void {
  const y = dir.clone().normalize();
  let z = back.clone().sub(y.clone().multiplyScalar(back.dot(y)));
  if (z.lengthSq() < 1e-4) z = new THREE.Vector3(0, 1, 0).sub(y.clone().multiplyScalar(y.y));
  z.normalize();
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  mesh.quaternion.setFromRotationMatrix(m);
  mesh.position.copy(y.multiplyScalar(baseR));
}

/** 幫幾何加上全白的頂點色（和頭髮共用 vertexColors 材質的幾何都要有 color 屬性，否則會變黑） */
export function withWhiteColors(g: THREE.BufferGeometry, shade = 1): THREE.BufferGeometry {
  const n = g.attributes.position.count;
  const colors = new Float32Array(n * 3).fill(shade);
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return g;
}

/**
 * 弧形金屬片（護額）：細分過的方塊，繞 y 軸彎成半徑 R 的弧面，正面朝 −z。
 * 正面的 uv 是 0..1（貼刻紋用）。
 */
export function curvedPlate(width: number, height: number, thickness: number, R: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(width, height, thickness, 24, 2, 1);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    // 方塊的 −z 面朝外（正面），所以半徑 = R − z
    const r = R - pos.getZ(i);
    const a = x / R;
    pos.setXYZ(i, Math.sin(a) * r, y, -Math.cos(a) * r);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * 依「頭部形狀」變形頭部的頂點（頭殼、臉部切片、髮蓋共用，五官才會貼合）：
 * 下巴往下、往前一點，臉頰略鼓，後腦略扁。p 為相對頭心的座標（會被修改）。
 */
export function shapeHead(p: THREE.Vector3): void {
  const len = p.length();
  if (len < 1e-6) return;
  const dy = p.y / len;
  const dz = p.z / len;
  const front = Math.max(0, -dz);
  // 下巴：往下一點點、往前一點點（Q 版臉不要太長）
  if (dy < 0) {
    const k = -dy;
    p.y *= 1 + 0.05 * k;
    p.z -= 0.012 * k * front;
  }
  // 臉頰：下半臉兩側鼓起（參考圖的圓臉）
  const cheek = Math.exp(-((dy + 0.35) ** 2) / 0.07);
  p.x *= 1.04 + 0.1 * cheek;
  // 後腦略扁
  if (dz > 0) p.z *= 1 - 0.05 * dz;
}

/** 對整個幾何套用頭部變形 */
export function shapeHeadGeometry(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    shapeHead(v);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * 可擺動的緞帶（護額綁帶、馬尾）：數節圓角薄片串起來，每節一個關節，往 +z（身後）延伸。
 * 回傳第一節的 Group；動畫會逐節旋轉做出波浪。
 */
export function ribbonChain(
  parent: THREE.Object3D,
  pos: [number, number, number],
  segments: number,
  segLength: number,
  width: number,
  thickness: number,
  material: THREE.Material,
  taper = 0.85,
): THREE.Group {
  const first = new THREE.Group();
  first.position.set(...pos);
  first.name = 'flap';
  parent.add(first);
  let cur: THREE.Group = first;
  let w = width;
  for (let i = 0; i < segments; i++) {
    const geo = new THREE.BoxGeometry(w, thickness, segLength * 1.06, 2, 1, 2);
    geo.translate(0, 0, segLength / 2);
    const seg = new THREE.Mesh(geo, material);
    seg.castShadow = true;
    seg.userData.noOutline = true;
    cur.add(seg);
    w *= taper;
    if (i < segments - 1) {
      const next = new THREE.Group();
      next.position.z = segLength;
      cur.add(next);
      cur = next;
    }
  }
  return first;
}
