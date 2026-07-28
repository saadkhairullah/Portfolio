// fx.js — shared page effects: ENet hexdump drift, cursor glow, page-wipe, 3D tilt, text scramble, magnetic buttons, icon fallback
(() => {
  const ACCENT = '#aef23a';
  // Drifting ENet packet hexdump. Rows are synthesized from real ENet protocol
  // command layouts (RFC-less but well documented): 4-byte peerID/flags header,
  // then per-command headers (type, channel, reliableSequenceNumber, ...).
  const ENET_CMDS = [
    { name: 'ACKNOWLEDGE', t: 0x01 }, { name: 'CONNECT', t: 0x02 },
    { name: 'VERIFY_CONNECT', t: 0x03 }, { name: 'DISCONNECT', t: 0x04 },
    { name: 'PING', t: 0x05 }, { name: 'SEND_RELIABLE', t: 0x06 },
    { name: 'SEND_UNRELIABLE', t: 0x07 }, { name: 'SEND_FRAGMENT', t: 0x08 },
  ];
  function enetRow(seed) {
    // deterministic pseudo-random so rows are stable while drifting
    let s = seed * 2654435761 % 2147483647;
    const rnd = () => (s = s * 16807 % 2147483647) / 2147483647;
    const cmd = ENET_CMDS[(rnd() * ENET_CMDS.length) | 0];
    const bytes = [];
    // ENet protocol header: peer id (2), sent time (2)
    bytes.push(0x00, (rnd() * 0x40) | 0, (rnd() * 256) | 0, (rnd() * 256) | 0);
    // command header: type, channelID, reliableSequenceNumber (2)
    bytes.push(cmd.t, (rnd() * 4) | 0, 0x00, ((seed % 250) + 1));
    while (bytes.length < 16) bytes.push((rnd() * 256) | 0);
    const off = ((seed * 16) % 0x10000).toString(16).padStart(8, '0');
    const hex = bytes.map((b) => b.toString(16).padStart(2, '0'));
    const hexStr = hex.slice(0, 8).join(' ') + '  ' + hex.slice(8).join(' ');
    const ascii = bytes.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
    return { off, hexStr, ascii, cmd: cmd.name };
  }

  function initRain(cv) {
    if (cv.dataset.rainInit) return;
    cv.dataset.rainInit = '1';
    const ctx = cv.getContext('2d');
    const fs = 11.5, lh = 17, SPEED = 0.28;
    let rows = [], last = 0, offscreen = false, tick = 0;
    // Fade window measured from real content, not guessed from canvas height:
    // ink peaks halfway up the empty band and reaches zero before the first
    // piece of text that sits over this canvas.
    let fadeEnd = 100, fadePeak = 50, fadeSigma = 32;
    const measureWindow = () => {
      const host = cv.parentElement;
      if (!host) return;
      const top = cv.getBoundingClientRect().top;
      const H = cv.height || cv.offsetHeight || 420;
      let first = Infinity;
      host.querySelectorAll('*').forEach((el) => {
        if (el === cv || el.tagName === 'CANVAS' || el.closest('header')) return;
        // Own text only — tag-agnostic, so styled DIVs count as content.
        let own = '';
        for (let i = 0; i < el.childNodes.length; i++) {
          const n = el.childNodes[i];
          if (n.nodeType === 3) own += n.nodeValue;
        }
        if (!own.trim()) return;
        const cs = getComputedStyle(el);
        // No opacity guard: entrance animations report opacity 0 before running.
        if (cs.position === 'fixed' || cs.visibility === 'hidden' || cs.display === 'none') return;
        const r = el.getBoundingClientRect();
        if (!r.width) return;
        const rel = r.top - top;
        if (rel > 24 && rel < H && rel < first) first = rel;
      });
      fadeEnd = Math.max(46, Math.min(first === Infinity ? H * 0.3 : first - 12, H * 0.5));
      fadePeak = fadeEnd * 0.5;
      fadeSigma = Math.max(18, fadeEnd * 0.34);
    };
    const seed = () => {
      const n = Math.ceil(cv.height / lh) + 3;
      rows = new Array(n).fill(0).map((_, i) => ({
        y: i * lh,
        data: enetRow(i + 1),
        // uniform speed keeps row spacing rigid — rows must never converge
        x: (i % 3) * 8,
      }));
    };
    const fit = () => {
      const w = cv.offsetWidth, h = cv.offsetHeight;
      if (!w || !h) return;
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; seed(); measureWindow(); }
    };
    const draw = () => {
      fit();
      if (!cv.width || !cv.height || !rows.length) return;
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.font = fs + 'px "JetBrains Mono", monospace';
      ctx.textBaseline = 'top';
      for (const r of rows) {
        r.y -= SPEED;
        if (r.y < -lh) {
          r.y += rows.length * lh;
          r.data = enetRow(++tick + 7);
        }
        // Opacity peaks mid-way up the measured empty band and is zero by the
        // time it reaches the first line of real text.
        const d = (r.y - fadePeak) / fadeSigma;
        const edge = Math.exp(-d * d);
        if (edge <= 0.02) continue;
        const a = edge * 0.46;
        let x = 14 + r.x;
        ctx.fillStyle = 'rgba(120, 132, 150, ' + (a * 0.55).toFixed(3) + ')';
        ctx.fillText(r.data.off, x, r.y);
        x += ctx.measureText(r.data.off + '  ').width;
        ctx.fillStyle = 'rgba(174, 242, 58, ' + (a * 0.62).toFixed(3) + ')';
        ctx.fillText(r.data.hexStr, x, r.y);
        x += ctx.measureText(r.data.hexStr + '  ').width;
        ctx.fillStyle = 'rgba(140, 152, 168, ' + (a * 0.5).toFixed(3) + ')';
        ctx.fillText('|' + r.data.ascii + '|', x, r.y);
        x += ctx.measureText('|' + r.data.ascii + '|  ').width;
        ctx.fillStyle = 'rgba(174, 242, 58, ' + (a * 0.32).toFixed(3) + ')';
        ctx.fillText(r.data.cmd, x, r.y);
      }
    };
    fit();
    measureWindow();
    draw();
    // Entrance animations settle after first paint — re-measure so the window
    // reflects final content positions.
    [250, 900, 2000].forEach((ms) => setTimeout(() => { measureWindow(); draw(); }, ms));
    window.addEventListener('load', () => { measureWindow(); draw(); });
    const step = (t) => {
      requestAnimationFrame(step);
      if (offscreen || t - last < 50) return;
      last = t;
      draw();
    };
    requestAnimationFrame(step);
    // Observers are optimizations only — never let them gate the first paint.
    window.addEventListener('resize', fit);
    if (window.ResizeObserver) { try { new ResizeObserver(fit).observe(cv); } catch (e) {} }
    if (window.IntersectionObserver) {
      try {
        new IntersectionObserver((es) => {
          const en = es[es.length - 1];
          if (en) offscreen = !en.isIntersecting;
        }, { rootMargin: '150px' }).observe(cv);
      } catch (e) {}
    }
  }

  // text scramble / decode on scroll into view
  const SCRAMBLE = '!<>-_\\/[]{}=+*^?#$01';
  function scramble(el) {
    if (el.dataset.scrambled) return;
    el.dataset.scrambled = '1';
    const final = el.textContent;
    const total = Math.max(22, Math.round(final.length * 1.15));
    let frame = 0;
    const tick = () => {
      frame++;
      const reveal = Math.floor(final.length * (frame / total));
      let out = '';
      for (let i = 0; i < final.length; i++) {
        out += i < reveal ? final[i] : (final[i] === ' ' ? ' ' : SCRAMBLE[(Math.random() * SCRAMBLE.length) | 0]);
      }
      el.textContent = out;
      if (frame < total) requestAnimationFrame(tick);
      else el.textContent = final;
    };
    requestAnimationFrame(tick);
  }
  const so = new IntersectionObserver((es) => es.forEach((en) => { if (en.isIntersecting) scramble(en.target); }), { threshold: 0.5 });

  const scan = () => {
    document.querySelectorAll('canvas[data-rain]').forEach(initRain);
    document.querySelectorAll('[data-scramble]:not([data-sc-seen])').forEach((el) => { el.dataset.scSeen = '1'; so.observe(el); });
    document.querySelectorAll('img').forEach((im) => { if (im.complete && im.naturalWidth === 0) im.style.display = 'none'; });
  };
  scan();
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  [100, 400, 1000, 2500].forEach((ms) => setTimeout(scan, ms));
  window.addEventListener('load', scan);

  document.addEventListener('error', (e) => {
    if (e.target && e.target.tagName === 'IMG') e.target.style.display = 'none';
  }, true);

  // cursor glow + 3D tilt [data-tilt] + magnetic pull [data-magnet]
  const clampV = (v, m) => Math.max(-m, Math.min(m, v));
  document.addEventListener('mousemove', (e) => {
    const g = document.getElementById('cursor-glow');
    if (g) { g.style.left = e.clientX + 'px'; g.style.top = e.clientY + 'px'; }
    const el = e.target.closest ? e.target.closest('[data-tilt]') : null;
    document.querySelectorAll('[data-tilt].__tilted').forEach((t) => {
      if (t !== el) { t.style.transform = ''; t.classList.remove('__tilted'); }
    });
    if (el) {
      const r = el.getBoundingClientRect();
      const rx = clampV(((e.clientY - r.top) / r.height - 0.5) * -12, 7);
      const ry = clampV(((e.clientX - r.left) / r.width - 0.5) * 12, 7);
      el.style.transform = 'perspective(900px) rotateX(' + rx + 'deg) rotateY(' + ry + 'deg) translateY(-4px)';
      el.classList.add('__tilted');
    }
    const m = e.target.closest ? e.target.closest('[data-magnet]') : null;
    document.querySelectorAll('[data-magnet].__mag').forEach((b) => {
      if (b !== m) { b.style.transform = ''; b.classList.remove('__mag'); }
    });
    if (m) {
      const r = m.getBoundingClientRect();
      const mx = clampV((e.clientX - (r.left + r.width / 2)) * 0.22, 7);
      const my = clampV((e.clientY - (r.top + r.height / 2)) * 0.22, 7);
      m.style.transform = 'translate(' + mx + 'px, ' + my + 'px)';
      m.classList.add('__mag');
    }
  }, { passive: true });

  // Clean public routes. Vercel rewrites these to the real files, so visitors
  // never see ".dc.html". Opened straight off disk there is no rewrite layer,
  // so map back to the filename before navigating.
  const ROUTES = {
    '/': { file: 'Portfolio.dc.html', wipe: null },
    '/blockheads': { file: 'Project-Blockheads.dc.html', wipe: 'blockheads-server' },
    '/ai-interviewer': { file: 'Project-AI-Interviewer.dc.html', wipe: 'ai-interviewer' },
    '/coal-mine-locator': { file: 'Project-CoalMineLocator.dc.html', wipe: 'coal-mine-locator' },
    '/voice-ai': { file: 'Project-VoiceAI.dc.html', wipe: 'voice-ai-agent' },
  };
  const FILE_MODE = location.protocol === 'file:' || location.pathname.indexOf('.dc.html') >= 0;

  document.addEventListener('click', (e) => {
    const a = e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || a.target === '_blank') return;
    const href = a.getAttribute('href') || '';
    const [path, hash] = href.split('#');
    const route = ROUTES[path];
    if (!route) return;
    const w = document.getElementById('page-wipe');
    if (!w) return;
    e.preventDefault();
    const s = w.querySelector('span');
    if (s) {
      s.textContent = route.wipe ? '> cd ./' + route.wipe + '_' : '> cd ~/saad_';
      s.style.animation = 'textCycle 0.5s ease 0.06s both';
    }
    const dest = (FILE_MODE ? route.file : path) + (hash ? '#' + hash : '');
    w.style.transform = 'translateY(0)';
    setTimeout(() => { location.href = dest; }, 580);
  });
})();
