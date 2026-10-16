'use strict';

/* Mô hình 3D của quân cờ theo biểu tượng người chơi: 🛵 🚗 🚢 ✈️ 🐉 🐱 🎩 🚀.
 * Dựng bằng three.js từ các khối cơ bản, phần thân sơn màu người chơi, chiếu sáng như trên bàn, rồi
 * chụp thành ảnh nhìn nghiêng theo 4 hướng đi (trái, lên, phải, xuống) để đặt lên bàn cờ. Điểm neo
 * (ax, ay) của ảnh là chỗ mô hình chạm mặt bàn. Không tải được three.js / WebGL thì giữ quân tốt CSS.
 * Quy ước khi dựng: đầu xe hướng +x, phía trên là +y, mặt đất y = 0.
 */

const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
const MODEL_PX = 240;
// góc xoay mô hình cho 4 hướng đi, lệch nhẹ về phía người nhìn để thấy cả mặt trước lẫn mặt bên
const MODEL_YAWS = [Math.PI + .45, Math.PI / 2 - .5, -.45, -Math.PI / 2 + .35];

const Models = {
  lib: null,      // Promise<THREE | null>
  studio: null,   // renderer, scene, camera dùng chung
  cache: {},

  load() {
    if (!Models.lib) {
      Models.lib = new Promise(resolve => {
        if (window.THREE) {
          resolve(window.THREE);
          return;
        }
        const s = document.createElement('script');
        const done = ok => {
          clearTimeout(timer);
          resolve(ok && window.THREE ? window.THREE : null);
        };
        const timer = setTimeout(() => done(false), 20000);
        s.src = THREE_URL;
        s.async = true;
        s.onload = () => done(true);
        s.onerror = () => done(false);
        document.head.append(s);
      });
    }
    return Models.lib;
  },

  /** Ảnh mô hình của token sơn màu color: { src: [trái, lên, phải, xuống], ax, ay }, hoặc null nếu không dựng được. */
  get(token, color) {
    const key = token + '|' + color;
    if (!Models.cache[key]) {
      Models.cache[key] = Models.load()
        .then(T => (T ? Models.shoot(T, token, color) : null))
        .catch(e => {
          console.warn('Không dựng được mô hình 3D:', e);
          return null;
        });
    }
    return Models.cache[key];
  },

  shoot(T, token, color) {
    const st = Models.studio || (Models.studio = makeStudio(T));
    const build = MODEL_BUILDERS[token] || MODEL_BUILDERS['🚗'];
    const model = normalizeModel(T, build(T, modelKit(T, color)));
    st.scene.add(model);
    const src = MODEL_YAWS.map(yaw => {
      model.rotation.y = yaw;
      st.renderer.render(st.scene, st.camera);
      return st.renderer.domElement.toDataURL('image/png');
    });
    st.scene.remove(model);
    model.traverse(o => {
      if (o.geometry) o.geometry.dispose();
    });
    return { src, ax: st.anchor.x, ay: st.anchor.y };
  },
};

/** Phòng chụp: đèn chính từ trên bên trái (khớp bóng đổ trên bàn), đèn phụ và đèn viền; máy ảnh nhìn chếch 35°. */
function makeStudio(T) {
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(MODEL_PX, MODEL_PX);
  renderer.setClearColor(0x000000, 0);
  renderer.outputEncoding = T.sRGBEncoding;
  const scene = new T.Scene();
  scene.add(new T.HemisphereLight(0xfff6e8, 0x5b4630, 0.62));
  const sun = new T.DirectionalLight(0xffffff, 1.05);
  sun.position.set(-2.5, 5, 3.5);
  scene.add(sun);
  const fill = new T.DirectionalLight(0xc9ddff, 0.3);
  fill.position.set(3, 1.5, 2.5);
  scene.add(fill);
  const rim = new T.DirectionalLight(0xffffff, 0.45);
  rim.position.set(0.5, 3, -4);
  scene.add(rim);
  const camera = new T.PerspectiveCamera(24, 1, 0.1, 50);
  const elev = 35 * Math.PI / 180, dist = 4.3, ty = 0.42;
  camera.position.set(0, ty + dist * Math.sin(elev), dist * Math.cos(elev));
  camera.lookAt(0, ty, 0);
  camera.updateMatrixWorld();
  const p = new T.Vector3(0, 0, 0).project(camera);
  return { renderer, scene, camera, anchor: { x: (p.x + 1) / 2, y: (1 - p.y) / 2 } };
}

