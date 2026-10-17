/* Живая карта смены на фоне страницы: улицы, кухня, заказы, курьеры, погода.
   Это иллюстрация к пульту, а не расчёт: все движения условные.
   ShiftMap.set({ couriers, time, weather }) — задать состояние из пульта.
   ShiftMap.subscribe(fn) — получать число ждущих заказов. */
(function (root) {
  const canvas = document.getElementById('map');
  if (!canvas) { root.ShiftMap = { set() {}, subscribe() {} }; return; }

  const ctx = canvas.getContext('2d');
  const css = getComputedStyle(document.documentElement);
  const CYAN = css.getPropertyValue('--cyan-500').trim() || '#00ffff';
  const WHITE = css.getPropertyValue('--white').trim() || '#ffffff';
  const BLACK = css.getPropertyValue('--black').trim() || '#000000';
  const FONT = css.getPropertyValue('--font-family-base').trim() || 'sans-serif';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const ANGLE = -0.16;      // наклон карты, рад
  const SPEED = 150;        // скорость курьера, px/с
  const TOTAL = 14;         // курьеров в штате

  let w = 0, h = 0, cx = 0, cy = 0, pad = 0;
  let xs = [], ys = [], blocks = [], nodes = [], base = null, river = null;
  let orders = [], flashes = [], agents = [], streaks = [];
  let active = 6, backlog = 27, waitLabel = 74, weather = 'rain', weatherLevel = 1;
  let raf = 0, last = 0, spawnTimer = 0, notifyTimer = 0;
  const listeners = [];

  const lcg = (seed) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const rotate = (x, y, a) => {
    const dx = x - cx, dy = y - cy, c = Math.cos(a), s = Math.sin(a);
    return [cx + dx * c - dy * s, cy + dx * s + dy * c];
  };
  const toScreen = (x, y) => rotate(x, y, ANGLE);
  const toMap = (x, y) => rotate(x, y, -ANGLE);

  function newStreak(anywhere) {
    return {
      x: Math.random() * (w + 300) - 100,
      y: anywhere ? Math.random() * h : -40,
      len: 14 + Math.random() * 26,
      speed: 700 + Math.random() * 600,
      alpha: 0.04 + Math.random() * 0.1,
      drift: Math.random() * 40 - 20,
    };
  }

  function build() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth; h = canvas.clientHeight;
    if (!w || !h) return false;
    canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    cx = w / 2; cy = h / 2; pad = Math.max(w, h) * 0.32;

    const rnd = lcg(11);
    xs = []; for (let x = -pad; x < w + pad; x += 58 + rnd() * 70) xs.push({ p: x, a: 0.07 + rnd() * 0.09, wide: rnd() < 0.15 });
    ys = []; for (let y = -pad; y < h + pad; y += 50 + rnd() * 62) ys.push({ p: y, a: 0.07 + rnd() * 0.09, wide: rnd() < 0.15 });
    blocks = [];
    for (let i = 0; i < xs.length - 1; i++) {
      for (let j = 0; j < ys.length - 1; j++) {
        if (rnd() < 0.22) blocks.push([xs[i].p + 5, ys[j].p + 5, xs[i + 1].p - xs[i].p - 10, ys[j + 1].p - ys[j].p - 10]);
      }
    }

    // зона, где видна «жизнь»: справа на широком экране, снизу на узком
    const wide = w >= 900;
    const zone = wide ? [w * 0.44, 110, w - 36, h - 130] : [16, h * 0.5, w - 16, h - 96];
    nodes = [];
    for (const x of xs) for (const y of ys) {
      const [sx, sy] = toScreen(x.p, y.p);
      if (sx > zone[0] && sx < zone[2] && sy > zone[1] && sy < zone[3]) nodes.push({ x: x.p, y: y.p });
    }
    const [tx, ty] = toMap(zone[0] + (zone[2] - zone[0]) * 0.55, zone[1] + (zone[3] - zone[1]) * 0.5);
    base = nodes.reduce((best, n) => (Math.hypot(n.x - tx, n.y - ty) < Math.hypot(best.x - tx, best.y - ty) ? n : best), nodes[0]);
    nodes = nodes.filter((n) => n !== base && Math.hypot(n.x - base.x, n.y - base.y) > 70);

    const [rx0, ry0] = toMap(zone[0] + (zone[2] - zone[0]) * 0.86, -pad * 0.4);
    const [rx1, ry1] = toMap(zone[0] + (zone[2] - zone[0]) * 0.2, h * 0.55);
    const [rx2, ry2] = toMap(zone[0] + (zone[2] - zone[0]) * 0.62, h + pad * 0.4);
    river = [rx0, ry0, rx1, ry1, rx2, ry2];

    streaks = Array.from({ length: Math.round(w / 20) }, () => newStreak(true));
    orders = []; flashes = [];
    agents = Array.from({ length: TOTAL }, (_, i) => ({ i, on: false, leaving: false, x: base.x, y: base.y, path: null, leg: 0, state: 'idle', order: null, trail: [] }));
    while (orders.length < backlog && orders.length < nodes.length) spawn(Math.random() * 14);
    applyActive(true);
    return true;
  }

  function spawn(age) {
    for (let tries = 0; tries < 12; tries++) {
      const n = nodes[Math.floor(Math.random() * nodes.length)];
      if (!n || orders.some((o) => o.x === n.x && o.y === n.y)) continue;
      orders.push({ x: n.x, y: n.y, age, taken: false });
      return;
    }
  }

  function applyActive(instant) {
    agents.forEach((a) => {
      if (a.i < active) {
        if (!a.on) { a.on = true; a.x = base.x; a.y = base.y; a.path = null; a.state = 'idle'; a.trail = []; }
        a.leaving = false;
        if (instant) a.wait = Math.random() * 1.5;
      } else if (a.on) {
        a.leaving = true;
      }
    });
  }

  const route = (from, to) => (Math.random() < 0.5 ? [{ x: to.x, y: from.y }, { x: to.x, y: to.y }] : [{ x: from.x, y: to.y }, { x: to.x, y: to.y }]);

  function assign(a) {
    let pick = null;
    for (const o of orders) if (!o.taken && (!pick || o.age > pick.age)) pick = o;
    if (!pick) return false;
    pick.taken = true; a.order = pick; a.path = route(a, pick); a.leg = 0; a.state = 'go';
    return true;
  }

  function arrive(a) {
    if (a.state === 'go') {
      const o = a.order;
      orders.splice(orders.indexOf(o), 1);
      flashes.push({ x: o.x, y: o.y, t: 0 });
      a.order = null; a.state = 'back'; a.path = route(a, base); a.leg = 0;
    } else {
      a.path = null; a.state = 'idle';
      if (a.leaving) { a.on = false; a.leaving = false; a.trail = []; }
    }
  }

  function step(a, dt) {
    if (!a.on) return;
    if (a.wait > 0) { a.wait -= dt; return; }
    if (!a.path) {
      if (a.leaving) { a.on = false; a.leaving = false; a.trail = []; return; }
      if (!assign(a)) return;
    }
    let move = SPEED * dt;
    while (move > 0 && a.path) {
      const t = a.path[a.leg];
      const dx = t.x - a.x, dy = t.y - a.y, d = Math.hypot(dx, dy);
      if (d <= move) { a.x = t.x; a.y = t.y; move -= d; a.leg++; if (a.leg >= a.path.length) arrive(a); }
      else { a.x += (dx / d) * move; a.y += (dy / d) * move; move = 0; }
    }
    a.trail.push([a.x, a.y]);
    if (a.trail.length > 26) a.trail.shift();
  }

  function update(dt) {
    for (const o of orders) o.age += dt;
    spawnTimer -= dt;
    if (orders.length < backlog && spawnTimer <= 0) { spawn(0); spawnTimer = 0.3 + Math.random() * 0.45; }
    for (const a of agents) step(a, dt);
    for (const f of flashes) f.t += dt;
    flashes = flashes.filter((f) => f.t < 0.6);
    weatherLevel += ((weather === 'clear' ? 0 : 1) - weatherLevel) * Math.min(1, dt * 2.5);
    for (const s of streaks) {
      const k = weather === 'snow' ? 0.12 : 1;
      s.y += s.speed * k * dt; s.x -= s.speed * k * 0.22 * dt + (weather === 'snow' ? s.drift * dt : 0);
      if (s.y > h + 40) Object.assign(s, newStreak(false));
    }
    notifyTimer -= dt;
    if (notifyTimer <= 0) { notifyTimer = 0.25; notify(); }
  }

  function notify() {
    const waiting = orders.filter((o) => !o.taken).length;
    listeners.forEach((fn) => fn({ waiting }));
  }

  function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); }

  function draw() {
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(ANGLE); ctx.translate(-cx, -cy);

    // кварталы и река
    ctx.fillStyle = WHITE; ctx.globalAlpha = 0.028;
    for (const b of blocks) ctx.fillRect(b[0], b[1], b[2], b[3]);
    ctx.strokeStyle = BLACK; ctx.globalAlpha = 1; ctx.lineWidth = 58; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(river[0], river[1]); ctx.quadraticCurveTo(river[2], river[3], river[4], river[5]); ctx.stroke();
    ctx.strokeStyle = WHITE; ctx.globalAlpha = 0.05; ctx.lineWidth = 50;
    ctx.beginPath(); ctx.moveTo(river[0], river[1]); ctx.quadraticCurveTo(river[2], river[3], river[4], river[5]); ctx.stroke();

    // улицы
    ctx.strokeStyle = WHITE; ctx.lineCap = 'butt';
    for (const x of xs) { ctx.globalAlpha = x.a; ctx.lineWidth = x.wide ? 2 : 1; ctx.beginPath(); ctx.moveTo(x.p, -pad); ctx.lineTo(x.p, h + pad); ctx.stroke(); }
    for (const y of ys) { ctx.globalAlpha = y.a; ctx.lineWidth = y.wide ? 2 : 1; ctx.beginPath(); ctx.moveTo(-pad, y.p); ctx.lineTo(w + pad, y.p); ctx.stroke(); }

    // маршруты курьеров
    ctx.strokeStyle = CYAN; ctx.lineWidth = 1;
    for (const a of agents) {
      if (!a.on || !a.path) continue;
      ctx.globalAlpha = a.state === 'go' ? 0.32 : 0.12;
      ctx.beginPath(); ctx.moveTo(a.x, a.y);
      for (let i = a.leg; i < a.path.length; i++) ctx.lineTo(a.path[i].x, a.path[i].y);
      ctx.stroke();
    }

    // заказы
    let oldest = null;
    for (const o of orders) {
      if (!o.taken && (!oldest || o.age > oldest.age)) oldest = o;
      const phase = (o.age % 2.4) / 2.4;
      ctx.strokeStyle = o.taken ? CYAN : WHITE; ctx.lineWidth = 1;
      ctx.globalAlpha = (1 - phase) * (o.taken ? 0.5 : 0.4);
      circle(o.x, o.y, 4 + phase * 13); ctx.stroke();
      ctx.fillStyle = WHITE; ctx.globalAlpha = o.taken ? 0.55 : 0.95;
      circle(o.x, o.y, 2.4); ctx.fill();
    }
    for (const f of flashes) {
      ctx.strokeStyle = CYAN; ctx.lineWidth = 1.5; ctx.globalAlpha = 1 - f.t / 0.6;
      circle(f.x, f.y, 4 + f.t * 46); ctx.stroke();
    }

    // курьеры: след и точка
    for (const a of agents) {
      if (!a.on) continue;
      ctx.strokeStyle = CYAN; ctx.lineWidth = 2;
      for (let i = 1; i < a.trail.length; i++) {
        ctx.globalAlpha = (i / a.trail.length) * 0.7;
        ctx.beginPath(); ctx.moveTo(a.trail[i - 1][0], a.trail[i - 1][1]); ctx.lineTo(a.trail[i][0], a.trail[i][1]); ctx.stroke();
      }
      ctx.fillStyle = CYAN; ctx.globalAlpha = 1; ctx.shadowColor = CYAN; ctx.shadowBlur = 12;
      circle(a.x, a.y, 3.6); ctx.fill(); ctx.shadowBlur = 0;
    }

    // кухня
    const pulse = (performance.now() / 1000 % 3) / 3;
    ctx.strokeStyle = WHITE; ctx.lineWidth = 1; ctx.globalAlpha = (1 - pulse) * 0.35;
    circle(base.x, base.y, 12 + pulse * 30); ctx.stroke();
    ctx.globalAlpha = 1; ctx.fillStyle = BLACK; ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(base.x - 9, base.y - 9, 18, 18, 4.4); else ctx.rect(base.x - 9, base.y - 9, 18, 18);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = WHITE; circle(base.x, base.y, 2.5); ctx.fill();
    ctx.restore();

    // подписи без наклона: кухня и самый долгий заказ
    ctx.font = `400 13px ${FONT}`; ctx.textBaseline = 'middle';
    const [bx, by] = toScreen(base.x, base.y);
    ctx.fillStyle = WHITE; ctx.globalAlpha = 0.6; ctx.fillText('Кухня', bx + 18, by);
    if (oldest) {
      const [ox, oy] = toScreen(oldest.x, oldest.y);
      ctx.globalAlpha = 0.9; ctx.fillText(`ждёт ${waitLabel} мин`, ox + 12, oy - 12);
    }

    // погода
    if (weatherLevel > 0.02) {
      ctx.strokeStyle = WHITE; ctx.fillStyle = WHITE; ctx.lineWidth = 1;
      for (const s of streaks) {
        ctx.globalAlpha = s.alpha * weatherLevel;
        if (weather === 'snow') { circle(s.x, s.y, 1.4); ctx.fill(); }
        else { ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - s.len * 0.22, s.y + s.len); ctx.stroke(); }
      }
    }
    ctx.globalAlpha = 1;
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    update(dt); draw();
    raf = requestAnimationFrame(frame);
  }

  function start() {
    cancelAnimationFrame(raf);
    if (!base) return;
    if (reducedMotion || document.hidden) { draw(); notify(); return; }
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function set(next) {
    if (typeof next.time === 'number') { waitLabel = next.time; backlog = Math.max(2, Math.round((next.time - 30) * 0.62)); }
    if (next.weather) weather = next.weather;
    if (typeof next.couriers === 'number' && next.couriers !== active) { active = next.couriers; if (base) applyActive(false); }
    if (reducedMotion && base) { weatherLevel = weather === 'clear' ? 0 : 1; draw(); notify(); }
  }

  let resizeTimer = 0;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (build()) start(); }, 150); });
  document.addEventListener('visibilitychange', start);

  root.ShiftMap = { set, subscribe: (fn) => listeners.push(fn) };
  if (build()) start();
})(window);
