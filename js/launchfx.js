'use strict';
// The first rocket launch gets a full cinematic: countdown, ignition,
// liftoff, staging and a climb into space. Later launches skip it.

function playLaunchAnimation(onDone, startAt = 0) { // startAt: jump ahead (for previews)
  const wrap = document.createElement('div');
  wrap.id = 'launchFx';
  wrap.innerHTML = '<canvas></canvas><div class="lfx-text"></div><button class="lfx-skip">Skip ›</button>';
  document.body.appendChild(wrap);
  const cv = wrap.querySelector('canvas');
  const g = cv.getContext('2d');
  const label = wrap.querySelector('.lfx-text');
  let W = 0, H = 0, dpr = 1;
  const resize = () => {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = wrap.clientWidth; H = wrap.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize);

  // Scene state
  const rand = (a, b) => a + Math.random() * (b - a);
  const stars = Array.from({ length: 160 }, () => ({ x: Math.random(), y: Math.random() * 3, r: rand(0.4, 1.6), tw: Math.random() * 6 }));
  const clouds = Array.from({ length: 9 }, (_, i) => ({ x: Math.random(), alt: 0.9 + i * 0.35 + Math.random() * 0.2, w: rand(0.25, 0.5), drift: rand(-0.01, 0.01) }));
  const smoke = [], sparks = [];
  let booster = null; // falls away after staging
  let done = false, last = performance.now(), t = startAt;

  const finish = () => {
    if (done) return;
    done = true;
    window.removeEventListener('resize', resize);
    wrap.classList.add('out');
    setTimeout(() => { wrap.remove(); onDone(); }, 450);
  };
  wrap.querySelector('.lfx-skip').addEventListener('click', finish);

  // Timeline (seconds)
  const T_IGNITE = 3.2, T_LIFT = 4.4, T_STAGE = 8.6, T_END = 12.5;

  // Rocket altitude in "screens": 0 on the pad, accelerating after liftoff.
  const altitude = (s) => (s < T_LIFT ? 0 : 0.045 * Math.pow(s - T_LIFT, 2.35));

  function drawRocket(x, y, h, upperOnly, flame, groundAt) {
    const w = h * 0.16;
    g.save();
    g.translate(x, y);
    const bodyGrad = g.createLinearGradient(-w / 2, 0, w / 2, 0);
    bodyGrad.addColorStop(0, '#b9c2cc'); bodyGrad.addColorStop(0.45, '#ffffff'); bodyGrad.addColorStop(1, '#8e99a6');
    // Upper stage + capsule
    const topH = h * 0.45;
    g.fillStyle = bodyGrad;
    g.fillRect(-w / 2, -h, w, topH);
    g.fillStyle = '#e74c3c';
    g.beginPath(); g.moveTo(-w / 2, -h); g.quadraticCurveTo(0, -h - w * 1.9, w / 2, -h); g.closePath(); g.fill();
    g.fillStyle = '#2c3e50';
    g.beginPath(); g.arc(0, -h + topH * 0.35, w * 0.22, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#56ccf2'; g.lineWidth = w * 0.06; g.stroke();
    g.fillStyle = '#34495e';
    g.fillRect(-w / 2, -h + topH - w * 0.12, w, w * 0.12);
    if (!upperOnly) {
      // Booster stage
      g.fillStyle = bodyGrad;
      g.fillRect(-w / 2, -h + topH, w, h - topH);
      g.fillStyle = '#2c3e50';
      g.fillRect(-w / 2, -h * 0.32, w, h * 0.05);
      g.font = `800 ${w * 0.3}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.save(); g.translate(0, -h * 0.435); g.rotate(-Math.PI / 2); g.fillText('LIFTOFF', 0, 0); g.restore();
      // Fins
      g.fillStyle = '#c0392b';
      for (const s of [-1, 1]) {
        g.beginPath(); g.moveTo(s * w / 2, -h * 0.2); g.lineTo(s * w * 1.25, 0); g.lineTo(s * w / 2, 0); g.closePath(); g.fill();
      }
      g.fillStyle = '#4a4f57';
      g.fillRect(-w * 0.32, 0, w * 0.64, w * 0.25); // engine bell
    } else {
      g.fillStyle = '#4a4f57';
      g.fillRect(-w * 0.22, -h + topH, w * 0.44, w * 0.2);
    }
    // Flame (it disappears into the pad's flame trench while on the ground)
    if (flame > 0) {
      g.save();
      g.beginPath(); g.rect(-h * 3, -h * 5, h * 6, h * 5 + (groundAt - y)); g.clip();
      const fy = upperOnly ? -h + topH + w * 0.2 : w * 0.25;
      const len = h * (upperOnly ? 0.35 : 0.75) * flame * rand(0.88, 1.12);
      const fw = w * (upperOnly ? 0.4 : 0.62);
      const fg = g.createLinearGradient(0, fy, 0, fy + len);
      fg.addColorStop(0, 'rgba(255,255,240,1)'); fg.addColorStop(0.25, 'rgba(255,214,90,0.95)');
      fg.addColorStop(0.6, 'rgba(255,120,30,0.75)'); fg.addColorStop(1, 'rgba(255,60,20,0)');
      g.fillStyle = fg;
      g.beginPath(); g.moveTo(-fw / 2, fy); g.quadraticCurveTo(-fw * 0.7, fy + len * 0.45, 0, fy + len);
      g.quadraticCurveTo(fw * 0.7, fy + len * 0.45, fw / 2, fy); g.closePath(); g.fill();
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = 'rgba(255,200,120,0.25)';
      g.beginPath(); g.arc(0, fy + len * 0.25, fw * 1.4, 0, Math.PI * 2); g.fill();
      g.globalCompositeOperation = 'source-over';
      g.restore();
    }
    g.restore();
  }

  function frame(now) {
    if (done) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    const alt = altitude(t);
    const rocketH = Math.min(H * 0.34, W * 0.9);
    const groundY = H * 0.86;
    // Camera: the rocket climbs on screen until its base is ~70% down, then the world scrolls.
    const climbPx = alt * H;
    const rise = Math.min(climbPx, groundY - H * 0.7);
    const cam = Math.max(0, climbPx - rise); // world offset in px
    const space = Math.min(1, cam / (H * 2.2)); // 0 = blue sky, 1 = space

    // Shake during ignition and early climb.
    const shake = t > T_IGNITE && t < T_LIFT + 2.5 ? (t < T_LIFT ? (t - T_IGNITE) / (T_LIFT - T_IGNITE) : 1 - (t - T_LIFT) / 2.5) * 5 : 0;
    g.save();
    g.translate(rand(-shake, shake), rand(-shake, shake));

    // Sky
    const sky = g.createLinearGradient(0, 0, 0, H);
    const mix = (a, b) => a.map((v, i) => Math.round(v + (b[i] - v) * space));
    const top = mix([94, 160, 222], [4, 6, 18]), bot = mix([255, 190, 140], [10, 14, 34]);
    sky.addColorStop(0, `rgb(${top})`); sky.addColorStop(1, `rgb(${bot})`);
    g.fillStyle = sky;
    g.fillRect(-10, -10, W + 20, H + 20);

    // Stars fade in as we leave the atmosphere.
    if (space > 0.15) {
      g.fillStyle = '#fff';
      for (const s of stars) {
        const y = ((s.y * H + cam * 0.15) % (H * 1.2)) - H * 0.1;
        g.globalAlpha = Math.min(1, (space - 0.15) * 1.6) * (0.6 + 0.4 * Math.sin(t * 3 + s.tw));
        g.beginPath(); g.arc(s.x * W, y, s.r, 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = 1;
    }

    // Clouds pass by on the way up.
    for (const c of clouds) {
      const y = groundY - c.alt * H + cam * 0.9;
      if (y < -80 || y > H + 80) continue;
      c.x += c.drift * dt;
      g.fillStyle = `rgba(255,255,255,${0.75 * (1 - space)})`;
      const cx = c.x * W, cw = c.w * W;
      for (let i = 0; i < 4; i++) { g.beginPath(); g.ellipse(cx + (i - 1.5) * cw * 0.28, y + (i % 2) * 6, cw * 0.22, cw * 0.09, 0, 0, Math.PI * 2); g.fill(); }
    }

    // Ground, pad and tower (scroll away).
    const gy = groundY + cam;
    if (gy < H + 40) {
      g.fillStyle = '#c9a26b'; g.fillRect(-10, gy, W + 20, H);
      g.fillStyle = '#a07c4a'; g.fillRect(-10, gy, W + 20, 6);
      g.fillStyle = '#555c66'; g.fillRect(W / 2 - rocketH * 0.3, gy - 10, rocketH * 0.6, 10);
      // Tower with an arm that swings away at ignition
      const tx = W / 2 + rocketH * 0.26;
      g.strokeStyle = '#d35400'; g.lineWidth = 3;
      g.strokeRect(tx, gy - rocketH * 1.15, rocketH * 0.1, rocketH * 1.15);
      for (let i = 0; i < 8; i++) { const yy = gy - rocketH * 1.15 * (i / 8); g.beginPath(); g.moveTo(tx, yy); g.lineTo(tx + rocketH * 0.1, yy - rocketH * 0.14); g.stroke(); }
      const arm = t < T_IGNITE ? 0 : Math.min(1, (t - T_IGNITE) / 0.8);
      g.save(); g.translate(tx, gy - rocketH * 0.8); g.rotate(-arm * 1.1);
      g.fillStyle = '#d35400'; g.fillRect(-rocketH * 0.14, -3, rocketH * 0.14, 6); g.restore();
    }

    // Rocket position
    const rx = W / 2;
    const ry = groundY - 10 - rise;
    const staged = t >= T_STAGE;
    const flame = t < T_IGNITE ? 0 : Math.min(1, (t - T_IGNITE) / 0.9);

    // Smoke: billows at the pad during ignition, trails behind in flight.
    const emitY = staged ? ry - rocketH * 0.5 : ry + rocketH * 0.05;
    if (flame > 0) {
      const n = t < T_LIFT + 1.5 ? 6 : 2;
      for (let i = 0; i < n; i++) {
        const onPad = t < T_LIFT + 1.2;
        smoke.push({
          x: rx + rand(-8, 8), wy: emitY - cam, // world y: screen y = wy + cam
          vx: onPad ? rand(-140, 140) : rand(-15, 15), vy: onPad ? rand(-20, 30) : rand(20, 60),
          r: rand(10, 20), grow: onPad ? rand(30, 60) : rand(12, 24), life: 0, max: rand(2.5, 4.5),
        });
      }
      if (t < T_LIFT + 1) for (let i = 0; i < 4; i++) sparks.push({ x: rx + rand(-10, 10), y: groundY - 4, vx: rand(-220, 220), vy: rand(-180, -40), life: 0, max: rand(0.4, 0.9) });
    } else if (t < T_IGNITE) {
      // Venting cryo steam before ignition.
      if (Math.random() < 0.5) smoke.push({ x: rx + rand(-rocketH * 0.1, rocketH * 0.1), wy: ry - rocketH * rand(0.3, 0.9) - cam, vx: rand(10, 40), vy: rand(-10, 10), r: rand(4, 8), grow: rand(6, 12), life: 0, max: rand(1.2, 2), steam: true });
    }
    for (let i = smoke.length - 1; i >= 0; i--) {
      const p = smoke[i];
      p.life += dt;
      if (p.life > p.max) { smoke.splice(i, 1); continue; }
      p.x += p.vx * dt; p.wy += p.vy * dt; p.vx *= 0.985; p.r += p.grow * dt;
      const a = (1 - p.life / p.max) * (p.steam ? 0.35 : 0.55 * (1 - space * 0.75)); // thin air, thin trail
      g.fillStyle = p.steam ? `rgba(230,240,255,${a})` : `rgba(${200 - 40 * space},${200 - 40 * space},${205 - 40 * space},${a})`;
      g.beginPath(); g.arc(p.x, p.wy + cam, p.r, 0, Math.PI * 2); g.fill();
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.life += dt;
      if (s.life > s.max) { sparks.splice(i, 1); continue; }
      s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 400 * dt;
      g.fillStyle = `rgba(255,${180 + Math.random() * 60},80,${1 - s.life / s.max})`;
      g.fillRect(s.x, s.y + cam, 2.5, 2.5);
    }

    // Staging: the spent booster drops away, tumbling.
    if (staged && !booster) {
      booster = { x: rx, wy: ry - cam, vy: -60, rot: 0 }; // world y, drifting down
      label.textContent = 'Stage separation';
      label.className = 'lfx-text small show';
      setTimeout(() => { if (!done) label.className = 'lfx-text small'; }, 1400);
    }
    if (booster) {
      booster.vy += 120 * dt; booster.wy += booster.vy * dt; booster.x -= 12 * dt; booster.rot += dt * 0.9;
      g.save(); g.translate(booster.x - 14, booster.wy + cam); g.rotate(booster.rot);
      const w = rocketH * 0.16, h2 = rocketH * 0.55;
      g.fillStyle = '#c9d1d9'; g.fillRect(-w / 2, -h2, w, h2);
      g.fillStyle = '#c0392b';
      for (const s of [-1, 1]) { g.beginPath(); g.moveTo(s * w / 2, -h2 * 0.35); g.lineTo(s * w * 1.25, 0); g.lineTo(s * w / 2, 0); g.closePath(); g.fill(); }
      g.restore();
    }

    // The rocket itself, shrinking a touch as it gets far away.
    const far = Math.max(0.35, 1 - space * 0.6);
    drawRocket(rx, staged ? ry - rocketH * 0.02 : ry, rocketH * far, staged, flame, gy);

    g.restore();

    // Countdown and captions
    if (t < T_IGNITE) {
      const n = 3 - Math.floor(t / (T_IGNITE / 3));
      if (label.dataset.n !== String(n)) { label.dataset.n = String(n); label.textContent = String(n); label.className = 'lfx-text big pop'; void label.offsetWidth; label.className = 'lfx-text big pop show'; }
    } else if (t < T_LIFT && label.dataset.n !== 'ign') {
      label.dataset.n = 'ign'; label.textContent = 'Ignition'; label.className = 'lfx-text show';
    } else if (t >= T_LIFT && t < T_LIFT + 0.2 && label.dataset.n !== 'lift') {
      label.dataset.n = 'lift'; label.textContent = 'Liftoff!'; label.className = 'lfx-text show';
      setTimeout(() => { if (!done && label.dataset.n === 'lift') label.className = 'lfx-text'; }, 1500);
    }
    if (t > T_END - 2 && label.dataset.n !== 'end') {
      label.dataset.n = 'end'; label.innerHTML = '🚀 We have liftoff!<div class="lfx-sub">Your first rocket is on its way to orbit</div>'; label.className = 'lfx-text show';
    }
    if (t >= T_END) { finish(); return; }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