/** Thu mô hình về cỡ chung (rộng ~1,05), đặt tâm đáy ở gốc toạ độ. */
function normalizeModel(T, obj) {
  const box = new T.Box3().setFromObject(obj);
  const size = box.getSize(new T.Vector3()), center = box.getCenter(new T.Vector3());
  const k = 1.05 / Math.max(size.x, size.z, size.y * 0.8);
  obj.scale.setScalar(k);
  obj.position.set(-center.x * k, -box.min.y * k, -center.z * k);
  const g = new T.Group();
  g.add(obj);
  return g;
}

/** Vật liệu và hàm dựng khối dùng chung; color là màu người chơi. */
function modelKit(T, color) {
  const lin = hex => new T.Color(hex).convertSRGBToLinear();
  const mat = (hex, shininess = 60, spec = 0x444444, extra = {}) =>
    new T.MeshPhongMaterial({ color: lin(hex), shininess, specular: new T.Color(spec), ...extra });
  const base = new T.Color(color);
  const shade = f => '#' + base.clone().multiplyScalar(f).getHexString();
  const tint = f => '#' + base.clone().lerp(new T.Color('#ffffff'), f).getHexString();
  const k = {
    T,
    paint: mat(color, 90, 0x555555),
    paintDark: mat(shade(0.6), 70, 0x555555),
    paintLight: mat(tint(0.35), 80, 0x666666),
    white: mat('#f3f2ee', 70, 0x555555),
    cream: mat('#efe3c4', 30, 0x222222),
    black: mat('#1b1b1e', 45, 0x2a2a2a),
    rubber: mat('#202022', 8, 0x111111),
    chrome: mat('#d7dbe1', 140, 0xffffff),
    steel: mat('#8d949c', 90, 0xaaaaaa),
    glass: mat('#2f5f8a', 160, 0xffffff, { transparent: true, opacity: 0.9 }),
    gold: mat('#f0b429', 120, 0xffe6a0),
    red: mat('#c62828', 70, 0x555555),
    lamp: mat('#fff3c4', 60, 0xffffff, { emissive: lin('#7a6a30') }),
    pink: mat('#f19bb5', 40, 0x333333),
    fur: mat('#e39a4f', 20, 0x222222),
    eye: mat('#9ccc65', 120, 0xffffff),

    mesh(geo, m, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) {
      const o = new T.Mesh(geo, m);
      o.position.set(...p);
      o.rotation.set(...r);
      o.scale.set(...s);
      return o;
    },
    group(...kids) {
      const g = new T.Group();
      kids.flat().forEach(o => g.add(o));
      return g;
    },
    sphere(r, m, p, s) { return k.mesh(new T.SphereGeometry(r, 20, 14), m, p, [0, 0, 0], s); },
    cyl(rt, rb, h, m, p, r) { return k.mesh(new T.CylinderGeometry(rt, rb, h, 24), m, p, r); },
    cone(rad, h, m, p, r) { return k.mesh(new T.ConeGeometry(rad, h, 16), m, p, r); },
    torus(rad, tube, m, p, r) { return k.mesh(new T.TorusGeometry(rad, tube, 10, 28), m, p, r); },
    lathe(pts, m, p, r) { return k.mesh(new T.LatheGeometry(pts.map(([x, y]) => new T.Vector2(x, y)), 32), m, p, r); },
    tube(pts, rad, m) {
      const curve = new T.CatmullRomCurve3(pts.map(v => new T.Vector3(...v)));
      return k.mesh(new T.TubeGeometry(curve, 40, rad, 8, false), m);
    },
    /** hộp bo tròn, tâm ở p */
    rbox(w, h, d, rad, m, p, rot) {
      const b = Math.min(rad, w / 4, h / 4, d / 4);
      const sw = w - 2 * b, sh = h - 2 * b, rr = Math.min(rad, sw / 2, sh / 2) * 0.6;
      const x = -sw / 2, y = -sh / 2, s = new T.Shape();
      s.moveTo(x + rr, y);
      s.lineTo(x + sw - rr, y);
      s.quadraticCurveTo(x + sw, y, x + sw, y + rr);
      s.lineTo(x + sw, y + sh - rr);
      s.quadraticCurveTo(x + sw, y + sh, x + sw - rr, y + sh);
      s.lineTo(x + rr, y + sh);
      s.quadraticCurveTo(x, y + sh, x, y + sh - rr);
      s.lineTo(x, y + rr);
      s.quadraticCurveTo(x, y, x + rr, y);
      const g = new T.ExtrudeGeometry(s, { depth: d - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 3, curveSegments: 5 });
      g.translate(0, 0, -(d - 2 * b) / 2);
      return k.mesh(g, m, p, rot);
    },
    /** khối có mặt cắt dọc (x, y) cho trước, dày depth theo trục z */
    prism(pts, depth, m, p, rot, bevel = 0.015) {
      const s = new T.Shape(pts.map(([x, y]) => new T.Vector2(x, y)));
      const b = Math.min(bevel, depth / 3);
      const g = new T.ExtrudeGeometry(s, { depth: depth - 2 * b, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 8 });
      g.translate(0, 0, -(depth - 2 * b) / 2);
      return k.mesh(g, m, p, rot);
    },
    /** khối có mặt bằng (x, z) cho trước, cao h tính từ độ cao y */
    slab(pts, h, m, y = 0, bevel = 0.015) {
      const s = new T.Shape(pts.map(([x, z]) => new T.Vector2(x, -z)));
      const b = Math.min(bevel, h / 3);
      const g = new T.ExtrudeGeometry(s, { depth: h - 2 * b, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 8 });
      g.rotateX(-Math.PI / 2);
      g.translate(0, y + b, 0);
      return k.mesh(g, m);
    },
    /** bánh xe trục theo z: lốp tròn + vành mạ */
    wheel(r, w, p) {
      return k.group(
        k.torus(r * 0.78, r * 0.24, k.rubber, [0, 0, 0]),
        k.cyl(r * 0.8, r * 0.8, w * 0.9, k.rubber, [0, 0, 0], [Math.PI / 2, 0, 0]),
        k.cyl(r * 0.5, r * 0.5, w * 1.02, k.chrome, [0, 0, 0], [Math.PI / 2, 0, 0]),
      ).translateX(p[0]).translateY(p[1]).translateZ(p[2]);
    },
  };
  return k;
}

