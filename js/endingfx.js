'use strict';
// The ending: Mars slowly turns blue and green as the terraforming takes hold.

function playEndingAnimation(onDone, startAt = 0) { // startAt: jump ahead (for previews)
  const wrap = document.createElement('div');
  wrap.id = 'launchFx';
  wrap.innerHTML = '<canvas></canvas><div class="lfx-text"></div><button class="lfx-skip">Skip ›</button>';
  document.body.appendChild(wrap);
  const cv = wrap.querySelector('canvas');
  const g = cv.getContext('2d');
  const label = wrap.querySelector('.lfx-text');
  let W = 0, H = 0;
  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = wrap.clientWidth; H = wrap.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize);

  // Fixed random features so the planet looks the same every frame.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const stars = Array.from({ length: 200 }, () => ({ x: rnd(), y: rnd(), r: 0.3 + rnd() * 1.4, tw: rnd() * 6 }));
  const land = Array.from({ length: 14 }, () => ({ a: rnd() * Math.PI * 2, d: rnd() * 0.75, r: 0.12 + rnd() * 0.22 }));
  const craters = Array.from({ length: 22 }, () => ({ a: rnd() * Math.PI * 2, d: rnd() * 0.85, r: 0.02 + rnd() * 0.06 }));
  const clouds = Array.from({ length: 9 }, () => ({ a: rnd() * Math.PI * 2, d: 0.2 + rnd() * 0.7, w: 0.2 + rnd() * 0.35 }));
  const cities = Array.from({ length: 60 }, () => ({ a: rnd() * Math.PI * 2, d: rnd() * 0.85 }));

  const T = 13;
  const captions = [[0.5, 'Atmosphere thickening…'], [4.2, 'Oceans returning…'], [8, 'Mars is alive.']];
  let shown = -1, t = startAt, last = performance.now(), done = false;
  const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
  const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  const finish = () => {
    if (done) return;
    done = true;
    window.removeEventListener('resize', resize);
    wrap.classList.add('out');
    setTimeout(() => { wrap.remove(); onDone(); }, 450);
  };
  wrap.querySelector('.lfx-skip').addEventListener('click', finish);

  function frame(now) {
    if (done) return;
    t += Math.min(0.05, (now - last) / 1000);
    last = now;
    const k = Math.min(1, t / 9); // terraforming progress
    const ease = k * k * (3 - 2 * k);
    g.fillStyle = '#04060f';
    g.fillRect(0, 0, W, H);
    for (const s of stars) {
      g.globalAlpha = 0.5 + 0.5 * Math.sin(t * 2 + s.tw);
      g.fillStyle = '#fff';
      g.beginPath(); g.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    const R = Math.min(W, H) * 0.29, cx = W / 2, cy = H * 0.58;
    const spin = t * 0.05;
    // Atmosphere glow grows with the air.
    const glow = g.createRadialGradient(cx, cy, R * 0.95, cx, cy, R * (1.08 + 0.12 * ease));
    glow.addColorStop(0, rgb(mix([230, 120, 80], [120, 190, 255], ease), 0.25 + 0.35 * ease));
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = glow;
    g.beginPath(); g.arc(cx, cy, R * 1.25, 0, Math.PI * 2); g.fill();
    g.save();
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.clip();
    // Ocean replaces dust.
    g.fillStyle = rgb(mix([186, 84, 46], [32, 96, 168], ease));
    g.fillRect(cx - R, cy - R, R * 2, R * 2);
    const at = (a, d) => [cx + Math.cos(a + spin) * d * R, cy + Math.sin(a + spin) * d * R * 0.9];
    for (const c of craters) {
      const [x, y] = at(c.a, c.d);
      g.fillStyle = rgb([120, 50, 30], 0.35 * (1 - ease));
      g.beginPath(); g.arc(x, y, c.r * R, 0, Math.PI * 2); g.fill();
    }
    // Land masses: rust to green.
    for (const l of land) {
      const [x, y] = at(l.a, l.d);
      g.fillStyle = rgb(mix([196, 104, 60], [70, 150, 80], Math.max(0, ease * 1.2 - 0.1)), 0.9);
      g.beginPath(); g.ellipse(x, y, l.r * R, l.r * R * 0.7, l.a, 0, Math.PI * 2); g.fill();
    }
    // Clouds drift in once there's air.
    if (ease > 0.35) {
      for (const c of clouds) {
        const [x, y] = at(c.a + t * 0.08, c.d);
        g.fillStyle = `rgba(255,255,255,${0.55 * Math.min(1, (ease - 0.35) * 2)})`;
        g.beginPath(); g.ellipse(x, y, c.w * R * 0.5, c.w * R * 0.12, 0.3, 0, Math.PI * 2); g.fill();
      }
    }
    // Night side, then colony lights coming on.
    const shade = g.createLinearGradient(cx - R, 0, cx + R, 0);
    shade.addColorStop(0.55, 'rgba(0,0,0,0)');
    shade.addColorStop(1, 'rgba(0,0,10,0.7)');
    g.fillStyle = shade;
    g.fillRect(cx - R, cy - R, R * 2, R * 2);
    if (t > 8) {
      for (const c of cities) {
        const [x, y] = at(c.a, c.d);
        if (x < cx + R * 0.15) continue;
        g.fillStyle = `rgba(255,214,120,${Math.min(1, (t - 8) / 2) * (0.6 + 0.4 * Math.sin(t * 4 + c.a * 9))})`;
        g.fillRect(x, y, 2, 2);
      }
    }
    g.restore();
    const cap = captions.filter(([at]) => t >= at).length - 1;
    if (cap !== shown) {
      shown = cap;
      label.innerHTML = cap === 2 ? '🌍 Mars is alive.<div class="lfx-sub">Project Terraform is complete</div>' : captions[cap][1];
      label.className = 'lfx-text ' + (cap === 2 ? '' : 'small') + ' show';
    }
    if (t >= T) { finish(); return; }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
