/* Три главы на одном холсте: карта смены живёт всё время, камера перелетает между главами по прокрутке.
   Карта и цифры условные: это иллюстрация, а не расчёт. Данные улиц: OpenStreetMap. */
(async function () {
  const NB = ' ';
  const canvas = document.getElementById('map'), ctx = canvas.getContext('2d');
  // Safari на iOS при прозрачности чуть меньше нуля (ошибка округления) оставляет прежнюю и рисует скрытое: приводим значение к 0…1 сами
  { const ga = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'globalAlpha');
    for (const c of [ctx]) Object.defineProperty(c, 'globalAlpha', { get() { return ga.get.call(this); }, set(v) { ga.set.call(this, v > 0 ? Math.min(1, v) : 0); } }); }
  const css = getComputedStyle(document.documentElement);
  const CYAN = css.getPropertyValue('--cyan-500').trim() || '#00ffff', WHITE = '#ffffff', BLACK = '#000000';
  const LATE = WHITE;                                  // в айдентике три цвета: опоздание показываем яркостью и заливкой, не новым цветом
  const LATE_MIN = 60, SOON_MIN = 40;
  const FONT = css.getPropertyValue('--font-family-base').trim() || 'sans-serif';
  // режим съёмки для макетов: ?shot=0|1|2 показывает только карту в позе нужной главы
  const SHOT = new URLSearchParams(location.search).get('shot');
  const reduced = SHOT !== null || matchMedia('(prefers-reduced-motion: reduce)').matches;
  const touch = matchMedia('(pointer: coarse)').matches;   // телефон и планшет
  // типограф: короткие предлоги, союзы и частицы приклеиваются к следующему слову, тире — к предыдущему, число — к единице. Так ни на одной ширине они не висят в конце строки
  const SHORT = /(^|[\s(«"„])(а|в|во|и|к|ко|о|об|от|с|со|у|на|за|из|по|до|не|но|ни|для|без|под|над|при|про|что|как|или|это|же)\s+/gi;
  function typo(root) {
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => n.parentElement && !n.parentElement.closest('script, style, textarea, .tune, .vars') && n.nodeValue.trim() ? 1 : 2 });
    const nodes = []; while (walk.nextNode()) nodes.push(walk.currentNode);
    for (const n of nodes) { let v = n.nodeValue; for (let i = 0; i < 2; i++) v = v.replace(SHORT, '$1$2\u00A0'); v = v.replace(/ (—|–)/g, '\u00A0$1').replace(/(\d) (?=[а-яё₽%]|из\b)/gi, '$1\u00A0'); if (v !== n.nodeValue) n.nodeValue = v; }
  }
  typo(document.body); window.__typo = typo;
  const VQ = '?v=' + (window.__v || '');
  const idlePause = () => new Promise((resolve) => { if (window.requestIdleCallback) window.requestIdleCallback(resolve, { timeout: 80 }); else setTimeout(resolve, 16); });
  const painText = document.querySelector('.pain .text'), casesText = document.querySelector('.cases .stick > div');               // версия дописывается ко всем файлам, чтобы не цеплялся кэш
  const D = await fetch('data/ekb-map.json' + VQ).then((r) => r.json());
  const N = D.nodes.length / 2, nx = (i) => D.nodes[i * 2], ny = (i) => D.nodes[i * 2 + 1];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const ease = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
  const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const mix = (a, b, t) => a + (b - a) * t;
  const inOut = (t) => { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };

  // ---------- граф улиц и расстояния от кухни ----------
  const adj = Array.from({ length: N }, () => []);
  for (let i = 0; i < D.edges.length; i += 2) {
    const a = D.edges[i], b = D.edges[i + 1], d = Math.hypot(nx(a) - nx(b), ny(a) - ny(b));
    adj[a].push([b, d]); adj[b].push([a, d]);
  }
  let kitchen = 0, best = Infinity;
  for (let i = 0; i < N; i++) { const d = Math.hypot(nx(i) - D.kitchen[0], ny(i) - D.kitchen[1]); if (d < best && adj[i].length > 2) { best = d; kitchen = i; } }
  const dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
  (function dijkstra() {
    const heap = [[0, kitchen]]; dist[kitchen] = 0;
    const push = (x) => { heap.push(x); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    while (heap.length) { const [d, u] = pop(); if (d > dist[u]) continue; for (const [v, wgt] of adj[u]) { const nd = d + wgt; if (nd < dist[v]) { dist[v] = nd; prev[v] = u; push([nd, v]); } } }
  })();
  const KX = nx(kitchen), KY = ny(kitchen), REACH = 470;
  const pool = []; for (let i = 0; i < N; i++) if (dist[i] > 90 && dist[i] < REACH) pool.push(i);
  const pathTo = (n) => { const p = []; for (let c = n; c !== -1; c = prev[c]) p.push(c); return p.reverse(); };

  // путь одного заказа для третьей главы: дальний узел к северо-востоку от кухни
  let demoNode = pool[0], demoScore = -Infinity;
  for (const n of pool) { const s = dist[n] - Math.abs(Math.atan2(ny(n) - KY, nx(n) - KX) + 0.6) * 160; if (dist[n] > 330 && dist[n] < 440 && s > demoScore) { demoScore = s; demoNode = n; } }
  const demoPath = pathTo(demoNode), demoLen = dist[demoNode];
  // точки сети для последнего шага «Деньги»: ближайшие перекрёстки вокруг кухни, у каждой свой столбик выручки
  // «Внедрение»: точки сети вокруг головной кухни, переходят на систему одна за другой — ближние раньше
  const net = Array.from({ length: 14 }, (_, i) => { const a = i * 2.39996 + 0.6, r = 130 + (i / 13) * 300, tx = KX + Math.cos(a) * r, ty = KY + Math.sin(a) * r * 0.9; let best = 0, bd = 1e9; for (let q = 0; q < N; q++) { const d = Math.hypot(nx(q) - tx, ny(q) - ty); if (d < bd) { bd = d; best = q; } } return { x: nx(best), y: ny(best) }; });
  const dayBar = document.getElementById('dayBar'), dayN = document.getElementById('dayN'); for (let i = 0; i < 21; i++) dayBar.appendChild(document.createElement('i'));
  const DAYS = 6.5, MOVE_LOOP = 9.5; let moveT = 0, dayShown = -1;
  const outlets = [[-430, -190, 0.62], [360, -250, 0.9], [470, 230, 0.48], [-300, 290, 0.74]].map(([dx, dy, v]) => { let best = 0, bd = 1e9; for (let i = 0; i < N; i++) { const d = Math.hypot(nx(i) - (KX + dx), ny(i) - (KY + dy)); if (d < bd) { bd = d; best = i; } } return { x: nx(best), y: ny(best), v }; });
  const demoCum = [0]; for (let i = 1; i < demoPath.length; i++) demoCum.push(demoCum[i - 1] + Math.hypot(nx(demoPath[i]) - nx(demoPath[i - 1]), ny(demoPath[i]) - ny(demoPath[i - 1])));
  function demoPoint(t) {
    const target = t * demoLen; let i = 1; while (i < demoCum.length - 1 && demoCum[i] < target) i++;
    const seg = demoCum[i] - demoCum[i - 1] || 1, k = clamp((target - demoCum[i - 1]) / seg, 0, 1);
    return [mix(nx(demoPath[i - 1]), nx(demoPath[i]), k), mix(ny(demoPath[i - 1]), ny(demoPath[i]), k), i];
  }

  // ---------- слои карты в координатах карты: рисуются один раз, камера их только двигает ----------
  const MS = 1.7;
  function lines(c, list, close) { c.beginPath(); for (const l of list) { c.moveTo(l[0], l[1]); for (let i = 2; i < l.length; i += 2) c.lineTo(l[i], l[i + 1]); if (close) c.closePath(); } }
  function layer(bright) {
    const cv = document.createElement('canvas'); cv.width = Math.round(D.w * MS); cv.height = Math.round(D.h * MS);
    const c = cv.getContext('2d'); c.scale(MS, MS); c.lineJoin = 'round'; c.lineCap = 'round';
    if (!bright) {
      c.fillStyle = WHITE; c.globalAlpha = 0.03; lines(c, D.parks, true); c.fill();
      c.globalAlpha = 0.075; lines(c, D.water, true); c.fill('evenodd');
      c.strokeStyle = WHITE; c.globalAlpha = 0.22; c.lineWidth = 0.6; lines(c, D.water, true); c.stroke();
      c.globalAlpha = 0.1; c.setLineDash([5, 4]); lines(c, D.rail); c.stroke(); c.setLineDash([]);
      c.globalAlpha = 0.1; c.lineWidth = 0.6; lines(c, D.roads[2]); c.stroke();
      c.globalAlpha = 0.2; c.lineWidth = 0.95; lines(c, D.roads[1]); c.stroke();
      c.globalAlpha = 0.42; c.lineWidth = 1.5; lines(c, D.roads[0]); c.stroke();
    } else {
      c.strokeStyle = CYAN; c.shadowColor = CYAN; c.shadowBlur = 8;
      c.globalAlpha = 0.45; c.lineWidth = 0.7; lines(c, D.roads[2]); c.stroke();
      c.globalAlpha = 0.7; c.lineWidth = 1.05; lines(c, D.roads[1]); c.stroke();
      c.globalAlpha = 0.95; c.lineWidth = 1.7; lines(c, D.roads[0]); c.stroke();
      c.globalAlpha = 0.5; c.lineWidth = 0.9; lines(c, D.water, true); c.stroke();
    }
    return cv;
  }
  const baseLayer = layer(false), glowLayer = layer(true);

  // ---------- камера: три позы, между ними плавный перелёт ----------
  let w = 0, h = 0, ratio = 1, wide = true, temp = null, tctx = null, spot = null, sctx = null;
  const SPOT = 200;
  // Плотный портрет в Safari: маленькие пути вместо одного пересекающегося контура на 160 тысяч зёрен.
  const grainLayer = document.createElement('canvas'), grainCtx = grainLayer.getContext('2d'), grainBuckets = [[], [], [], []];
  const cam = { zoom: 1, ox: 0, oy: 0, rot: 0, tilt: 1 };
  // параметры портрета из зерен
  const GP = { pic: 0.6, n: 18000, gamma: 1.3, dot: 0.55, jitter: 7, floor: 0.8, shimmer: 0.46, band: 1, speed: 0.49, reach: 0.24, push: 3.5, dust: 1600, far: 2.1 };   // воздушный портрет: значения выставил Даниил 18.10 пультом ?grain
  if (matchMedia('(max-width: 899px)').matches) Object.assign(GP, { pic: 0.45, n: 10000, dot: 0.3, gamma: 0.9, floor: 0.2, jitter: 7, shimmer: 0.32, band: 1, speed: 0.5, reach: 0.24, push: 2, dust: 600, far: 1.6 });   // мобильный портрет: значения выставил Даниил 18.10 пультом ?grain
  // Телефон: зерно запекается в чёткий слой заранее. В кадре двигаются полосы сборки и свет, а не 18 тысяч точек.
  async function bakePortrait(f) {
    if (f.baking || !f.grain) return;
    f.baking = true;
    const P = f.grain, side = Math.ceil(w * 1.17 * ratio), dot = Math.max(0.5 * ratio, side / 700 * GP.dot);
    const cv = document.createElement('canvas'); cv.width = cv.height = side;
    const c = cv.getContext('2d'); c.fillStyle = CYAN;
    for (let start = 0; start < P.length; start += 8192 * 8) {
      c.beginPath(); const end = Math.min(start + 8192 * 8, P.length);
      for (let i = start; i < end; i += 8) {
        const sz = dot * P[i + 6]; c.rect(P[i] * side, P[i + 1] * side, sz, sz);
      }
      c.fill(); await idlePause();
      if (f.grain !== P) { f.baking = false; return; }
    }
    f.grainSprite = cv; f.baking = false;
  }
  function mobilePortrait(f, bx, by, size) {
    const sprite = f.grainSprite;
    if (GP.pic > 0 && f.gimg.complete && f.gimg.naturalWidth) {
      ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = GP.pic * smooth((morphK - 0.45) / 0.55);
      ctx.drawImage(f.gimg, bx, by, size, size); ctx.globalCompositeOperation = 'source-over';
    }
    if (sprite.width !== Math.ceil(w * 1.17 * ratio)) bakePortrait(f);
    const light = reduced ? 0.88 : 0.84 + 0.06 * Math.sin(clock * 1.3);
    if (morphK > 0.998) { ctx.globalAlpha = light; ctx.drawImage(sprite, bx, by, size, size); }
    else for (let col = 0; col < 24; col++) {
      const hx = (col + 0.5) / 24, e = inOut(clamp((morphK - hx * 0.45) / 0.55, 0, 1));
      if (e <= 0) continue;
      const sx = Math.floor(col * sprite.width / 24), ex = Math.floor((col + 1) * sprite.width / 24);
      const dx = Math.sin(col * 2.4) * (1 - e) * size * 0.12, dy = Math.cos(col * 1.7) * (1 - e) * size * 0.12;
      ctx.globalAlpha = light * e;
      ctx.drawImage(sprite, sx, 0, ex - sx, sprite.height, bx + sx / sprite.width * size + dx, by + dy, (ex - sx) / sprite.width * size, size);
    }
    // Редкая россыпь остаётся живой; слабая подложка помогает читать силуэт.
    const U = f.dust, dk = smooth((morphK - 0.35) / 0.65), dot = Math.max(0.5, size / 700 * GP.dot);
    if (U) { ctx.fillStyle = CYAN; for (let i = 0; i < U.length; i += 5) {
      const ph = U[i + 3], a = U[i + 2] * (0.5 + 0.5 * Math.sin(clock * 0.8 + ph * 2)) * dk;
      if (a <= 0.06) continue;
      const x = U[i] + Math.sin(clock * 0.11 + ph) * 0.02, y = U[i + 1] + Math.cos(clock * 0.09 + ph * 1.3) * 0.02 - ((clock * 0.004 + ph) % 0.06), d = dot * 1.6 * U[i + 4];
      ctx.globalAlpha = a; ctx.fillRect(bx + x * size, by + y * size, d, d);
    } }
    ctx.globalAlpha = 1;
  }
  const C = 2;                                         // номер главы с пультом: 0 начало, 1 вечер, 2 пульт, 3 система
  let poses = [], foldK = 0, folded = false;
  const dimC = document.createElement('canvas'), dctx = dimC.getContext('2d');   // служебный холст для мягкой маски портрета
  // вариант 5: улицы распадаются на живые линии, которые текут по полю сцены и собирают её из движения (поле снимается с картинки: research/scenes/field.py)
  const FLOW_N = 2000, TRAIL = 9, scene = { ready: false, parts: [] }, fields = [null, null, null, null]; let morphK = 0, F = null, Fold = null, swapK = 1;
  // свободные линии за рамкой картинки выключены (amb: false): с ними фон сцены сливался
  const spawnAt = (q, f) => q.amb ? [-0.35 + Math.random() * 1.7, -0.3 + Math.random() * 1.6] : (q.inZone && f.zone ? f.zone.pick() : f.more());
  // картинки лежат в поле 1000×1000 в одном масштабе: исходный квадрат занимает 840 px, расширенные версии уходят в поля (research/scenes/place.py); прямоугольники ниже уже в координатах этого поля
  // у каждого момента своё поле; hot — прямоугольники главного объекта, он светится голубым; bright — второй герой, он просто ярче
  // сцены «Часа пик» и портрет нужны не на первом экране: грузим их, когда первый кадр уже нарисован
  const sceneSources = [['data/field-1900.json', [[0.097, 0.622, 0.403, 0.639]], [[0.634, 1, 0.198, 0.478], [0.755, 1, 0.478, 0.59], [0.634, 1, 0.59, 1]]], ['data/field-1920.json', [[0, 0.74, 0.122, 0.66]]], ['data/field-2010.json', [[0.433, 0.71, 0.08, 0.399], [0.307, 0.811, 0.382, 0.735], [0.307, 0.752, 0.735, 0.92]]],
   ['data/field-case.json', [[0.3, 0.8, 0.5, 0.74]], [], 'assets/case-portrait.jpg', [[0.4, 0.66, 0.09, 0.47]], 'assets/case-outline.jpg', 'assets/case-dots.jpg']];
  const fieldLoads = [];
  function loadField(idx) {
    if (fieldLoads[idx]) return fieldLoads[idx];
    const [url, hot, bright, pic, quiet, rim, grain] = sceneSources[idx];
    return fieldLoads[idx] = fetch(url + VQ).then((r) => r.json()).then(async (j) => {
    const f = { g: j.g, mask: Uint8Array.from(j.mask), ang: Uint8Array.from(j.angle), hot, bright: bright || [], quiet: quiet || [] }, cdf = new Float32Array(j.mask.length); let acc = 0;
    const fieldWeights = Float64Array.from({ length: 256 }, (_, v) => Math.pow(v / 255, 1.6));
    // спина менеджера — одна тонкая линия контура: без отдельного веса (×5) линии на неё почти не попадают
    const BOOST = 2.4, boost = idx === 0 && bright && bright.length;   // кухня: на менеджера ложится больше линий — спина и бок прорисованы, а не только контур
    for (let start = 0; start < cdf.length; start += 8192) {
      const end = Math.min(start + 8192, cdf.length);
      for (let i = start; i < end; i++) { let wv = fieldWeights[j.mask[i]]; if (boost) { const x = (i % j.g) / j.g, y = Math.floor(i / j.g) / j.g; for (const r of bright) if (x > r[0] && x < r[1] && y > r[2] && y < r[3]) { wv *= BOOST; break; } if (x > 0.84 && x < 0.99 && y > 0.18 && y < 0.95) wv *= 5; } acc += wv; cdf[i] = acc; }
      if (touch && end < cdf.length) await idlePause();
    }
    f.pick = () => { const r = Math.random() * acc; let lo = 0, hi = cdf.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cdf[m] < r) lo = m + 1; else hi = m; } return [((lo % j.g) + Math.random()) / j.g, (Math.floor(lo / j.g) + Math.random()) / j.g]; };
    if (j.zone && !pic) {                                        // маленькая фигура со своим силуэтом: часть линий живёт только внутри него
      const z = j.zone, zc = new Float32Array(z.mask.length); let za = 0; for (let i = 0; i < zc.length; i++) { za += Math.pow(z.mask[i] / 255, 1.4); zc[i] = za; }
      f.zone = { k: Math.min(1, (z.rect[1] - z.rect[0]) / 0.45), r: z.rect, w: z.w, h: z.h, mask: Uint8Array.from(z.mask), ang: Uint8Array.from(z.angle), pick: () => { const r = Math.random() * za; let lo = 0, hi = zc.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (zc[m] < r) lo = m + 1; else hi = m; } return [z.rect[0] + ((lo % z.w) + Math.random()) / z.w * (z.rect[1] - z.rect[0]), z.rect[2] + (Math.floor(lo / z.w) + Math.random()) / z.h * (z.rect[3] - z.rect[2])]; } };
    }
    f.more = () => { if (f.bright.length && Math.random() < 0.23) for (let k = 0; k < 12; k++) { const p = f.pick(); if (f.bright.some((r) => p[0] > r[0] && p[0] < r[1] && p[1] > r[2] && p[1] < r[3])) return p; } return f.pick(); };   // второму герою достаётся больше линий
    if (grain) {                                         // гранулярный портрет: десятки тысяч зёрен, расставленных по самой картинке, каждое со своим размером
      const im = f.gimg = new Image(); im.onload = () => {
        const c = document.createElement('canvas'), n = touch ? 800 : 1600; c.width = c.height = n; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0, n, n);
        const d = x.getImageData(0, 0, n, n).data, cdf = new Float32Array(n * n);
        let grainJob = 0;
        f.regrain = async () => {                              // расставить зёрна заново — после смены их числа или контраста
          const job = ++grainJob, weights = Float64Array.from({ length: 256 }, (_, v) => Math.pow(v / 255, GP.gamma));
          let acc = 0;
          for (let start = 0; start < n * n; start += 65536) {
            const end = Math.min(start + 65536, n * n);
            for (let i = start; i < end; i++) { acc += weights[d[i * 4 + 1]]; cdf[i] = acc; }
            if (touch) { await idlePause(); if (job !== grainJob) return; }
          }
          const N = Math.round(GP.n), P = new Float32Array(N * 8);
          for (let k = 0; k < N; k++) {
            if (touch && k && k % 4096 === 0) { await idlePause(); if (job !== grainJob) return; }
            const r = Math.random() * acc; let lo = 0, hi = cdf.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cdf[m] < r) lo = m + 1; else hi = m; }
            const q = Math.random();
            P[k * 8] = ((lo % n) + Math.random()) / n; P[k * 8 + 1] = (Math.floor(lo / n) + Math.random()) / n; P[k * 8 + 2] = d[lo * 4 + 1] / 255; P[k * 8 + 3] = Math.random() * 6.283; P[k * 8 + 4] = (Math.random() - 0.5) * 2; P[k * 8 + 5] = (Math.random() - 0.5) * 2;
            P[k * 8 + 6] = q < 0.8 ? 0.7 + Math.random() * 0.5 : q < 0.97 ? 1.2 + Math.random() * 0.6 : 1.8 + Math.random() * 1; }   // зерно разного калибра, как на исходнике
          f.grain = P; f.grainSprite = null; f.go = new Float32Array(N * 4);
          const M = Math.round(GP.dust), U = new Float32Array(M * 5);   // россыпь: зёрна уходят за пределы портрета и редеют с расстоянием
          for (let k = 0; k < M; k++) { const fr = Math.pow(Math.random(), 1.9), rr = 0.36 + fr * GP.far, th = Math.random() * 6.283, q = Math.random();
            U[k * 5] = 0.5 + Math.cos(th) * rr * 1.08; U[k * 5 + 1] = 0.5 + Math.sin(th) * rr * 0.92; U[k * 5 + 2] = Math.pow(1 - fr, 1.4); U[k * 5 + 3] = Math.random() * 6.283; U[k * 5 + 4] = q < 0.75 ? 0.8 + Math.random() * 0.7 : q < 0.96 ? 1.5 + Math.random() * 1 : 2.6 + Math.random() * 1.6; }
          f.dust = U;
          if (touch) await bakePortrait(f);
        };
        (window.requestIdleCallback || ((cb) => setTimeout(cb, 1200)))(() => f.regrain(), { timeout: 5000 });   // зерно готовится в паузу; на телефоне работа разбита на короткие порции
      }; im.src = grain.replace('.jpg', '-cyan.jpg') + VQ;
    }
    if (rim && !(touch && grain)) { f.rim = new Image(); f.rim.src = rim + VQ; }   // тонкий голубой контур фигуры
    if (pic && !(touch && grain)) { f.img = new Image(); f.img.src = pic + VQ; }   // quiet — лицо: там линии почти гаснут, чтобы не искажать черты   // у портрета под линиями лежит сам рисунок: лицо должно остаться узнаваемым
    fields[idx] = f; if (!F && idx < 3) F = f;
    if (!scene.ready) {
      const near = []; for (let i = 0; i < D.edges.length; i += 2) { const a = D.edges[i], b = D.edges[i + 1], d = Math.hypot((nx(a) + nx(b)) / 2 - KX, (ny(a) + ny(b)) / 2 - KY); if (d < 640) near.push([nx(a), ny(a), nx(b), ny(b)]); }
      for (let i = 0; i < FLOW_N; i++) { const [x, y] = f.pick(), t = new Float32Array(TRAIL * 2); t[0] = x; t[1] = y; scene.parts.push({ x, y, t, n: 1, dx: Math.random() - 0.5, dy: Math.random() - 0.5, sp: 0.03 + Math.random() * 0.05, life: Math.random() * 4, age: 0, src: near[(i * 37) % near.length], band: i % 10, inZone: i % 6 === 0, amb: false }); }
      scene.ready = true;
    }
  }).catch(() => {});
  }
  const loadScenes = () => { loadField(0); if (!touch) { loadField(1); loadField(2); loadField(3); } };
  // Загрузка сцен начинается после первого отрисованного кадра; fallback действительно ждёт кадр и на Safari без requestIdleCallback.
  requestAnimationFrame(() => { if (window.requestIdleCallback) window.requestIdleCallback(loadScenes, { timeout: 600 }); else setTimeout(loadScenes, 16); });
  function setPoses() {
    // Общий план мобильного пульта: зона доставки целиком помещается по ширине, даже при максимальной оплате.
    poses = wide
      ? [{ zoom: 1.12, ox: w * 0.68, oy: h * 0.5, rot: -0.2, tilt: 0.86 }, { zoom: 2.7, ox: w * 0.72, oy: h * 0.64, rot: -0.85, tilt: 0.3 }, { zoom: 1.5, ox: w * 0.66, oy: h * 0.44, rot: -0.02, tilt: 0.8 }, { zoom: 0.84, ox: w * 0.42, oy: h * 0.56, rot: 0.2, tilt: 0.6 }, { zoom: 0.7, ox: w * 0.72, oy: h * 0.5, rot: 0.38, tilt: 0.7 }, { zoom: 0.82, ox: w * 0.77, oy: h * 0.52, rot: 0.55, tilt: 0.72 }, { zoom: 0.9, ox: w * 0.5, oy: h * 0.5, rot: 0.72, tilt: 0.75 }]
      : [{ zoom: 0.9, ox: w * 0.5, oy: h * 0.72, rot: -0.2, tilt: 0.86 }, { zoom: 2.0, ox: w * 0.5, oy: h * 0.8, rot: -0.85, tilt: 0.32 }, { zoom: Math.min(0.55, w / 760), ox: w * 0.5, oy: h * 0.72, rot: -0.05, tilt: 0.8 }, { zoom: 0.62, ox: w * 0.42, oy: h * 0.66, rot: 0.2, tilt: 0.6 }, { zoom: 0.55, ox: w * 0.5, oy: h * 0.6, rot: 0.38, tilt: 0.7 }, { zoom: 0.5, ox: w * 0.5, oy: h * 0.76, rot: 0.55, tilt: 0.72 }, { zoom: 0.7, ox: w * 0.5, oy: h * 0.5, rot: 0.72, tilt: 0.75 }];
    if (!wide) poses.forEach((pose, i) => { pose.oy += i === C ? 8 : 20; });
  }
  let px = 0, py = 0, mx = -9999, my = -9999, tmx = 0, tmy = 0, hasMouse = false;
  const toScreen = (x, y) => { const dx = (x - KX) * cam.zoom, dy = (y - KY) * cam.zoom, c = Math.cos(cam.rot), s = Math.sin(cam.rot); return [cam.ox + px + dx * c - dy * s, cam.oy + py + (dx * s + dy * c) * cam.tilt]; };
  function applyCamera(c) { c.translate(cam.ox + px, cam.oy + py); c.scale(1, cam.tilt); c.rotate(cam.rot); c.scale(cam.zoom, cam.zoom); c.translate(-KX, -KY); }
  function drawLayer(c, src) { c.save(); applyCamera(c); c.imageSmoothingQuality = 'high'; c.drawImage(src, 0, 0, D.w, D.h); c.restore(); }
  function masked(src, cxm, cym, radius, soft, alpha) {
    tctx.setTransform(ratio, 0, 0, ratio, 0, 0); tctx.globalCompositeOperation = 'source-over'; tctx.clearRect(0, 0, w, h); tctx.globalAlpha = 1; drawLayer(tctx, src);
    tctx.globalCompositeOperation = 'destination-in';
    const g = tctx.createRadialGradient(cxm, cym, Math.max(0, radius * (1 - soft)), cxm, cym, radius); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    tctx.fillStyle = g; tctx.fillRect(0, 0, w, h);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = alpha; ctx.drawImage(temp, 0, 0);
  }
  function spotlight(src, cxm, cym, alpha) {
    sctx.setTransform(ratio, 0, 0, ratio, 0, 0); sctx.globalCompositeOperation = 'source-over'; sctx.clearRect(0, 0, SPOT * 2, SPOT * 2); sctx.globalAlpha = 1;
    sctx.save(); sctx.translate(SPOT - cxm, SPOT - cym); drawLayer(sctx, src); sctx.restore();
    sctx.globalCompositeOperation = 'destination-in';
    const g = sctx.createRadialGradient(SPOT, SPOT, SPOT * 0.15, SPOT, SPOT, SPOT); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    sctx.fillStyle = g; sctx.fillRect(0, 0, SPOT * 2, SPOT * 2);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = alpha; ctx.drawImage(spot, Math.round((cxm - SPOT) * ratio), Math.round((cym - SPOT) * ratio));
  }
  function resize() {
    const nextRatio = Math.min(devicePixelRatio || 1, 1.5), nextW = canvas.clientWidth, nextH = canvas.clientHeight, nextWide = matchMedia('(min-width: 900px)').matches;
    if (nextRatio === ratio && nextW === w && nextH === h && nextWide === wide) return false;
    ratio = nextRatio; w = nextW; h = nextH; wide = nextWide;   // тот же порог, что в стилях: ширина окна вместе с полосой прокрутки
    canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio);
    if (!temp) { temp = document.createElement('canvas'); tctx = temp.getContext('2d'); }
    temp.width = canvas.width; temp.height = canvas.height;
    if (!spot) { spot = document.createElement('canvas'); sctx = spot.getContext('2d'); }
    const spotSize = Math.round(SPOT * 2 * ratio); if (spot.width !== spotSize || spot.height !== spotSize) spot.width = spot.height = spotSize;
    setPoses(); return true;
  }

  // ---------- главы и прокрутка ----------
  const chapters = Array.from(document.querySelectorAll('.chapter')), sticks = chapters.map((c) => c.querySelector('.stick'));
  const navLinks = Array.from(document.querySelectorAll('.chapters a')), menuLinks = Array.from(document.querySelectorAll('.menu__list a')), progressBar = document.getElementById('progressBar');
  const topCta = document.getElementById('topCta');
  const veilSide = document.getElementById('veilSide'), veilFrame = document.getElementById('veilFrame'), veilBlur = document.getElementById('veilBlur'), veilDim = document.getElementById('veilDim'), veilBottom = document.getElementById('veilBottom');
  // Геометрия не меняется при прокрутке: не заставляем Safari пересчитывать layout после каждого кадра.
  let chapterTops = [], chapterHeights = [], sceneLayout = new Map(), chapterPaint = [];
  function measureChapters() {
    chapterTops = chapters.map((c) => c.offsetTop); chapterHeights = chapters.map((c) => c.offsetHeight);
    sceneLayout = new Map([painText, casesText].filter(Boolean).map((el) => {
      const stick = el.closest('.stick'), idx = sticks.indexOf(stick);
      return [el, { idx, bottom: el.offsetTop + el.offsetHeight, height: stick.offsetHeight }];
    }));
    // Размещаем сеть между текстом и нижним краем один раз при изменении вёрстки.
    // В кадре используем готовую позу: дополнительных измерений DOM нет.
    if (!wide) {
      const text = chapters[5].querySelector('.stick > div'), pose = poses[5];
      const top = text.offsetTop + text.offsetHeight + 32, bottom = Math.min(h, sticks[5].offsetHeight) - 28;
      const c = Math.cos(pose.rot), s = Math.sin(pose.rot);
      const points = [{ x: KX, y: KY }, ...net].map(({ x, y }) => {
        const dx = x - KX, dy = y - KY;
        return [(dx * c - dy * s), (dx * s + dy * c) * pose.tilt];
      });
      const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
      const left = Math.min(...xs), right = Math.max(...xs), upper = Math.min(...ys), lower = Math.max(...ys);
      const room = Math.max(100, bottom - top);
      pose.zoom = Math.min(0.5, (w - 56) / (right - left), Math.max(52, room - 48) / (lower - upper));
      pose.ox = w / 2 - (left + right) * pose.zoom / 2;
      pose.oy = top + room / 2 - (upper + lower) * pose.zoom / 2;
    }
  }
  function sceneBottom(el, pageY) {
    const box = sceneLayout.get(el); if (!box) return h * 0.5;
    const { idx, bottom, height } = box, paint = chapterPaint[idx] || { opacity: 1, offset: 0 };
    const top = document.body.classList.contains('pin') ? 0 : Math.max(chapterTops[idx] - pageY, Math.min(0, chapterTops[idx] + chapterHeights[idx] - pageY - height));
    const scale = reduced ? 1 : 0.96 + paint.opacity * 0.04, offset = reduced ? 0 : paint.offset * 70;
    return top + height / 2 + (bottom - height / 2) * scale + offset;
  }
  // Значения записываются в DOM только при изменении: скрытые главы не создают работу Safari.
  const styleValues = new WeakMap();
  function paintStyle(el, key, value) {
    let cache = styleValues.get(el); if (!cache) styleValues.set(el, cache = {});
    if (cache[key] === value) return; cache[key] = value; el.style[key] = value;
  }
  let navActive = -1;
  let vel = 0;
  let scrollTarget = 0, scrollPos = 0;                 // положение в главах: 0…3, дробная часть — перелёт
  let readScroll = function () {
    if (swipeSettling || (gliding && glideIdx >= 0)) return;               // во время перелёта по ссылке положение ведёт сам перелёт
    const y = window.scrollY + h * 0.5; let acc = 0;
    for (let i = 0; i < chapters.length; i++) {
      const top = chapterTops[i], hgt = chapterHeights[i];
      if (y < top + hgt || i === chapters.length - 1) { const local = clamp((y - top) / hgt, 0, 1); acc = i + inOut((local - 0.3) / 0.7); break; }
    }
    scrollTarget = clamp(Number.isFinite(acc) ? acc : 0, 0, chapters.length - 1);   // при нулевой высоте окна (скрытая вкладка) деление даёт NaN
  };

  function applyChapters() {
    const p = clamp(scrollPos, 0, poses.length - 1), i0 = Math.min(poses.length - 2, Math.floor(p)), i1 = i0 + 1, t = p - i0;
    if (touch) {   // на первом экране не скачиваем будущие моменты и портрет; меню запускает нужные файлы сразу
      if (p > 0.25 || glideIdx === 1) { loadField(1); loadField(2); }
      if (p > 1.15 || glideIdx === 4) loadField(3);
    }
    if (gliding && glideIdx >= 0 && glideFrom >= 0 && glideIdx !== glideFrom) {   // перелёт по ссылке: камера идёт прямо от позы, откуда улетели, к позе, куда летим, не заезжая в позы глав по пути
      const k = clamp((p - glideFrom) / (glideIdx - glideFrom), 0, 1); gk = k;
      for (const key of ['zoom', 'ox', 'oy', 'rot', 'tilt']) cam[key] = mix(poses[glideFrom][key], poses[glideIdx][key], k);
      cam.zoom *= 1 - Math.sin(Math.PI * k) * 0.14;      // один плавный отъезд камеры на весь перелёт
    } else { for (const k of ['zoom', 'ox', 'oy', 'rot', 'tilt']) cam[k] = mix(poses[i0][k], poses[i1][k], t); cam.zoom *= 1 - Math.sin(Math.PI * t) * 0.1; }
    if (!wide) cam.oy -= foldK * h * 0.2 * (inGlide() ? near(C, p) : Math.max(0, 1 - Math.abs(scrollPos - C)));   // пульт свёрнут — кухня поднимается в центр
    if (!reduced) { cam.rot += Math.sin(clock * 0.21) * 0.012; cam.zoom *= 1 + Math.sin(clock * 0.17) * 0.008; }
    sticks.forEach((el, i) => {
      let d = p - i, o = smooth(1 - Math.abs(d) * 2.2);
      if (inGlide()) { const dir = Math.sign(glideIdx - glideFrom);   // в перелёте текст уходит и приходит по доле пути, а не по главам: на дальнем прыжке он не обрывается
        if (i === glideFrom) { o = smooth(1 - gk * 2.4); d = gk * dir * 0.6; } else if (i === glideIdx) { o = smooth(1 - (1 - gk) * 2.4); d = -(1 - gk) * dir * 0.6; } else { o = 0; d = 1; } }
      // главы на пути перелёта не всплываютт
      if (touch) {   // те же значения напрямую: CSS-переменные не инвалидируют стили всех потомков на каждом кадре
        const opacity = o.toFixed(3), offset = (-d).toFixed(3);
        chapterPaint[i] = { opacity: +opacity, offset: +offset };
        paintStyle(el, 'opacity', opacity);
        paintStyle(el, 'visibility', +opacity > 0 ? 'visible' : 'hidden');
        paintStyle(el, 'willChange', +opacity > 0 && +opacity < 1 ? 'transform, opacity' : 'auto');
        if (+opacity > 0) paintStyle(el, 'transform', reduced ? 'none' : `translate3d(0, ${offset * 70}px, 0) scale(${0.96 + opacity * 0.04})`);
      } else { chapterPaint[i] = { opacity: +o.toFixed(3), offset: +(-d).toFixed(3) }; el.style.setProperty('--o', o.toFixed(3)); el.style.setProperty('--d', (-d).toFixed(3)); }
      if (el.hasAttribute('inert') !== (o < 0.5)) el.toggleAttribute('inert', o < 0.5);
      const inNow = o > 0.55, was = el.classList.contains('is-in'); if (inNow !== was) el.classList.toggle('is-in', inNow);
      if (i === C && inNow !== was) { if (inNow) setTimeout(() => rollStats(false), 120); else rollStats(true); }
    });
    const active = Math.round(p);
    if (active !== navActive) { navActive = active; navLinks.forEach((a, i) => a.setAttribute('aria-current', String(i === active))); menuLinks.forEach((a, i) => a.setAttribute('aria-current', String(i === active))); topCta.setAttribute('aria-disabled', String(active === 6)); topCta.tabIndex = active === 6 ? -1 : 0; }
    paintStyle(progressBar, 'transform', `scaleX(${(p / (chapters.length - 1)).toFixed(4)})`);
    const tail = inGlide() ? near(4, p) + near(5, p) + near(6, p) : smooth(clamp(p - (C + 1), 0, 1)), sys = inGlide() ? near(C + 1, p) : clamp(p - C, 0, 1) * (1 - tail);   // после «Системы» её демо уходит, карта живёт под затемнением
    paintStyle(veilDim, 'opacity', (tail * 0.74 * (1 - near(4, p)) * (1 - 0.5 * near(5, p))).toFixed(3));   // на «Кейсах» затемнение снимаем: там портрет на чёрном
    const con = near(C, clamp(scrollPos, 0, poses.length - 1));   // насколько мы у пульта, тем же законом, что и сама глава: вуаль уходит, размытая колонка проявляется вместе с рычагами
    paintStyle(veilSide, 'opacity', ((1 - sys) * (1 - 0.8 * con)).toFixed(3)); paintStyle(veilFrame, 'opacity', sys.toFixed(3)); paintStyle(veilBlur, 'opacity', con.toFixed(3)); paintStyle(veilBottom, 'opacity', con.toFixed(3));
  }

  // ---------- состояние смены ----------
  let clock = 0, intro = 0;
  const M = window.CourierModel, state = Object.assign({}, M.START), R0 = M.compute(M.START);
  let R = R0, zoneTarget = 0, zone = 0, weatherLevel = 1, backlog = 27;
  const orders = [], flashes = [], agents = Array.from({ length: R.total }, (_, i) => ({ i, on: false, leaving: false, path: null, seg: 0, x: KX, y: KY, state: 'idle', trail: [], wait: 0 }));
  const streaks = Array.from({ length: 90 }, () => ({ x: Math.random() * 2400 - 300, y: Math.random() * 1200, len: 14 + Math.random() * 26, speed: 700 + Math.random() * 600, a: 0.04 + Math.random() * 0.1, drift: Math.random() * 40 - 20 }));
  const zoneOf = (onTime) => 130 + onTime * 2.7;
  // счётчик-барабан: каждая цифра прокручивается на своё место
  const odo = {};
  function roll(id, text) {
    const el = document.getElementById(id), chars = Array.from(text), prevChars = odo[id];
    const same = prevChars && prevChars.length === chars.length && prevChars.every((c, i) => /\d/.test(c) === /\d/.test(chars[i]));
    if (!same) {
      el.innerHTML = chars.map((c) => /\d/.test(c) ? '<span class="odo"><b>' + '0123456789'.split('').map((d) => `<i>${d}</i>`).join('') + '</b></span>' : `<span class="odo-s">${c === ' ' ? NB : c}</span>`).join('');
      el.setAttribute('aria-label', text);
    }
    odo[id] = chars;
    const cols = el.querySelectorAll('.odo b'); let k = 0;
    const set = () => chars.forEach((c) => { if (/\d/.test(c)) cols[k++].style.transform = `translateY(${-c * 10}%)`; });
    if (same || reduced) set(); else requestAnimationFrame(() => requestAnimationFrame(set));
    el.setAttribute('aria-label', text);
  }
  function rollStats(zero) {
    const c = zero ? 0 : R.couriers, t = zero ? 0 : R.time;
    roll('sC', `${c} из ${R.total}`); roll('sT', `${String(t).padStart(2, '0')} мин`);
  }
  function spawn(age) {
    if (!pool.length) return;
    for (let k = 0; k < 20; k++) { const n = pool[(Math.random() * pool.length) | 0]; if (orders.some((o) => o.n === n)) continue; orders.push({ n, x: nx(n), y: ny(n), age, taken: false, born: age > 0 ? -1 : clock, wait0: age > 0 ? 6 + Math.random() * R.time * 0.85 : 3 }); return; }
  }
  function apply() {
    R = M.compute(state);   // заголовок заявки следит за пультом; до загрузки формы вызов просто не срабатывает
    zoneTarget = zoneOf(R.onTime); backlog = Math.max(3, Math.round((R.time - 30) * 0.62));
    agents.forEach((a) => { if (a.i < R.couriers) { if (!a.on) { a.on = true; a.x = KX; a.y = KY; a.path = null; a.state = 'idle'; a.trail = []; a.wait = Math.random(); } a.leaving = false; } else if (a.on) a.leaving = true; });
    rollStats(false);
    const dc = R.couriers - R0.couriers, dt2 = R0.time - R.time, dr = R.cost - R0.cost, v = document.getElementById('verdict');
    if (dt2 > 0) v.innerHTML = `Гость ждет на${NB}<b>${dt2}${NB}мин меньше</b>`;          // одна строка: только что стало с гостем
    else if (dt2 < 0) v.textContent = `Гость ждет на${NB}${-dt2}${NB}мин дольше`;
    else if (dc || dr) v.textContent = `На${NB}доставке не${NB}сказалось`;
    else v.textContent = `Гость ждет больше часа`;
    document.getElementById('rateOut').textContent = `${state.rate}${NB}₽`;
  }

  const BINS = 96, radii = new Float32Array(BINS), radiiTarget = new Float32Array(BINS);
  function zoneShape(limit) {
    const r = new Float32Array(BINS);
    for (let i = 0; i < N; i++) { if (dist[i] > limit) continue; const dx = nx(i) - KX, dy = ny(i) - KY, b = ((Math.atan2(dy, dx) / (Math.PI * 2) + 1) % 1 * BINS) | 0, d = Math.hypot(dx, dy); if (d > r[b]) r[b] = d; }
    for (let pass = 0; pass < 3; pass++) { const c = r.slice(); for (let b = 0; b < BINS; b++) r[b] = (c[(b + BINS - 1) % BINS] + c[b] * 2 + c[(b + 1) % BINS]) / 4; }
    return r;
  }
  function zonePath(k) {
    ctx.beginPath();
    const pt = (b) => { const a = b / BINS * Math.PI * 2, rr = radii[(b + BINS) % BINS] * k; return [KX + Math.cos(a) * rr, KY + Math.sin(a) * rr]; };
    for (let b = 0; b <= BINS; b++) { const [x0, y0] = pt(b), [x1, y1] = pt(b + 1), qx = (x0 + x1) / 2, qy = (y0 + y1) / 2; if (b === 0) ctx.moveTo(qx, qy); else ctx.quadraticCurveTo(x0, y0, qx, qy); }
    ctx.closePath();
  }
  function step(a, dt) {
    if (!a.on) return;
    if (a.wait > 0) { a.wait -= dt; return; }
    if (!a.path) {
      if (a.leaving) { a.on = false; a.leaving = false; a.trail = []; return; }
      let pick = null; for (const o of orders) if (!o.taken && (!pick || o.age > pick.age)) pick = o;
      if (!pick) return; pick.taken = true; a.order = pick; a.path = pathTo(pick.n); a.seg = 0; a.state = 'go';
    }
    let move = 62 * dt;
    while (move > 0 && a.path) {
      const n = a.path[a.seg + 1];
      if (n === undefined) {
        if (a.state === 'go') { const k = orders.indexOf(a.order); if (k >= 0) orders.splice(k, 1); flashes.push({ x: a.x, y: a.y, t: 0 }); a.order = null; a.state = 'back'; a.path = a.path.slice().reverse(); a.seg = 0; }
        else { a.path = null; a.state = 'idle'; a.trail = []; a.wait = 0.4 + Math.random(); }
        break;
      }
      const dx = nx(n) - a.x, dy = ny(n) - a.y, d = Math.hypot(dx, dy);
      if (d <= move) { a.x = nx(n); a.y = ny(n); a.seg++; move -= d; } else { a.x += dx / d * move; a.y += dy / d * move; move = 0; }
    }
    a.trail.push(a.x, a.y); if (a.trail.length > 420) a.trail.splice(0, 2);
  }

  // ---------- третья глава: путь одного заказа, пять шагов по кругу ----------
  const momentEls = Array.from(document.querySelectorAll('#moments li')), MOMENT = 3.9; let painT = 0, painStage = -1; const SCENE_FIX = +(new URLSearchParams(location.search).get('scene') ?? -1);
  const stepEls = Array.from(document.querySelectorAll('#steps li')), STAGE = [0, 1.4, 2.8, 6.2, 7.6, 9.2]; stepEls.forEach((el, i) => el.style.setProperty('--dur', (STAGE[i + 1] - STAGE[i]) + 's'));
  let demoT = 0, demoStage = -1;
  function label(text, x, y, alpha, color, ax) {          // ax — точка, к которой подпись; на телефоне подпись встаёт слева от неё, чтобы не уходить за край
    if (!(alpha > 0.003)) return; ctx.font = `400 12px ${FONT}`; ctx.textBaseline = 'middle'; ctx.shadowColor = BLACK; ctx.shadowBlur = 8; ctx.globalAlpha = alpha; ctx.fillStyle = color || WHITE;
    if (!wide && ax !== undefined) { const lx = ax - (x - ax), tw = ctx.measureText(text).width; if (lx - tw >= 12) { ctx.textAlign = 'right'; ctx.fillText(text, lx, y); ctx.textAlign = 'left'; ctx.shadowBlur = 0; return; } x = Math.min(x, w - 12 - tw); }
    ctx.fillText(text, x, y); ctx.shadowBlur = 0;
  }

  let last = performance.now(), spawnT = 0, frameHandle = 0, menuOpen = false;
  function scheduleFrame() {
    if (frameHandle || document.hidden || menuOpen) return;
    if (canvas.dataset.animationActive !== 'true') canvas.dataset.animationActive = 'true'; frameHandle = requestAnimationFrame(frame);
  }
  function pauseFrame() { cancelAnimationFrame(frameHandle); frameHandle = 0; canvas.dataset.animationActive = 'false'; }
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseFrame(); else { last = performance.now(); scheduleFrame(); } });
  function frame(now) {
    frameHandle = 0; if (document.hidden || menuOpen) return;
    const pageY = window.scrollY;   // все DOM-чтения до записи стилей
    const dt = Math.min(0.05, (now - last) / 1000); last = now; clock += dt; foldK += ((folded ? 1 : 0) - foldK) * Math.min(1, dt * 5);
    // обновление
    if (reduced || swipeSettling || (gliding && glideIdx >= 0)) { scrollPos = scrollTarget; vel = 0; } else {   // в перелёте камера идёт ровно за ним, без пружины: иначе в конце остаётся хвост и рывок
      vel += ((scrollTarget - scrollPos) * 38 - vel * 11.5) * dt; scrollPos += vel * dt; }   // пружина без перелёта
    applyChapters();
    const sys = inGlide() ? near(C + 1, scrollPos) : smooth(clamp(scrollPos - C, 0, 1)) * (1 - smooth(clamp(scrollPos - (C + 1), 0, 1))), pain = near(1, scrollPos), moveK = near(5, scrollPos), shift = (1 - sys * 0.82) * (1 - smooth(morphK * 3)) * (1 - moveK * 0.9);   // значки карты гаснут в начале сборки сцены, а не к её середине
    const read = SHOT !== null ? (+SHOT >= 1 ? 1 : 0) : inGlide() ? 1 - near(0, scrollPos) : smooth(clamp(scrollPos, 0, 1));   // 0 — огоньки, 1 — метки для чтения      // в третьей главе смена уходит на второй план
    for (const o of orders) o.age += dt;
    spawnT -= dt; if (orders.length < backlog && spawnT <= 0) { spawn(0); spawnT = 0.35 + Math.random() * 0.5; }
    agents.forEach((a) => step(a, dt));
    for (const f of flashes) f.t += dt; while (flashes.length && flashes[0].t > 0.7) flashes.shift();
    const zt = zoneTarget;
    if (Math.abs(zone - zt) > 1) { zone += (zt - zone) * Math.min(1, dt * 1.6); radiiTarget.set(zoneShape(zone)); }
    for (let b = 0; b < BINS; b++) radii[b] += (radiiTarget[b] - radii[b]) * Math.min(1, dt * 4);
    weatherLevel += ((state.weather === 'clear' ? 0 : 1) - weatherLevel) * Math.min(1, dt * 2.5);
    intro = Math.min(1, intro + dt / 2.6);
    px += ((hasMouse ? (tmx / w - 0.5) * -26 : 0) - px) * Math.min(1, dt * 3); py += ((hasMouse ? (tmy / h - 0.5) * -18 : 0) - py) * Math.min(1, dt * 3);
    mx += (tmx - mx) * Math.min(1, dt * 9); my += (tmy - my) * Math.min(1, dt * 9);
    if (SHOT === null) { if (sys > 0.5) demoT = (demoT + dt) % STAGE[5]; else demoT = 0; }
    const stage = sys > 0.5 ? STAGE.findIndex((s, i) => demoT >= s && demoT < STAGE[i + 1]) : -1;
    if (pain > 0.5) painT = (painT + dt) % (MOMENT * 3); else painT = 0;
    if (SCENE_FIX >= 0) painT = (SCENE_FIX + 0.5) * MOMENT;                             /* ?scene=0..2 держит один момент — для кадров в Figma */                 // вечер: три момента сменяются сами
    const pst = pain > 0.5 ? (reduced ? 2 : Math.floor(painT / MOMENT)) : -1, pph = (painT % MOMENT) / MOMENT;
    if (pst !== painStage) {
      painStage = pst; momentEls.forEach((el, i) => el.classList.toggle('is-on', i === pst));
    }
    if (moveK > 0.5) moveT = (moveT + dt) % MOVE_LOOP; else moveT = 0;                 // внедрение: 21 день проходит за шесть с половиной секунд, потом пауза
    const dayF = Math.min(21, moveT / DAYS * 21), day = moveK > 0.5 ? Math.min(21, 1 + Math.floor(dayF)) : 0;
    if (day !== dayShown) { dayShown = day; dayN.textContent = `День${NB}${Math.max(1, day)}`; for (let i = 0; i < 21; i++) dayBar.children[i].className = i < day ? 'on' : ''; }
    if (stage !== demoStage) { demoStage = stage; stepEls.forEach((el, i) => { el.classList.toggle('is-on', i === stage); el.classList.toggle('is-done', stage >= 0 && i < stage); }); }

    // рисование
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
    const [kxs, kys] = toScreen(KX, KY), far = Math.hypot(w, h) * 1.05, grow = ease(intro), z = cam.zoom;
    let demoHead = null;
    // При morphK >= .8 карта полностью закрыта чёрной сценой даже при предельном dt: её пиксели не видны.
    if (!touch || morphK < 0.8) {
    if (intro < 1) masked(baseLayer, kxs, kys, far * grow + 30, 0.35, 1);
    else { ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.globalAlpha = 1; drawLayer(ctx, baseLayer); }
    if (hasMouse) spotlight(glowLayer, mx, my, 0.9);
    if (intro < 1) masked(glowLayer, kxs, kys, far * grow + 60, 0.12, (1 - grow) * 0.9);
    const fly = inGlide() ? Math.sin(Math.PI * gk) : Math.abs(scrollPos - Math.round(scrollPos)) * 2;   // в перелёте улицы разгораются один раз на весь путь                     // во время перелёта улицы вспыхивают
    if (fly > 0.04 && !reduced) { ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.globalAlpha = fly * 0.22; drawLayer(ctx, glowLayer); }

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.globalAlpha = 1;
    if (ctx.createConicGradient && !reduced && shift > 0.3) {
      const g = ctx.createConicGradient(clock * 0.7, kxs, kys);
      g.addColorStop(0, 'rgba(0,255,255,0)'); g.addColorStop(0.86, 'rgba(0,255,255,0)'); g.addColorStop(1, `rgba(0,255,255,${0.1 * shift})`);
      ctx.save(); ctx.translate(kxs, kys); ctx.scale(1, cam.tilt); ctx.translate(-kxs, -kys); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(kxs, kys, zone * cam.zoom * 1.25, 0, 7); ctx.fill(); ctx.restore();
    }
    ctx.save(); applyCamera(ctx); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const zk = 0.2 + 0.8 * ease((intro - 0.25) / 0.75);
    zonePath(zk); ctx.fillStyle = CYAN; ctx.globalAlpha = 0.035 * shift; ctx.fill();
    ctx.strokeStyle = WHITE; ctx.globalAlpha = 0.9 * zk * shift; ctx.lineWidth = 1.6 / z; ctx.shadowColor = WHITE; ctx.shadowBlur = 14; ctx.stroke(); ctx.shadowBlur = 0;
    zonePath(zk * (1.045 + Math.sin(clock * 1.2) * 0.008)); ctx.globalAlpha = 0.35 * shift; ctx.lineWidth = 1 / z; ctx.setLineDash([1.5 / z, 5 / z]); ctx.stroke(); ctx.setLineDash([]);
    if (!reduced) { const per = zone * 6.6; zonePath(zk); ctx.strokeStyle = CYAN; ctx.globalAlpha = 0.95 * shift; ctx.lineWidth = 2.4 / z; ctx.shadowColor = CYAN; ctx.shadowBlur = 18; ctx.setLineDash([per * 0.07, per]); ctx.lineDashOffset = -clock * 120; ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0; ctx.shadowBlur = 0; }
    for (const a of agents) {
      if (!a.on || !a.path) continue;
      const go = a.state === 'go';
      const trace = (from, to) => { ctx.beginPath(); if (from === a.seg + 1) ctx.moveTo(a.x, a.y); else ctx.moveTo(nx(a.path[from]), ny(a.path[from])); for (let i = from === a.seg + 1 ? from : from + 1; i <= to; i++) ctx.lineTo(nx(a.path[i]), ny(a.path[i])); if (to === a.seg) ctx.lineTo(a.x, a.y); };
      {                                                    // длинный хвост: в первой главе яркий, у пульта тише
        ctx.strokeStyle = CYAN; ctx.lineWidth = 1 / z; ctx.globalAlpha = (go ? 0.3 : 0.1) * shift * (1 - read); if (read < 0.98) { trace(a.seg + 1, a.path.length - 1); ctx.stroke(); }
        const T = a.trail, n0 = 0, tail = 1 - read * 0.45; ctx.lineWidth = 1.8 / z;
        for (let i = n0 + 2; i < T.length; i += 6) { const e = Math.min(i + 4, T.length - 2); ctx.globalAlpha = Math.pow((e - n0) / (T.length - n0), 1.5) * 0.85 * shift * tail; ctx.beginPath(); ctx.moveTo(T[i - 2], T[i - 1]); for (let j = i; j <= e; j += 2) ctx.lineTo(T[j], T[j + 1]); ctx.stroke(); }
      }
      if (read < 0.02) continue;
      if (go) {
        ctx.strokeStyle = WHITE; ctx.globalAlpha = 0.22 * shift * read; ctx.lineWidth = 1.6 / z; trace(0, a.seg); ctx.stroke();                 // пройдено
        ctx.strokeStyle = BLACK; ctx.globalAlpha = 0.9 * shift * read; ctx.lineWidth = 6 / z; trace(a.seg + 1, a.path.length - 1); ctx.stroke();  // подложка
        ctx.strokeStyle = CYAN; ctx.globalAlpha = 0.95 * shift * read; ctx.lineWidth = 2.2 / z; trace(a.seg + 1, a.path.length - 1); ctx.stroke(); // осталось
      } else {
        ctx.strokeStyle = CYAN; ctx.globalAlpha = 0.22 * shift * read; ctx.lineWidth = 1 / z; ctx.setLineDash([2 / z, 5 / z]); trace(a.seg + 1, a.path.length - 1); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    // путь одного заказа
    if (sys > 0.02) {
      const run = clamp((demoT - STAGE[2]) / (STAGE[3] - STAGE[2]), 0, 1), drawn = stage >= 2 ? (stage === 2 ? ease(run) : 1) : 0;
      ctx.strokeStyle = WHITE; ctx.globalAlpha = 0.28 * sys; ctx.lineWidth = 1.2 / z; ctx.setLineDash([3 / z, 5 / z]);
      ctx.beginPath(); ctx.moveTo(nx(demoPath[0]), ny(demoPath[0])); for (const n of demoPath) ctx.lineTo(nx(n), ny(n)); ctx.stroke(); ctx.setLineDash([]);
      if (drawn > 0) {
        const [hx, hy, hi] = demoPoint(drawn); demoHead = [hx, hy];
        ctx.strokeStyle = CYAN; ctx.globalAlpha = sys; ctx.lineWidth = 3.2 / z; ctx.shadowColor = CYAN; ctx.shadowBlur = 22;
        ctx.beginPath(); ctx.moveTo(nx(demoPath[0]), ny(demoPath[0])); for (let i = 1; i < hi; i++) ctx.lineTo(nx(demoPath[i]), ny(demoPath[i])); ctx.lineTo(hx, hy); ctx.stroke(); ctx.shadowBlur = 0;
      }
    }
    ctx.restore();
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    const caseK = near(4, scrollPos);                              // глава «Кейсы»: линии собирают портрет
    const passing = gliding && glideIdx >= 0, want = scene.ready ? (pain > 0.5 && !(passing && glideIdx !== 1) ? fields[Math.max(0, pst)] : caseK > 0.5 && !(passing && glideIdx !== 4) ? fields[3] : null) || null : null;
    if (want && want !== F) {                            // новый момент: линии не гаснут, а перетекают со старых мест на новые и дорисовывают сцену
      const live = morphK > 0.5; Fold = F; F = want; swapK = live ? 0 : 1;
      for (const q of scene.parts) {
        const Z = !q.amb && q.inZone && F.zone ? F.zone : null, [x, y] = spawnAt(q, F);
        if (live) { q.o = [q.x, q.y]; q.to = [x, y]; q.wd = clamp(x * 0.8 + 0.1 * Math.sin(y * 7) + 0.1, 0, 1); q.hot0 = q.hot || 0; q.hot1 = !q.amb && ((Z && F.hot.length) || F.hot.some((r) => x > r[0] && x < r[1] && y > r[2] && y < r[3])) ? 1 : 0; q.side = (Math.random() < 0.5 ? 1 : -1) * (0.05 + Math.random() * 0.16); }
        else { const T = q.t; q.o = null; q.x = x; q.y = y; q.n = 1; T[0] = x; T[1] = y; q.age = 0; q.life = 2.5 + Math.random() * 3.5; }
      }
    }
    swapK = Math.min(1, swapK + dt / 1.8);
    morphK += ((want ? 1 : 0) - morphK) * Math.min(1, dt * 1.7);
    if (document.body.classList.contains('pin')) { morphK = want ? 1 : 0; swapK = 1; }   // в режиме снимка сцена показывается сразу собранной
    if (morphK > 0.004) {                                // улицы гаснут и распадаются на живые линии
      ctx.fillStyle = BLACK; ctx.globalAlpha = smooth(morphK * 1.4); ctx.fillRect(0, 0, w, h);
      let size = wide ? Math.min(w * 0.548, h * 0.95) : Math.min(w * 1.17, h * 0.548), bx = (wide ? w * 0.745 : w * 0.5) - size / 2, by = (wide ? h * 0.53 : h * 0.75) - size / 2;
      if (!wide) {                                       // на телефоне сцена занимает место под текстом главы, сколько бы его ни было
        const el = F === fields[3] ? casesText : painText, top = el ? sceneBottom(el, pageY) + 24 : h * 0.5, room = Math.max(120, h - top - 10);
        size = Math.min(w * 1.17, room / 0.86); bx = w / 2 - size / 2; by = top + room / 2 - size * 0.51;
      }
      const G = F.g, at = (x, y) => (Math.min(G - 1, Math.max(0, y * G | 0)) * G + Math.min(G - 1, Math.max(0, x * G | 0)));
      if (touch && F.grain && !F.grainSprite && !F.baking) bakePortrait(F);
      if (touch && F.grainSprite) { mobilePortrait(F, bx, by, size); }
      else if (F.grain) {                                     // гранулы слетаются волной, мерцают, а под курсором разлетаются и возвращаются на место
        const P = F.grain, O = F.go, N = P.length / 8, t = (clock * GP.speed) % 1, band = -0.35 + 1.7 * t, dot = Math.max(0.5, size / 700 * GP.dot), jit = GP.jitter / 10000, B = grainBuckets;
        for (const bucket of B) bucket.length = 0;
        const live = hasMouse && !reduced && morphK > 0.9, mxf = live ? (tmx - bx) / size : -9, myf = live ? (tmy - by) / size : -9, R = GP.reach, R2 = R * R;
        const mvx = live && F.pm ? clamp((mxf - F.pm[0]) / Math.max(dt, 0.004), -3, 3) : 0, mvy = live && F.pm ? clamp((myf - F.pm[1]) / Math.max(dt, 0.004), -3, 3) : 0; F.pm = live ? [mxf, myf] : null;
        const damp = Math.exp(-5.5 * dt), spd = Math.hypot(mvx, mvy);
        if (GP.pic > 0 && F.gimg.complete && F.gimg.naturalWidth) { ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = GP.pic * smooth((morphK - 0.45) / 0.55); ctx.drawImage(F.gimg, bx, by, size, size); ctx.globalCompositeOperation = 'source-over'; }
        const gstep = inGlide() ? 3 : 1;                 // на пролёте портрет рисуется каждым третьим зерном: кадр не проседает, а глазу в движении разницы нет
        for (let k = 0; k < N; k += gstep) {
          const i = k * 8, j = k * 4, hx = P[i], hy = P[i + 1], ph = P[i + 3], e = inOut(clamp((morphK - hx * 0.45) / 0.55, 0, 1));
          if (e <= 0) continue;
          let ox = O[j], oy = O[j + 1], vx = O[j + 2], vy = O[j + 3];
          const dx = hx + ox - mxf, dy = hy + oy - myf, d2 = dx * dx + dy * dy;
          if (d2 < R2 && spd > 0.02) {                   // курсор не выдавливает дыру: зёрна только смазываются вслед за движением, каждое на свою величину
            const d = Math.sqrt(d2) + 1e-4, f = 1 - d / R, own = 0.35 + 0.65 * (P[i + 4] * 0.5 + 0.5), g = GP.push * f * f * own;
            vx += (mvx * g * 0.5 - dy / d * spd * g * 0.22 + P[i + 5] * spd * g * 0.12) * dt; vy += (mvy * g * 0.5 + dx / d * spd * g * 0.22 + P[i + 4] * spd * g * 0.12) * dt;
          }
          if (ox || oy || vx || vy) {                    // пружина возвращает зерно на место
            vx = (vx - ox * 26 * dt) * damp; vy = (vy - oy * 26 * dt) * damp; ox += vx * dt; oy += vy * dt;
            const om = Math.hypot(ox, oy); if (om > 0.028) { ox *= 0.028 / om; oy *= 0.028 / om; }   // далеко от своего места зерно не уходит
            if (d2 >= R2 && Math.abs(ox) + Math.abs(oy) < 2e-4 && Math.abs(vx) + Math.abs(vy) < 2e-4) ox = oy = vx = vy = 0;
            O[j] = ox; O[j + 1] = oy; O[j + 2] = vx; O[j + 3] = vy;
          }
          const sc = (1 - e) * 0.32, x = hx + ox + P[i + 4] * sc + Math.sin(clock * 0.9 + ph) * jit, y = hy + oy + P[i + 5] * sc + Math.cos(clock * 0.7 + ph * 1.7) * jit;
          const lit = Math.max(0, 1 - Math.abs(hx - hy * 0.25 - band) / 0.16), a = (GP.floor + (1 - GP.floor) * P[i + 2]) * (0.92 - GP.shimmer + GP.shimmer * Math.sin(clock * 1.6 + ph * 3)) * e + lit * GP.band * e;
          B[a > 0.8 ? 3 : a > 0.58 ? 2 : a > 0.38 ? 1 : 0].push(bx + x * size, by + y * size, dot * P[i + 6]);
        }
        if (F.dust) { const U = F.dust, M = U.length / 5, dk = smooth((morphK - 0.3) / 0.7);   // россыпь медленно плывёт и мерцает
          for (let k = 0; k < M; k++) { const i = k * 5, ph = U[i + 3], x = U[i] + Math.sin(clock * 0.11 + ph) * 0.02, y = U[i + 1] + Math.cos(clock * 0.09 + ph * 1.3) * 0.02 - ((clock * 0.004 + ph) % 0.06), a = U[i + 2] * (0.5 + 0.5 * Math.sin(clock * 0.8 + ph * 2)) * dk;
            if (a > 0.06) B[a > 0.7 ? 3 : a > 0.45 ? 2 : a > 0.22 ? 1 : 0].push(bx + x * size, by + y * size, dot * 1.6 * U[i + 4]); } }
        ctx.fillStyle = CYAN;
        if (touch) {
          if (grainLayer.width !== canvas.width || grainLayer.height !== canvas.height) { grainLayer.width = canvas.width; grainLayer.height = canvas.height; }
          grainCtx.setTransform(ratio, 0, 0, ratio, 0, 0); grainCtx.fillStyle = CYAN;
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          for (let b = 0; b < 4; b++) {
            const L = B[b]; grainCtx.clearRect(0, 0, w, h);
            for (let start = 0; start < L.length; start += 6144) {
              grainCtx.beginPath(); const end = Math.min(start + 6144, L.length);
              for (let q = start; q < end; q += 3) grainCtx.rect(L[q], L[q + 1], L[q + 2], L[q + 2]);
              grainCtx.fill();
            }
            // Сначала непрозрачная маска объединяет все зёрна группы, затем её общая яркость применяется один раз.
            ctx.globalAlpha = [0.28, 0.5, 0.74, 1][b]; ctx.drawImage(grainLayer, 0, 0);
          }
          ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        } else {
          for (let b = 0; b < 4; b++) { const L = B[b]; ctx.globalAlpha = [0.28, 0.5, 0.74, 1][b]; ctx.beginPath(); for (let q = 0; q < L.length; q += 3) ctx.rect(L[q], L[q + 1], L[q + 2], L[q + 2]); ctx.fill(); }
        }
        ctx.globalAlpha = 1;
      } else if (F.img && F.img.complete && F.img.naturalWidth) {
        const fade = smooth((morphK - 0.5) / 0.5) * (1 - 0.6 * Math.sin(Math.PI * swapK));
        ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = fade * (F.rim ? 0.86 : 0.66 + 0.06 * Math.sin(clock * 1.3)); ctx.drawImage(F.img, bx, by, size, size);   // рисунок слегка «дышит»
        const lay = F.rim && F.rim.complete && F.rim.naturalWidth ? F.rim : F.img;   // свет бежит по контуру, если он есть, иначе по самому портрету
        if (lay === F.rim) { ctx.globalAlpha = fade * 0.3; ctx.drawImage(F.rim, bx, by, size, size); }
        if (!reduced) {                                  // полоса света идёт слева направо: под ней контур разгорается; черты лица не двигаются
          if (dimC.width !== canvas.width || dimC.height !== canvas.height) { dimC.width = canvas.width; dimC.height = canvas.height; }
          const t = (clock * 0.13) % 1, cx = bx + size * (-0.35 + 1.7 * t), bw = size * 0.24;
          dctx.setTransform(ratio, 0, 0, ratio, 0, 0); dctx.globalCompositeOperation = 'source-over'; dctx.globalAlpha = 1; dctx.clearRect(0, 0, w, h); dctx.drawImage(lay, bx, by, size, size);
          const g = dctx.createLinearGradient(cx - bw, by, cx + bw, by + size * 0.35); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
          dctx.globalCompositeOperation = 'destination-in'; dctx.fillStyle = g; dctx.fillRect(0, 0, w, h);
          ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = fade * (lay === F.rim ? 0.95 : 0.45); ctx.drawImage(dimC, 0, 0); ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        }
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const arc = (x1, y1, x2, y2, b) => { ctx.moveTo(x1, y1); ctx.quadraticCurveTo((x1 + x2) / 2 - (y2 - y1) * b, (y1 + y2) / 2 + (x2 - x1) * b, x2, y2); };   // в полёте линия гнётся дугой, а не летит палкой
      if (!F.grain) for (const hot of [0, 1]) for (let lvl = 0; lvl < 3; lvl++) {
        ctx.beginPath();
        for (const q of scene.parts) {
          if (lvl === 0 && hot === 0) {                  // шаг частицы: считаем один раз за кадр
            const e2 = q.o ? inOut(clamp((swapK - q.wd * 0.5) / 0.5, 0, 1)) : 1, T = q.t; let step = 0.006;
            if (q.o && e2 >= 1) { q.o = null; q.life = 2.5 + Math.random() * 3.5; }
            if (q.o && e2 > 0) {                         // перелёт в новую сцену: линия тянется дугой и оставляет за собой штрих
              const k = Math.sin(Math.PI * e2), ddx = q.to[0] - q.o[0], ddy = q.to[1] - q.o[1], px2 = mix(q.o[0], q.to[0], e2) - ddy * k * q.side, py2 = mix(q.o[1], q.to[1], e2) + ddx * k * q.side;
              const vx = px2 - q.x, vy = py2 - q.y, vl = Math.hypot(vx, vy) || 1; q.dx = vx / vl; q.dy = vy / vl; q.x = px2; q.y = py2; q.hot = e2 < 0.5 ? q.hot0 : q.hot1; q.lvl = q.hot && q.band % 2 ? 2 : 1; q.age = 1; step = 0.009;   // в перелёте светится половина голубых линий, иначе всё сливается в пятно
            } else {
              const fld = q.o ? Fold : F, Z = !q.amb && q.inZone && fld.zone ? fld.zone : null, out = Math.max(0, -q.x, q.x - 1, -q.y, q.y - 1), zi = (x, y) => { const u = (x - Z.r[0]) / (Z.r[1] - Z.r[0]), v = (y - Z.r[2]) / (Z.r[3] - Z.r[2]); return u < 0 || u >= 1 || v < 0 || v >= 1 ? -1 : (v * Z.h | 0) * Z.w + (u * Z.w | 0); }, zm = (x, y) => { const i = zi(x, y); return i < 0 ? 0 : Z.mask[i] / 255; };
              const c = at(q.x, q.y), th = out > 0 ? Math.sin(q.x * 3.1 + clock * 0.12) * 1.4 + Math.cos(q.y * 2.7 - clock * 0.09) * 1.2 : Z ? Z.ang[Math.max(0, zi(q.x, q.y))] / 255 * Math.PI : fld.ang[c] / 255 * Math.PI + Math.sin(clock * 0.6 + q.band) * 0.25; let ux = Math.cos(th), uy = Math.sin(th);
              if (ux * q.dx + uy * q.dy < 0) { ux = -ux; uy = -uy; }
              q.dx += (ux - q.dx) * 0.2; q.dy += (uy - q.dy) * 0.2; const sp = Z ? q.sp * Z.k : q.sp; q.x += q.dx * sp * dt; q.y += q.dy * sp * dt; q.life -= dt; q.age += dt; q.m = out > 0 ? 0.3 * Math.max(0, 1 - out / 0.34) : Z ? zm(q.x, q.y) : Math.max(q.amb ? 0.12 : 0, fld.mask[at(q.x, q.y)] / 255);   // за краем картинки линии не обрываются, а редеют и плывут дальше
              if (Z) step = 0.006 * Z.k;
              if (!q.o && (q.life <= 0 || out > 0 || q.m < (Z ? 0.2 : 0.06))) { const [x, y] = spawnAt(q, F); q.x = x; q.y = y; q.n = 1; T[0] = x; T[1] = y; q.life = Z ? 1.2 + Math.random() * 2 : 2.5 + Math.random() * 4; q.age = 0; q.dx = Math.random() - 0.5; q.dy = Math.random() - 0.5; }
              if (!q.o) { q.hot = !q.amb && out === 0 && ((Z && F.hot.length) || F.hot.some((r) => q.x > r[0] && q.x < r[1] && q.y > r[2] && q.y < r[3])) ? 1 : 0; q.lvl = q.amb || out > 0 ? 0 : Z ? 2 : q.m > 0.6 ? 2 : q.m > 0.3 ? 1 : 0; if (!q.hot && q.lvl < 2 && F.bright.some((r) => q.x > r[0] && q.x < r[1] && q.y > r[2] && q.y < r[3])) q.lvl = q.m > 0.15 ? 2 : 1; if (!q.o && F.quiet.some((r) => q.x > r[0] && q.x < r[1] && q.y > r[2] && q.y < r[3])) { q.hot = 0; q.lvl = 0; } }   // второй герой сцены: ярче белым, но без голубого
            }
            const lx = T[(q.n - 1) * 2], ly = T[(q.n - 1) * 2 + 1];
            if (Math.hypot(q.x - lx, q.y - ly) > step) { if (q.n < TRAIL) q.n++; else T.copyWithin(0, 2); T[(q.n - 1) * 2] = q.x; T[(q.n - 1) * 2 + 1] = q.y; }
          }
          if (q.hot !== hot || q.lvl !== lvl || q.n < 2 || q.age < 0.05) continue;
          const e = inOut(clamp((morphK - clamp(q.x * 0.8 + 0.1 * Math.sin(q.y * 7) + 0.1, 0, 1) * 0.45) / 0.55, 0, 1)), T = q.t;
          if (e < 0.97) {                                // по дороге из улицы линия остаётся прямым отрезком
            const [sx1, sy1] = toScreen(q.src[0], q.src[1]), [sx2, sy2] = toScreen(q.src[2], q.src[3]);
            arc(mix(sx1, bx + T[0] * size, e), mix(sy1, by + T[1] * size, e), mix(sx2, bx + T[(q.n - 1) * 2] * size, e), mix(sy2, by + T[(q.n - 1) * 2 + 1] * size, e), Math.sin(Math.PI * e) * (q.band % 2 ? 0.8 : -0.8));
          } else { ctx.moveTo(bx + T[0] * size, by + T[1] * size); for (let k = 1; k < q.n; k++) ctx.lineTo(bx + T[k * 2] * size, by + T[k * 2 + 1] * size); }
        }
        ctx.strokeStyle = hot ? CYAN : WHITE; ctx.lineWidth = hot ? 1.3 : 1; ctx.globalAlpha = morphK * (hot ? [0.3, 0.6, 0.95][lvl] : [0.14, 0.34, 0.7][lvl]) * (F.img ? 0.55 : 1);
        if (hot && lvl === 2) { ctx.shadowColor = CYAN; ctx.shadowBlur = 8; }
        ctx.stroke(); ctx.shadowBlur = 0;
      }
      ctx.lineCap = 'butt'; ctx.lineJoin = 'miter'; ctx.globalAlpha = 1;
    }

    // точки и подписи без искажения камеры
    if (shift > 0.003) {                                // значки карты: когда собрана сцена, их нет совсем
    const tags = [];
    for (const o of orders) {
      const [x, y] = toScreen(o.x, o.y), wait = Math.min(R.time + 12, Math.round(o.wait0 + o.age * 1.3));
      const late = wait >= LATE_MIN, soon = wait >= SOON_MIN, col = o.taken ? CYAN : late ? LATE : WHITE;
      const pop = o.born < 0 ? 1 : ease((clock - o.born) / 0.5), ph = (o.age % 2) / 2;
      if (late && !o.taken) { ctx.strokeStyle = LATE; ctx.lineWidth = 1.5; ctx.globalAlpha = (1 - ph) * 0.8 * shift; ctx.beginPath(); ctx.arc(x, y, 6 + ph * 20, 0, 7); ctx.stroke(); }
      if (pst === 2 && late && !o.taken) { ctx.strokeStyle = WHITE; ctx.lineWidth = 1.5; ctx.globalAlpha = (1 - pph) * pain * (1 - morphK); ctx.beginPath(); ctx.arc(x, y, 10 + pph * 46, 0, 7); ctx.stroke(); }
      // булавка: кольцо и точка
      ctx.globalAlpha = (o.taken ? 0.9 : late ? 1 : soon ? 0.75 : 0.4) * shift * pop;
      const solid = late && !o.taken;
      ctx.fillStyle = solid ? WHITE : BLACK; ctx.strokeStyle = col; ctx.lineWidth = solid ? 2 : 1.2; ctx.beginPath(); ctx.arc(x, y, (solid ? 6.5 : 5) * (2 - pop), 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = solid ? BLACK : col; ctx.beginPath(); ctx.arc(x, y, 2, 0, 7); ctx.fill();
      if (o.taken) { ctx.strokeStyle = CYAN; ctx.lineWidth = 1; ctx.globalAlpha = 0.5 * shift * read; ctx.beginPath(); ctx.arc(x, y, 11, 0, 7); ctx.stroke(); }
      if (!o.taken && soon) tags.push({ x, y, wait, late });
    }
    // бирки с минутами: только у тех, кто ждёт дольше всех
    tags.sort((a, b) => b.wait - a.wait);
    ctx.font = `400 11px ${FONT}`; ctx.textBaseline = 'middle';
    const placed = [];
    if (moveK > 0.05 || (!wide && sys > 0.05)) tags.length = 0;   // на «Внедрении» и в «Продукте» на телефоне бирки с минутами мешают графике
    for (const t of tags) {
      if (placed.length >= 4) break;
      if (placed.some((q) => Math.abs(q.x - t.x) < 90 && Math.abs(q.y - t.y) < 30)) continue;
      placed.push(t);
      ctx.shadowColor = BLACK; ctx.shadowBlur = 6; ctx.globalAlpha = (t.late ? 0.9 : 0.5) * shift * read; ctx.fillStyle = WHITE;   // подпись без плашки: тихая, ярче только у опоздавших
      { const txt = `${t.wait}${NB}мин`, tw = ctx.measureText(txt).width, left = t.x + 12 + tw > w - 8; ctx.textAlign = left ? 'right' : 'left'; ctx.fillText(txt, left ? t.x - 12 : t.x + 12, t.y - 12); ctx.textAlign = 'left'; } ctx.shadowBlur = 0;   // у края бирка встаёт слева от точки
    }
    for (const f of flashes) { const [x, y] = toScreen(f.x, f.y); ctx.strokeStyle = CYAN; ctx.lineWidth = 1.5; ctx.globalAlpha = (1 - f.t / 0.7) * shift; ctx.beginPath(); ctx.arc(x, y, 4 + f.t * 50, 0, 7); ctx.stroke(); }
    for (const a of agents) {
      if (!a.on || !a.path) continue;
      const [x, y] = toScreen(a.x, a.y), go = a.state === 'go', n = a.path[Math.min(a.path.length - 1, a.seg + 1)];
      const [tx, ty] = toScreen(nx(n), ny(n)); if (Math.hypot(tx - x, ty - y) > 0.5) a.head = Math.atan2(ty - y, tx - x);
      const ang = a.head || 0;
      if (pst === 1) { ctx.strokeStyle = CYAN; ctx.lineWidth = 1.5; ctx.globalAlpha = (1 - pph) * pain * (1 - morphK); ctx.beginPath(); ctx.arc(x, y, 10 + pph * 40, 0, 7); ctx.stroke(); }
      if (read < 0.98) { ctx.globalAlpha = shift * (1 - read); ctx.fillStyle = CYAN; ctx.shadowColor = CYAN; ctx.shadowBlur = 12; ctx.beginPath(); ctx.arc(x, y, 2.8, 0, 7); ctx.fill(); ctx.shadowBlur = 0; }
      if (read < 0.02) continue;
      const r = 3 + 5 * read;
      ctx.globalAlpha = shift * read; ctx.lineWidth = 1.5; ctx.strokeStyle = CYAN; ctx.fillStyle = go ? CYAN : BLACK;
      if (go) { ctx.globalAlpha = 0.16 * shift * read; ctx.beginPath(); ctx.arc(x, y, r + 7, 0, 7); ctx.fill(); ctx.globalAlpha = shift * read; }
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.stroke();
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.scale(r / 8, r / 8); ctx.fillStyle = go ? BLACK : CYAN;
      ctx.beginPath(); ctx.moveTo(4.2, 0); ctx.lineTo(-2.6, -3.4); ctx.lineTo(-1, 0); ctx.lineTo(-2.6, 3.4); ctx.closePath(); ctx.fill(); ctx.restore();
    }
    }

    if (pst === 0) for (const k of [0, 0.5]) { const q = (pph + k) % 1; ctx.strokeStyle = WHITE; ctx.lineWidth = 1.5; ctx.globalAlpha = (1 - q) * pain * (1 - morphK); ctx.beginPath(); ctx.arc(kxs, kys, 14 + q * 70, 0, 7); ctx.stroke(); }
    const pulse = (clock % 3) / 3;
    const km = 1 - smooth(morphK * 3);                    // пока идёт сцена, значок кухни прячется
    if (km > 0.003) {                                   // Safari на iOS рисует и с нулевой прозрачностью — скрытое просто не рисуем
    ctx.strokeStyle = WHITE; ctx.lineWidth = 1; ctx.globalAlpha = (1 - pulse) * 0.4 * km; ctx.beginPath(); ctx.arc(kxs, kys, 12 + pulse * 34, 0, 7); ctx.stroke();
    ctx.globalAlpha = km; ctx.fillStyle = BLACK; ctx.lineWidth = 1.5; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(kxs - 9, kys - 9, 18, 18, 4.4); else ctx.rect(kxs - 9, kys - 9, 18, 18); ctx.fill(); ctx.stroke();
    ctx.fillStyle = WHITE; ctx.beginPath(); ctx.arc(kxs, kys, 2.5, 0, 7); ctx.fill();
    label('Кухня', kxs + 18, kys, 0.5 * (1 - sys) * km * (1 - moveK));
    }
    if (moveK > 0.02) {                                  // сеть переходит на систему: от головной кухни к точкам тянутся линии, точка загорается
      net.forEach((o, i) => {
        const [x, y] = toScreen(o.x, o.y), k = clamp((dayF - (1.5 + i * 18.5 / (net.length - 1))) / 1.4, 0, 1), on = k >= 1;
        if (k > 0) { const e = ease(k); ctx.strokeStyle = CYAN; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.55 * moveK; ctx.beginPath(); ctx.moveTo(kxs, kys); ctx.lineTo(mix(kxs, x, e), mix(kys, y, e)); ctx.stroke(); }
        if (k > 0.6 && k < 1 || on && dayF - (1.5 + i * 18.5 / (net.length - 1)) < 3.2) { const q = clamp((dayF - (1.5 + i * 18.5 / (net.length - 1)) - 0.9) / 2.3, 0, 1); ctx.strokeStyle = CYAN; ctx.lineWidth = 1.5; ctx.globalAlpha = (1 - q) * moveK; ctx.beginPath(); ctx.arc(x, y, 9 + q * 30, 0, 7); ctx.stroke(); }
        ctx.globalAlpha = moveK * (on ? 1 : 0.5); ctx.fillStyle = on ? CYAN : BLACK; ctx.strokeStyle = on ? CYAN : WHITE; ctx.lineWidth = 1.3;
        ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x - 6, y - 6, 12, 12, 3); else ctx.rect(x - 6, y - 6, 12, 12); ctx.fill(); ctx.stroke();
        if (on) { ctx.fillStyle = BLACK; ctx.beginPath(); ctx.arc(x, y, 1.8, 0, 7); ctx.fill(); }
      });
      ctx.globalAlpha = 1;
    }

    if (sys > 0.02) {
      const [gx, gy] = toScreen(nx(demoNode), ny(demoNode)), st = stage, local = st >= 0 ? clamp((demoT - STAGE[st]) / 0.5, 0, 1) : 0;
      // гость: точка заказа
      const gp = (clock % 1.6) / 1.6; ctx.strokeStyle = st === 3 ? CYAN : WHITE; ctx.lineWidth = 1.5; ctx.globalAlpha = (1 - gp) * sys * (st === 0 || st === 3 ? 1 : 0.4); ctx.beginPath(); ctx.arc(gx, gy, 6 + gp * (st === 3 ? 46 : 22), 0, 7); ctx.stroke();
      ctx.globalAlpha = sys; ctx.fillStyle = WHITE; ctx.beginPath(); ctx.arc(gx, gy, 4.5, 0, 7); ctx.fill();
      // кухня готовит: кольцо заполняется
      if (st === 1) { const k = clamp((demoT - STAGE[1]) / (STAGE[2] - STAGE[1]), 0, 1); ctx.strokeStyle = CYAN; ctx.lineWidth = 3; ctx.globalAlpha = sys; ctx.shadowColor = CYAN; ctx.shadowBlur = 14; ctx.beginPath(); ctx.arc(kxs, kys, 22, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2); ctx.stroke(); ctx.shadowBlur = 0; }
      if (demoHead && st === 2) { const [hx, hy] = toScreen(demoHead[0], demoHead[1]); ctx.fillStyle = CYAN; ctx.globalAlpha = sys; ctx.shadowColor = CYAN; ctx.shadowBlur = 24; ctx.beginPath(); ctx.arc(hx, hy, 6, 0, 7); ctx.fill(); ctx.shadowBlur = 0; }
      const a = sys * ease(local);
      if (st === 0) {                                    // заказ: от гостя на кухню по дуге летит сигнал, за ним тянется след
        const k0 = inOut(clamp((demoT - STAGE[0] - 0.25) / (STAGE[1] - STAGE[0] - 0.35), 0, 1)), cx0 = (gx + kxs) / 2 - (kys - gy) * 0.28, cy0 = (gy + kys) / 2 + (kxs - gx) * 0.28;
        const at0 = (t) => [(1 - t) * (1 - t) * gx + 2 * (1 - t) * t * cx0 + t * t * kxs, (1 - t) * (1 - t) * gy + 2 * (1 - t) * t * cy0 + t * t * kys];
        ctx.strokeStyle = WHITE; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.7 * sys; ctx.beginPath(); ctx.moveTo(gx, gy); for (let i = 1; i <= 28; i++) { const [x, y] = at0(k0 * i / 28); ctx.lineTo(x, y); } ctx.stroke();
        const [ox2, oy2] = at0(k0); ctx.fillStyle = WHITE; ctx.globalAlpha = sys; ctx.shadowColor = WHITE; ctx.shadowBlur = 16; ctx.beginPath(); ctx.arc(ox2, oy2, 4.5, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
        if (k0 > 0.92) { const f = (k0 - 0.92) / 0.08; ctx.strokeStyle = WHITE; ctx.lineWidth = 1.5; ctx.globalAlpha = (1 - f) * sys; ctx.beginPath(); ctx.arc(kxs, kys, 14 + f * 30, 0, 7); ctx.stroke(); }
        label('Заказ из приложения', gx + 16, gy, a, WHITE, gx);
      }
      if (st === 1) label('Кухня готовит', kxs + 20, kys - 26, a, CYAN, kxs);
      if (st === 2 && demoHead) { const [hx, hy] = toScreen(demoHead[0], demoHead[1]); label('Курьер в пути', hx + 16, hy - 14, a, CYAN, hx); }
      if (st === 3) label('Гость получил заказ', gx + 16, gy, a, CYAN, gx);
      if (st === 4) {                                    // деньги: от гостя к кухне бежит импульс, потом у точек сети вырастают столбики
        const k4 = clamp((demoT - STAGE[4]) / (STAGE[5] - STAGE[4]), 0, 1), back = clamp(k4 / 0.35, 0, 1), grow = ease(clamp((k4 - 0.25) / 0.5, 0, 1));
        if (back < 1) { const [mx2, my2] = demoPoint(1 - back), [sx, sy] = toScreen(mx2, my2); ctx.fillStyle = CYAN; ctx.globalAlpha = sys; ctx.shadowColor = CYAN; ctx.shadowBlur = 20; ctx.beginPath(); ctx.arc(sx, sy, 5, 0, 7); ctx.fill(); ctx.shadowBlur = 0; }
        const bar = (x, y, v, main) => {
          const hh = (main ? 74 : 56) * v * grow; ctx.globalAlpha = sys; ctx.fillStyle = BLACK; ctx.strokeStyle = main ? CYAN : WHITE; ctx.lineWidth = 1.5;
          ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x - 5, y - 10 - hh, 10, hh + 2, 3); else ctx.rect(x - 5, y - 10 - hh, 10, hh + 2); ctx.fill(); ctx.stroke();
          ctx.fillStyle = main ? CYAN : WHITE; ctx.globalAlpha = sys * (main ? 0.9 : 0.5); ctx.fillRect(x - 3, y - 8 - hh, 6, Math.max(0, hh - 2));
          ctx.globalAlpha = sys * grow; ctx.fillStyle = BLACK; ctx.strokeStyle = WHITE; ctx.lineWidth = 1.2; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x - 6, y - 6, 12, 12, 3); else ctx.rect(x - 6, y - 6, 12, 12); ctx.fill(); ctx.stroke();
        };
        for (const o of outlets) { const [x, y] = toScreen(o.x, o.y); bar(x, y, o.v, false); }
        bar(kxs, kys - 14, 1, true);
        label('Выручка по точкам', kxs + 34, kys - 40, a, CYAN, kxs);
      }
    }

    if (weatherLevel > 0.02) {
      ctx.strokeStyle = WHITE; ctx.fillStyle = WHITE; ctx.lineWidth = 1; const snow = state.weather === 'snow';
      for (const s of streaks) {
        const k = snow ? 0.12 : 1; s.y += s.speed * k * dt; s.x -= s.speed * k * 0.22 * dt + (snow ? s.drift * dt : 0);
        if (s.y > h + 40) { s.y = -40; s.x = Math.random() * (w + 300) - 100; }
        ctx.globalAlpha = s.a * weatherLevel * (1 - sys * 0.6);
        if (snow) { ctx.beginPath(); ctx.arc(s.x, s.y, 1.4, 0, 7); ctx.fill(); } else { ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - s.len * 0.22, s.y + s.len); ctx.stroke(); }
      }
    }
    ctx.globalAlpha = 1;
    scheduleFrame();
  }

  // заявка: каждое поле проверяется само и говорит, что не так; форма ничего не отправляет
  // меню разделов на узких экранах: открывается поверх страницы, по пункту летим к разделу и закрываем
  const menu = document.getElementById('menu'), menuBtn = document.getElementById('menuBtn');
  const setMenu = (open) => {
    menuOpen = open; if (open) pauseFrame(); else { last = performance.now(); scheduleFrame(); }
    menuBtn.setAttribute('aria-expanded', String(open)); menuBtn.setAttribute('aria-label', open ? 'Закрыть разделы' : 'Разделы');
    const br = menuBtn.getBoundingClientRect(); menu.style.setProperty('--mx', `${br.left + br.width / 2}px`); menu.style.setProperty('--my', `${br.top + br.height / 2}px`);   // круг раскрывается из самой кнопки
    if (open) { menu.hidden = false; requestAnimationFrame(() => menu.classList.add('is-open')); document.documentElement.style.overflow = 'hidden'; menu.focus({ preventScroll: true }); }   // фокус на само меню: Tab дальше идёт по пунктам, а рамка не вспыхивает на первом
    else { menu.classList.remove('is-open'); document.documentElement.style.overflow = ''; setTimeout(() => { if (!menu.classList.contains('is-open')) menu.hidden = true; }, 620); }
  };
  menuBtn.addEventListener('click', () => setMenu(menu.hidden));
  menu.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => setMenu(false), true));
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) { setMenu(false); menuBtn.focus(); } });
  const lead = document.getElementById('leadForm'), leadMsg = document.getElementById('leadMsg'), leadBtn = document.getElementById('leadBtn');
  const digits = (v) => v.replace(/\D/g, '');
  // тексты ошибок — как в форме на goulash.tech (их Contact Form 7), без точки в конце
  const NEED = 'Важно заполнить это поле', LONG = 'В это поле вставлен слишком большой объем данных';
  const RULES = {
    name: (v) => !v.trim() ? NEED : v.length > 400 ? LONG : '',
    phone: (v) => { const d = digits(v); return !d || d === '7' ? NEED : d.length !== 11 ? 'Введите номер телефона' : ''; },
    city: (v) => !v.trim() ? NEED : v.length > 400 ? LONG : '',
    points: (v) => !v.trim() ? NEED : !/^\d{1,5}$/.test(v.trim()) || +v < 1 ? 'Введите число' : '',
    brand: (v) => !v.trim() ? NEED : v.length > 400 ? LONG : '',
    agree: (v, el) => el.checked ? '' : NEED,
  };
  ['name', 'city'].forEach((n) => lead[n].addEventListener('input', () => { const v = lead[n].value.replace(/[^А-Яа-яЁёA-Za-z\s-]/g, ''); if (v !== lead[n].value) lead[n].value = v; }));   // как у них: в имени и городе только буквы, пробел и дефис
  lead.points.addEventListener('input', () => { const v = lead.points.value.replace(/\D/g, '').slice(0, 5); if (v !== lead.points.value) lead.points.value = v; });
  const check = (el) => { const msg = RULES[el.name](el.value, el), out = document.getElementById('e-' + el.name); el.setAttribute('aria-invalid', String(!!msg)); out.textContent = msg; out.hidden = !msg; return !msg; };
  lead.phone.addEventListener('input', () => {             // телефон собирается в привычный вид по мере ввода
    let d = digits(lead.phone.value); if (d[0] === '8') d = '7' + d.slice(1); if (d && d[0] !== '7') d = '7' + d; d = d.slice(0, 11);
    lead.phone.value = d ? '+7' + (d.length > 1 ? ' ' + d.slice(1, 4) : '') + (d.length > 4 ? ' ' + d.slice(4, 7) : '') + (d.length > 7 ? '-' + d.slice(7, 9) : '') + (d.length > 9 ? '-' + d.slice(9, 11) : '') : '';
  });
  Object.keys(RULES).forEach((name) => { const el = lead[name];
    el.addEventListener(el.type === 'checkbox' ? 'change' : 'blur', () => check(el));
    el.addEventListener('input', () => { if (el.getAttribute('aria-invalid') === 'true') check(el); }); });
  lead.addEventListener('submit', (e) => {
    e.preventDefault(); leadMsg.hidden = true;
    const bad = Object.keys(RULES).map((n) => lead[n]).filter((el) => !check(el));
    if (bad.length) { bad[0].focus(); return; }
    leadBtn.disabled = true; leadBtn.classList.add('is-loading'); lead.setAttribute('aria-busy', 'true');   // загрузка: на кнопке крутится лоадер
    setTimeout(() => {                                     // имитация отправки
      leadBtn.disabled = false; leadBtn.classList.remove('is-loading'); lead.removeAttribute('aria-busy');
      if (new URLSearchParams(location.search).has('fail')) { leadMsg.textContent = 'При отправке сообщения произошла ошибка. Пожалуйста, попробуйте еще раз позже'; leadMsg.hidden = false; leadBtn.focus(); return; }
      const done = document.getElementById('leadDone'); document.getElementById('leadFields').style.display = 'none'; done.hidden = false; done.focus({ preventScroll: true });
      setTimeout(() => {                                   // как у них: через пять секунд форма возвращается пустой
        lead.reset(); lead.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid')); lead.querySelectorAll('.err').forEach((el) => { el.hidden = true; });
        done.hidden = true; document.getElementById('leadFields').style.display = 'contents';
      }, 5000);
    }, 1100);
  });
  const form = document.getElementById('f'), foldBtn = document.getElementById('fold');
  foldBtn.addEventListener('click', () => { const f = folded = form.classList.toggle('is-folded'); foldBtn.setAttribute('aria-expanded', String(!f)); foldBtn.setAttribute('aria-label', f ? 'Развернуть пульт' : 'Свернуть пульт'); });
  form.addEventListener('input', () => { state.weather = new FormData(form).get('weather'); state.rate = +form.rate.value; state.bonus = form.bonus.checked; state.weatherPay = form.weatherPay.checked; apply(); });
  form.addEventListener('reset', () => setTimeout(() => form.dispatchEvent(new Event('input'))));
  form.addEventListener('submit', (e) => e.preventDefault());
  addEventListener('pointermove', (e) => { if (e.pointerType === 'touch') return; tmx = e.clientX; tmy = e.clientY; if (!hasMouse) { mx = tmx; my = tmy; hasMouse = true; } });
  document.addEventListener('pointerleave', () => { hasMouse = false; });
  // доводка: начал крутить — страница сама плавно доезжает до ближайшей главы
  let lastY = window.scrollY, dir = 1, idle = 0, gliding = 0;
  let glideIdx = -1, glideFrom = -1, gk = 0, swipeSettling = false;
  const inGlide = () => gliding && glideIdx >= 0 && glideFrom >= 0 && glideIdx !== glideFrom;
  // в перелёте по шапке все эффекты видят только две главы — откуда и куда летим — и плавно перетекают между ними; главы по пути не вспыхивают
  function near(i, p) { return inGlide() ? (i === glideFrom ? 1 - gk : i === glideIdx ? gk : 0) : smooth(1 - Math.abs(p - i) * 2.2); }                                   // глава, к которой летим по ссылке: сцены по пути не собираются
  function glideTo(y) {
    cancelAnimationFrame(gliding); gliding = 0; swipeSettling = false; glideIdx = glideFrom = -1; gk = 0;
    const from = window.scrollY, dist = y - from, t0 = performance.now();
    if (Math.abs(dist) < 2) return;
    glideIdx = chapterTops.findIndex((top) => Math.abs(top - y) < 4); glideFrom = Math.round(scrollPos);
    const p0 = scrollPos, steps = glideIdx >= 0 ? Math.abs(glideIdx - p0) : Math.abs(dist) / (h * 2.2), dur = clamp(800 + 520 * Math.max(0, steps - 1), 800, 2200);   // одна глава — 0,8 с, каждая следующая добавляет полсекунды
    const tick = (now) => {
      const t = clamp((now - t0) / dur, 0, 1), e = 0.5 - 0.5 * Math.cos(Math.PI * t);   // синусоида: мягкий разгон и торможение, без рывка в середине
      window.scrollTo(0, from + dist * e);
      if (glideIdx >= 0) scrollTarget = mix(p0, glideIdx, e);   // камера летит ровно, без остановок на промежуточных главах
      if (t < 1) gliding = requestAnimationFrame(tick); else { gliding = 0; glideIdx = -1; glideFrom = -1; gk = 0; readScroll(); }
    };
    gliding = requestAnimationFrame(tick);
  }
  function settle() {
    if (reduced || gliding || finger) return;                       // пока палец на экране, не тянем: доводка начнётся, когда кончится инерция
    const y = window.scrollY, tops = chapterTops;
    let i = 0; while (i < tops.length - 1 && y >= tops[i + 1]) i++;
    if (i === tops.length - 1) return;                              // последняя глава крутится свободно
    const k = (y - tops[i]) / (tops[i + 1] - tops[i]);
    if (k < 0.02) return;
    glideTo(dir > 0 ? (k > 0.04 ? tops[i + 1] : tops[i]) : (k < 0.96 ? tops[i] : tops[i + 1]));
  }
  document.querySelectorAll('a[href^="#"]').forEach((el) => el.addEventListener('click', (e) => { const t = document.querySelector(el.getAttribute('href')); if (!t) return; e.preventDefault(); if (reduced) window.scrollTo(0, t.offsetTop); else glideTo(t.offsetTop); }));
  // На телефоне вертикальный жест и его доводка — одно движение, без ожидания нативной инерции.
  // Меню, поля, ползунки, масштабирование двумя пальцами и низ последней главы остаются нативными.
  let finger = false, gesture = null;
  const stopGlide = () => { if (!gliding) return; cancelAnimationFrame(gliding); gliding = 0; swipeSettling = false; glideIdx = -1; glideFrom = -1; gk = 0; readScroll(); };
  function settleSwipe(speed) {
    const y = window.scrollY, tops = chapterTops;
    let i = 0; while (i < tops.length - 1 && y >= tops[i + 1]) i++;
    if (i === tops.length - 1 && speed >= 0) return;
    const next = Math.min(i + 1, tops.length - 1), span = tops[next] - tops[i];
    if (!span) return;
    const k = (y - tops[i]) / span, forward = Math.abs(speed) > 0.08 ? speed > 0 : dir > 0;
    const flick = Math.abs(speed) > 0.25;
    const idx = forward ? (k > 0.04 || flick ? next : i) : (k < 0.96 || flick ? i : next);
    const dist = tops[idx] - y, p0 = scrollPos, dp = idx - p0;
    if (Math.abs(dist) < 1 && Math.abs(dp) < 0.001) return;
    clearTimeout(idle); cancelAnimationFrame(gliding);
    glideIdx = glideFrom = -1; swipeSettling = true;
    const t0 = performance.now(), dur = clamp(460 + Math.abs(dp) * 160, 460, 800);
    // Кубическая кривая с начальной скоростью: после отпускания нет второго разгона с нуля.
    const slope = dist ? clamp(speed * dur / dist, 1, 3) : 1;
    const curve = (t) => ((slope - 2) * t + 3 - 2 * slope) * t * t + slope * t;
    const tick = (now) => {
      const t = clamp((now - t0) / dur, 0, 1), e = curve(t);
      window.scrollTo(0, y + dist * e); scrollTarget = mix(p0, idx, e);
      if (t < 1) gliding = requestAnimationFrame(tick);
      else { scrollPos = scrollTarget = idx; vel = 0; gliding = 0; swipeSettling = false; readScroll(); }
    };
    gliding = requestAnimationFrame(tick);
  }
  addEventListener('touchstart', (e) => {
    stopGlide(); clearTimeout(idle); finger = true; gesture = null;
    if (!touch || reduced || e.touches.length !== 1 || (window.visualViewport && window.visualViewport.scale !== 1) || document.body.classList.contains('pin') || SHOT !== null || !menu.hidden || e.target.closest('input, textarea, select, button, label, [contenteditable]')) return;
    const t = e.touches[0], now = performance.now();
    gesture = { id: t.identifier, x: t.clientX, y: t.clientY, scroll: window.scrollY, mode: '', samples: [{ y: t.clientY, time: now }] };
  }, { passive: true });
  addEventListener('touchmove', (e) => {
    if (!gesture) return;
    if (e.touches.length !== 1 || (window.visualViewport && window.visualViewport.scale !== 1)) { gesture = null; return; }
    const t = e.touches[0], g = gesture;
    if (t.identifier !== g.id || g.mode === 'native') return;
    const dx = t.clientX - g.x, dy = g.y - t.clientY;
    if (!g.mode) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 6) return;
      if (Math.abs(dy) <= Math.abs(dx) || (g.scroll >= chapterTops[chapterTops.length - 1] && dy > 0)) { g.mode = 'native'; return; }
      g.mode = 'page';
    }
    if (!e.cancelable) { g.mode = 'native'; return; }
    e.preventDefault();
    window.scrollTo(0, g.scroll + dy); readScroll();
    const now = performance.now(); g.samples.push({ y: t.clientY, time: now });
    while (g.samples.length > 2 && now - g.samples[0].time > 100) g.samples.shift();
    if (dy) dir = dy > 0 ? 1 : -1;
  }, { passive: false });
  addEventListener('touchend', (e) => {
    finger = e.touches.length > 0;
    if (finger) return;
    clearTimeout(idle); const g = gesture; gesture = null;
    if (g && g.mode === 'page') {
      const first = g.samples[0], last = g.samples[g.samples.length - 1], elapsed = performance.now() - last.time;
      const speed = elapsed < 100 ? (first.y - last.y) / Math.max(1, last.time - first.time) : 0;
      settleSwipe(speed);
    } else idle = setTimeout(settle, 220);
  }, { passive: true });
  addEventListener('touchcancel', (e) => { finger = e.touches.length > 0; gesture = null; clearTimeout(idle); if (!finger) idle = setTimeout(settle, 220); }, { passive: true });
  addEventListener('wheel', stopGlide, { passive: true }); addEventListener('keydown', stopGlide);
  addEventListener('scroll', () => {
    const y = window.scrollY; if (y !== lastY) dir = y > lastY ? 1 : -1; lastY = y;
    readScroll(); clearTimeout(idle); if (!gliding && !finger) idle = setTimeout(settle, touch ? 220 : 130);
  }, { passive: true });
  addEventListener('resize', () => { if (resize()) { measureChapters(); readScroll(); } });
  document.fonts.ready.then(measureChapters);
  resize(); measureChapters(); apply(); rollStats(true); zone = zoneTarget; radiiTarget.set(zoneShape(zone)); radii.set(radiiTarget);
  for (let i = 0; i < backlog; i++) spawn(Math.random() * 14);
  readScroll(); scrollPos = scrollTarget; applyChapters(); document.body.classList.add('flow-ready');
  { const pin = new URLSearchParams(location.search).get('pin'), idx = chapters.findIndex((c) => c.id === pin); if (idx >= 0) { document.body.classList.add('pin'); intro = 1; scrollTarget = scrollPos = idx; readScroll = () => {}; applyChapters(); } }   // ?pin=console показывает одну главу без прокрутки — для снимков
  if (SHOT !== null) { document.body.classList.add('shot'); intro = 1; scrollTarget = scrollPos = +SHOT; readScroll = () => {}; demoT = 4.4; for (let i = 0; i < 900; i++) { agents.forEach((a) => step(a, 0.033)); } flashes.length = 0; }
  if (new URLSearchParams(location.search).has('debug')) {   // ?debug — частота кадров и состояние сцены, для проверки на телефоне
    const box = document.createElement('div'); box.style.cssText = 'position:fixed;z-index:20;left:8px;bottom:8px;padding:6px 8px;border-radius:8px;background:#000c;color:#0ff;font:12px/16px monospace;white-space:pre;pointer-events:none';
    document.body.appendChild(box); let n = 0, t0 = performance.now();
    const tick = (now) => { n++; if (now - t0 > 500) { box.textContent = `${Math.round(n * 1000 / (now - t0))} fps  dpr ${devicePixelRatio}\nглава ${scrollPos.toFixed(2)}  сцена ${morphK.toFixed(2)}`; n = 0; t0 = now; } requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }
  if (new URLSearchParams(location.search).has('grain')) {   // ?grain — пульт портрета в «Кейсах»: крутить и скопировать значения
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;z-index:20;right:16px;top:84px;display:grid;gap:8px;width:260px;max-height:calc(100vh - 100px);overflow-y:auto;padding:12px;border-radius:12px;background:#000;box-shadow:0 0 0 1px rgba(255,255,255,.1);font:13px/18px var(--font-family-base);color:rgba(255,255,255,.6)';
    const KNOBS = [['pic', 'Картинка под зёрнами', 0, 1, 0.05], ['n', 'Число зёрен', 10000, 260000, 2000], ['dot', 'Размер зерна', 0.3, 2.5, 0.05], ['gamma', 'Контраст', 0.6, 3.5, 0.1], ['floor', 'Яркость тёмных зёрен', 0, 0.8, 0.02], ['jitter', 'Дрожание', 0, 30, 1], ['shimmer', 'Мерцание', 0, 0.5, 0.02], ['band', 'Полоса света', 0, 1, 0.05], ['speed', 'Скорость полосы', 0, 0.5, 0.01], ['reach', 'Курсор: радиус', 0, 0.3, 0.01], ['push', 'Курсор: сила', 0, 15, 0.5], ['dust', 'Россыпь: сколько', 0, 12000, 200], ['far', 'Россыпь: как далеко', 0.2, 2.5, 0.1]];
    const REGRAIN = ['n', 'gamma', 'dust', 'far']; let t = 0;
    for (const [k, name, min, max, step] of KNOBS) {
      const l = document.createElement('label'), out = document.createElement('output'), i = document.createElement('input');
      l.style.cssText = 'display:grid;grid-template-columns:1fr auto;gap:2px 8px'; out.style.color = '#fff'; i.style.gridColumn = '1 / -1';
      i.type = 'range'; i.min = min; i.max = max; i.step = step; i.value = GP[k]; out.textContent = GP[k];
      i.oninput = () => { GP[k] = +i.value; out.textContent = i.value; if (REGRAIN.includes(k)) { clearTimeout(t); t = setTimeout(() => fields[3] && fields[3].regrain && fields[3].regrain(), 150); } };
      l.append(name, out, i); box.appendChild(l);
    }
    const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'Скопировать значения';
    copy.style.cssText = 'margin-top:4px;padding:10px;border:0;border-radius:8px;background:#fff;color:#000;font:inherit;cursor:pointer';
    const shown = document.createElement('textarea'); shown.readOnly = true; shown.rows = 4; shown.hidden = true;   // значения видны текстом: на iPhone буфер обмена иногда не срабатывает
    shown.style.cssText = 'width:100%;padding:8px;border:0;border-radius:8px;background:#111;color:#fff;font:12px/16px monospace;resize:none';
    copy.onclick = async () => {
      const v = JSON.stringify(Object.fromEntries(KNOBS.map(([k]) => [k, GP[k]])));
      shown.value = v; shown.hidden = false; shown.focus(); shown.select();
      let ok = false; try { await navigator.clipboard.writeText(v); ok = true; } catch (e) { ok = document.execCommand && document.execCommand('copy'); }
      copy.textContent = ok ? 'Скопировано' : 'Выдели текст ниже и скопируй'; setTimeout(() => { copy.textContent = 'Скопировать значения'; }, 2500);
    };
    box.appendChild(copy); box.appendChild(shown);
    if (innerWidth < 900) {                                // на телефоне — шторка снизу, сворачивается, чтобы видеть портрет целиком
      Object.assign(box.style, { left: '8px', right: '8px', top: 'auto', bottom: '8px', width: 'auto', maxHeight: '42vh', paddingTop: '44px' });
      const fold = document.createElement('button'); fold.type = 'button'; fold.textContent = 'Свернуть';
      fold.style.cssText = 'position:fixed;z-index:21;right:16px;padding:8px 12px;border:0;border-radius:8px;background:#fff;color:#000;font:13px/18px var(--font-family-base);cursor:pointer';
      const place = () => { fold.style.bottom = box.style.display === 'none' ? '16px' : `calc(8px + min(42vh, ${box.scrollHeight}px) - 40px)`; };
      fold.onclick = () => { const hide = box.style.display !== 'none'; box.style.display = hide ? 'none' : 'grid'; fold.textContent = hide ? 'Пульт' : 'Свернуть'; place(); };
      document.body.appendChild(box); document.body.appendChild(fold); place();
    } else document.body.appendChild(box);
  }
  scheduleFrame();
})();