const MODEL_BUILDERS = {
  /** xe tay ga kiểu Vespa */
  '🛵'(T, k) {
    return k.group(
      k.prism([[-0.48, 0.15], [-0.06, 0.15], [-0.04, 0.27], [-0.18, 0.39], [-0.38, 0.39], [-0.49, 0.29]], 0.32, k.paint, [0, 0, 0], [0, 0, 0], 0.1),
      k.rbox(0.42, 0.05, 0.22, 0.02, k.black, [0.13, 0.14, 0]),
      k.prism([[0.28, 0.12], [0.4, 0.12], [0.37, 0.58], [0.29, 0.55]], 0.3, k.paint, [0, 0, 0], [0, 0, 0], 0.03),
      k.prism([[0.34, 0.1], [0.53, 0.1], [0.52, 0.17], [0.38, 0.22]], 0.15, k.paint, [0, 0, 0], [0, 0, 0], 0.03),
      k.cyl(0.025, 0.025, 0.2, k.chrome, [0.36, 0.64, 0], [0, 0, -0.15]),
      k.cyl(0.022, 0.022, 0.44, k.chrome, [0.36, 0.74, 0], [Math.PI / 2, 0, 0]),
      k.cyl(0.03, 0.03, 0.08, k.black, [0.36, 0.74, 0.2], [Math.PI / 2, 0, 0]),
      k.cyl(0.03, 0.03, 0.08, k.black, [0.36, 0.74, -0.2], [Math.PI / 2, 0, 0]),
      k.cyl(0.055, 0.055, 0.05, k.lamp, [0.42, 0.74, 0], [0, 0, Math.PI / 2]),
      k.torus(0.056, 0.012, k.chrome, [0.445, 0.74, 0], [0, Math.PI / 2, 0]),
      k.rbox(0.34, 0.08, 0.22, 0.035, k.black, [-0.23, 0.46, 0]),
      k.wheel(0.1, 0.07, [-0.36, 0.1, 0]),
      k.wheel(0.1, 0.07, [0.44, 0.1, 0]),
      k.sphere(0.03, k.red, [-0.53, 0.33, 0]),
    );
  },

  /** ô tô con */
  '🚗'(T, k) {
    return k.group(
      k.rbox(1.0, 0.24, 0.5, 0.08, k.paint, [0, 0.21, 0]),
      k.prism([[-0.34, 0], [0.18, 0], [0.04, 0.2], [-0.26, 0.2]], 0.44, k.glass, [0, 0.33, 0], [0, 0, 0], 0.03),
      k.rbox(0.32, 0.04, 0.44, 0.02, k.paint, [-0.11, 0.545, 0]),
      k.rbox(0.07, 0.09, 0.5, 0.03, k.chrome, [0.5, 0.14, 0]),
      k.rbox(0.07, 0.09, 0.5, 0.03, k.chrome, [-0.5, 0.14, 0]),
      k.sphere(0.045, k.lamp, [0.49, 0.25, 0.16]),
      k.sphere(0.045, k.lamp, [0.49, 0.25, -0.16]),
      k.rbox(0.03, 0.05, 0.1, 0.01, k.red, [-0.505, 0.26, 0.17]),
      k.rbox(0.03, 0.05, 0.1, 0.01, k.red, [-0.505, 0.26, -0.17]),
      k.rbox(0.05, 0.05, 0.03, 0.01, k.paintDark, [0.12, 0.38, 0.26]),
      k.rbox(0.05, 0.05, 0.03, 0.01, k.paintDark, [0.12, 0.38, -0.26]),
      k.wheel(0.12, 0.1, [0.3, 0.12, 0.25]),
      k.wheel(0.12, 0.1, [0.3, 0.12, -0.25]),
      k.wheel(0.12, 0.1, [-0.3, 0.12, 0.25]),
      k.wheel(0.12, 0.1, [-0.3, 0.12, -0.25]),
    );
  },

  /** tàu thuỷ chở khách */
  '🚢'(T, k) {
    const hull = [[-0.52, -0.17], [0.22, -0.17], [0.58, 0], [0.22, 0.17], [-0.52, 0.17]];
    const deck = [[-0.5, -0.155], [0.2, -0.155], [0.53, 0], [0.2, 0.155], [-0.5, 0.155]];
    return k.group(
      k.slab(hull, 0.09, k.red, 0, 0.02),
      k.slab(hull, 0.14, k.paint, 0.09, 0.02),
      k.slab(deck, 0.02, k.cream, 0.23, 0.005),
      k.rbox(0.56, 0.12, 0.26, 0.03, k.white, [-0.1, 0.31, 0]),
      k.rbox(0.57, 0.03, 0.27, 0.01, k.glass, [-0.1, 0.32, 0]),
      k.rbox(0.36, 0.1, 0.22, 0.03, k.white, [-0.14, 0.42, 0]),
      k.rbox(0.37, 0.025, 0.23, 0.01, k.glass, [-0.14, 0.43, 0]),
      k.rbox(0.13, 0.08, 0.2, 0.025, k.white, [0.06, 0.51, 0]),
      k.rbox(0.135, 0.03, 0.205, 0.01, k.glass, [0.065, 0.52, 0]),
      k.cyl(0.055, 0.06, 0.2, k.paint, [-0.2, 0.57, 0], [0, 0, 0.12]),
      k.cyl(0.056, 0.056, 0.04, k.black, [-0.212, 0.67, 0], [0, 0, 0.12]),
      k.cyl(0.055, 0.06, 0.2, k.paint, [-0.34, 0.57, 0], [0, 0, 0.12]),
      k.cyl(0.056, 0.056, 0.04, k.black, [-0.352, 0.67, 0], [0, 0, 0.12]),
      k.cyl(0.008, 0.008, 0.2, k.steel, [0.4, 0.33, 0]),
    );
  },

  /** máy bay chở khách (lơ lửng trên bàn, xem hoạt ảnh trong CSS) */
  '✈️'(T, k) {
    const wing = [[0.14, 0], [-0.18, 0.56], [-0.27, 0.56], [-0.08, 0.05], [-0.08, -0.05], [-0.27, -0.56], [-0.18, -0.56]];
    const tail = [[-0.36, 0], [-0.5, 0.21], [-0.56, 0.21], [-0.47, 0.03], [-0.47, -0.03], [-0.56, -0.21], [-0.5, -0.21]];
    return k.group(
      k.lathe([[0, -0.52], [0.035, -0.5], [0.06, -0.42], [0.085, -0.28], [0.095, 0.1], [0.09, 0.3], [0.07, 0.42], [0.04, 0.49], [0, 0.52]], k.white, [0, 0.52, 0], [0, 0, -Math.PI / 2]),
      k.rbox(0.07, 0.03, 0.1, 0.012, k.glass, [0.45, 0.56, 0]),
      k.rbox(0.62, 0.025, 0.196, 0.01, k.glass, [0.02, 0.55, 0]),
      k.slab(wing, 0.025, k.white, 0.48, 0.008),
      k.slab(tail, 0.02, k.white, 0.54, 0.006),
      k.prism([[-0.3, 0], [-0.52, 0], [-0.57, 0.24], [-0.48, 0.24]], 0.03, k.paint, [0, 0.57, 0], [0, 0, 0], 0.008),
      k.cyl(0.045, 0.04, 0.18, k.paint, [-0.02, 0.44, 0.25], [0, 0, Math.PI / 2]),
      k.cyl(0.045, 0.04, 0.18, k.paint, [-0.02, 0.44, -0.25], [0, 0, Math.PI / 2]),
      k.cyl(0.033, 0.033, 0.01, k.black, [0.075, 0.44, 0.25], [0, 0, Math.PI / 2]),
      k.cyl(0.033, 0.033, 0.01, k.black, [0.075, 0.44, -0.25], [0, 0, Math.PI / 2]),
      k.rbox(0.07, 0.012, 0.03, 0.005, k.paint, [-0.24, 0.5, 0.55]),
      k.rbox(0.07, 0.012, 0.03, 0.005, k.paint, [-0.24, 0.5, -0.55]),
    );
  },

  /** rồng uốn lượn: thân là chuỗi vảy tròn nhỏ dần về đuôi, vây và sừng vàng */
  '🐉'(T, k) {
    const curve = new T.CatmullRomCurve3([
      [-0.46, 0.1, 0.08], [-0.34, 0.33, -0.04], [-0.17, 0.12, 0.05], [0, 0.35, -0.05], [0.16, 0.14, 0.04], [0.27, 0.36, 0], [0.34, 0.5, 0],
    ].map(v => new T.Vector3(...v)));
    const parts = [];
    const N = 64;
    for (let i = 0; i <= N; i++) {
      const t = i / N, c = curve.getPoint(t), r = 0.035 + 0.07 * t;
      parts.push(k.sphere(r, k.paint, [c.x, c.y, c.z]));
      parts.push(k.sphere(r * 0.8, k.gold, [c.x, c.y - r * 0.35, c.z], [1, 0.8, 0.8])); // bụng vàng
      if (i % 6 === 3 && i < N - 4) parts.push(k.cone(r * 0.5, r * 1.5, k.gold, [c.x, c.y + r * 1.05, c.z], [0, 0, 0.5]));
    }
    const legs = [[-0.17, 0.12], [0.16, 0.14]].flatMap(([x, y]) => [0.08, -0.08].flatMap(z => [
      k.cyl(0.022, 0.03, y, k.paintDark, [x, y / 2, z]),
      k.sphere(0.035, k.gold, [x + 0.02, 0.02, z], [1.4, 0.6, 1]),
    ]));
    const head = k.group(
      k.rbox(0.2, 0.15, 0.17, 0.06, k.paint, [0.44, 0.53, 0]),
      k.rbox(0.15, 0.09, 0.13, 0.04, k.paint, [0.57, 0.5, 0]),
      k.rbox(0.15, 0.04, 0.11, 0.02, k.paintDark, [0.55, 0.43, 0]),
      k.sphere(0.026, k.gold, [0.5, 0.59, 0.07]),
      k.sphere(0.026, k.gold, [0.5, 0.59, -0.07]),
      k.sphere(0.015, k.red, [0.645, 0.53, 0.035]),
      k.sphere(0.015, k.red, [0.645, 0.53, -0.035]),
      k.cone(0.024, 0.18, k.gold, [0.36, 0.66, 0.05], [0, 0, 1.1]),
      k.cone(0.024, 0.18, k.gold, [0.36, 0.66, -0.05], [0, 0, 1.1]),
      k.tube([[0.62, 0.48, 0.06], [0.58, 0.42, 0.16], [0.46, 0.4, 0.24]], 0.008, k.gold),
      k.tube([[0.62, 0.48, -0.06], [0.58, 0.42, -0.16], [0.46, 0.4, -0.24]], 0.008, k.gold),
      k.cone(0.03, 0.1, k.gold, [0.35, 0.58, 0], [0, 0, 1.4]),
    );
    head.scale.setScalar(1.15);
    head.position.set(-0.06, -0.08, 0);
    return k.group(parts, legs, head);
  },

  /** mèo ngồi, đeo vòng cổ màu người chơi */
  '🐱'(T, k) {
    return k.group(
      k.sphere(0.3, k.fur, [-0.05, 0.3, 0], [1, 1.12, 0.9]),
      k.sphere(0.2, k.white, [0.13, 0.27, 0], [0.55, 1.1, 0.8]),
      k.sphere(0.2, k.fur, [0.1, 0.7, 0]),
      k.torus(0.15, 0.025, k.paint, [0.07, 0.56, 0], [Math.PI / 2, 0, 0.25]),
      k.sphere(0.03, k.gold, [0.22, 0.52, 0]),
      k.sphere(0.09, k.white, [0.27, 0.64, 0], [0.8, 0.7, 1.2]),
      k.sphere(0.024, k.pink, [0.335, 0.675, 0]),
      k.sphere(0.036, k.eye, [0.265, 0.745, 0.08]),
      k.sphere(0.036, k.eye, [0.265, 0.745, -0.08]),
      k.sphere(0.018, k.black, [0.296, 0.748, 0.08], [0.6, 1.2, 1]),
      k.sphere(0.018, k.black, [0.296, 0.748, -0.08], [0.6, 1.2, 1]),
      k.cone(0.075, 0.15, k.fur, [0.06, 0.9, 0.11], [0.3, 0, -0.15]),
      k.cone(0.075, 0.15, k.fur, [0.06, 0.9, -0.11], [-0.3, 0, -0.15]),
      k.cone(0.04, 0.09, k.pink, [0.085, 0.885, 0.11], [0.3, 0, -0.15]),
      k.cone(0.04, 0.09, k.pink, [0.085, 0.885, -0.11], [-0.3, 0, -0.15]),
      k.sphere(0.065, k.white, [0.22, 0.05, 0.1], [1.4, 0.7, 1]),
      k.sphere(0.065, k.white, [0.22, 0.05, -0.1], [1.4, 0.7, 1]),
      k.tube([[-0.3, 0.06, 0.12], [-0.38, 0.08, 0.3], [-0.12, 0.06, 0.4], [0.14, 0.05, 0.32]], 0.04, k.fur),
    );
  },

  /** mũ chóp đen có dải màu người chơi */
  '🎩'(T, k) {
    return k.group(
      k.cyl(0.46, 0.46, 0.03, k.black, [0, 0.03, 0]),
      k.torus(0.45, 0.026, k.black, [0, 0.045, 0], [Math.PI / 2, 0, 0]),
      k.cyl(0.3, 0.27, 0.52, k.black, [0, 0.3, 0]),
      k.cyl(0.282, 0.274, 0.1, k.paint, [0, 0.11, 0]),
      k.rbox(0.03, 0.08, 0.1, 0.01, k.gold, [0.28, 0.11, 0]),
    );
  },

  /** tên lửa đứng trên ba cánh */
  '🚀'(T, k) {
    const fin = [[0.13, 0.14], [0.3, 0.0], [0.33, 0.0], [0.33, 0.07], [0.15, 0.42]];
    return k.group(
      k.lathe([[0, 0.12], [0.13, 0.12], [0.16, 0.2], [0.175, 0.4], [0.17, 0.6], [0.15, 0.74], [0.1, 0.9], [0.04, 1.0], [0, 1.03]], k.white),
      k.lathe([[0, 0.775], [0.143, 0.775], [0.102, 0.9], [0.042, 1.0], [0.002, 1.032]], k.paint),
      k.torus(0.172, 0.012, k.paint, [0, 0.42, 0], [Math.PI / 2, 0, 0]),
      [0, 1, 2].map(i => k.prism(fin, 0.035, k.paint, [0, 0, 0], [0, i * 2 * Math.PI / 3 + Math.PI / 2, 0], 0.01)),
      k.torus(0.062, 0.014, k.chrome, [0.165, 0.6, 0], [0, Math.PI / 2, 0]),
      k.cyl(0.056, 0.056, 0.02, k.glass, [0.163, 0.6, 0], [0, 0, Math.PI / 2]),
      k.cyl(0.09, 0.115, 0.1, k.steel, [0, 0.08, 0]),
    );
  },
};
