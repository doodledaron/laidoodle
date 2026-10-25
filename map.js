// "where we've explored": a hand-drawn Klang Valley map with a pin per café.
// Pins come from each jam's mapPoint ([lat, lng], from the sheet's map_area column).
// Positions are approximate on purpose: it's a doodle, not a navigation map.

(function () {
  // The area the drawing covers (lat 2.89–3.27, lng 101.35–101.83) → a 480 × 380 canvas.
  const BOX = { n: 3.27, s: 2.89, w: 101.35, e: 101.83 };
  const W = 480, H = 380;
  // A gentle fisheye around KL/PJ, like a hand-drawn tourist map: the busy middle gets more room, the outskirts squeeze in.
  const MID = [(101.665 - BOX.w) * 1000, (BOX.n - 3.128) * 1000], REACH = 260, LENS = 0.68;
  const xy = ([lat, lng]) => {
    const dx = (lng - BOX.w) * 1000 - MID[0], dy = (BOX.n - lat) * 1000 - MID[1];
    const r = Math.hypot(dx, dy);
    const k = r ? REACH * Math.pow(r / REACH, LENS) / r : 1;
    return [MID[0] + dx * k, MID[1] + dy * k];
  };
  const inBox = p => p && p[0] >= BOX.s - 0.05 && p[0] <= BOX.n + 0.05 && p[1] >= BOX.w - 0.05 && p[1] <= BOX.e + 0.05;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // Smooth wobbly line through points (Catmull-Rom → cubic Bézier).
  function curve(points) {
    const p = points.map(xy);
    let d = `M${p[0][0].toFixed(1)} ${p[0][1].toFixed(1)}`;
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i - 1] || p[i], b = p[i], c = p[i + 1], e = p[i + 2] || c;
      d += ` C${(b[0] + (c[0] - a[0]) / 6).toFixed(1)} ${(b[1] + (c[1] - a[1]) / 6).toFixed(1)},` +
        `${(c[0] - (e[0] - b[0]) / 6).toFixed(1)} ${(c[1] - (e[1] - b[1]) / 6).toFixed(1)},${c[0].toFixed(1)} ${c[1].toFixed(1)}`;
    }
    return d;
  }

  const COAST = [[3.30, 101.395], [3.22, 101.38], [3.15, 101.392], [3.09, 101.372], [3.03, 101.388], [2.97, 101.372], [2.92, 101.398], [2.86, 101.41]];
  const RIVER = [[3.27, 101.738], [3.22, 101.718], [3.18, 101.703], [3.149, 101.696], [3.128, 101.684], [3.103, 101.660], [3.088, 101.628],
    [3.078, 101.592], [3.071, 101.548], [3.060, 101.508], [3.046, 101.470], [3.036, 101.440], [3.018, 101.405], [3.005, 101.385]];
  const LABELS = [ // [name, lat, lng, dx, dy]
    ['KL', 3.149, 101.696, -16, 22], ['Bangsar', 3.130, 101.671, -38, 20], ['Mont Kiara', 3.170, 101.651, -30, -10],
    ['Kepong', 3.214, 101.636, -20, -10], ['Setapak', 3.196, 101.718, 6, -8], ['Ampang', 3.150, 101.762, 4, 0],
    ['Cheras', 3.090, 101.745, 0, 14], ['PJ', 3.107, 101.607, -12, 20], ['Subang', 3.050, 101.585, -24, 18],
    ['Shah Alam', 3.073, 101.518, -30, -12], ['Klang', 3.044, 101.446, -10, 22], ['Puchong', 3.025, 101.618, -10, 18],
    ['Cyberjaya', 2.922, 101.651, -30, 16], ['Putrajaya', 2.926, 101.696, 4, -6], ['Kajang', 2.993, 101.787, -14, 18],
  ];
  const TREES = [[3.235, 101.52], [3.19, 101.47], [2.95, 101.54], [2.985, 101.48], [3.0, 101.70], [3.235, 101.60], [2.92, 101.75]];
  const HILLS = [[3.245, 101.775], [3.225, 101.805], [3.19, 101.815], [3.255, 101.81], [3.12, 101.815]];

  const tree = ([x, y]) => `<g transform="translate(${x.toFixed(0)} ${y.toFixed(0)})"><path d="M-7 0 C-12 -4,-8 -13,-2 -11 C0 -18,10 -16,9 -9 C15 -7,13 2,6 1 Z" class="kv-tree"/><path d="M0 0 V8" class="kv-ink"/></g>`;
  const hill = ([x, y]) => `<path transform="translate(${x.toFixed(0)} ${y.toFixed(0)})" d="M-14 6 L-5 -8 L0 -2 L6 -12 L16 6" class="kv-hill"/>`;
  const towers = ([x, y]) => `<g transform="translate(${x.toFixed(0)} ${y.toFixed(0)})" class="kv-towers">
      <path d="M-7 4 V-18 L-5.5 -24 L-4 -18 V4 M2 4 V-18 L3.5 -24 L5 -18 V4 M-4 -8 H2"/><path d="M-5.5 -24 V-29 M3.5 -24 V-29"/></g>`;

  function svg(journey) {
    const [cx, cy] = xy([2.925, 101.48]);
    return `
    <svg class="kv-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
      <defs>
        <filter id="kv-wobble" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="4"/>
          <feDisplacementMap in="SourceGraphic" scale="3.2"/>
        </filter>
        <pattern id="kv-waves" width="34" height="18" patternUnits="userSpaceOnUse">
          <path d="M3 10 q4 -5 8 0 t8 0" class="kv-wave"/>
        </pattern>
        <mask id="kv-journey-mask"><path d="${journey}" class="kv-journey-reveal" pathLength="1"/></mask>
      </defs>
      <g filter="url(#kv-wobble)">
        <path d="${curve(COAST)} L-10 ${H + 10} L-10 -10 Z" class="kv-sea"/>
        <path d="${curve(COAST)} L-10 ${H + 10} L-10 -10 Z" fill="url(#kv-waves)"/>
        <path d="${curve(COAST)}" class="kv-coast"/>
        <path d="${curve(RIVER)}" class="kv-river" pathLength="1"/>
        ${HILLS.map(p => hill(xy(p))).join('')}
        ${TREES.map(p => tree(xy(p))).join('')}
        ${towers(xy([3.158, 101.712]))}
        <g transform="translate(${cx.toFixed(0)} ${cy.toFixed(0)})" class="kv-compass">
          <circle r="15"/><path d="M0 -11 L4 2 L0 0 L-4 2 Z"/><text y="-19" text-anchor="middle">N</text>
        </g>
      </g>
      <text x="8" y="${H - 14}" class="kv-sea-label" transform="rotate(-90 18 ${H - 14})">the sea ~</text>
      ${LABELS.map(([n, lat, lng, dx, dy]) => { const [x, y] = xy([lat, lng]); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.8" class="kv-dot"/><text x="${(x + dx).toFixed(0)}" y="${(y + dy).toFixed(0)}" class="kv-label">${n}</text>`; }).join('')}
      ${journey ? `<path d="${journey}" class="kv-journey" mask="url(#kv-journey-mask)"/>` : ''}
    </svg>`;
  }

  const PIN = `<svg viewBox="0 0 28 38" aria-hidden="true" focusable="false" class="kv-pin__svg">
      <ellipse cx="14" cy="35" rx="6" ry="2" class="kv-pin__shadow"/>
      <path d="M14 34 C10.5 27,3 21.5,3 13.5 C3 6.8,8 2.6,14.2 2.8 C20.5 3,25.2 7.4,25 13.8 C24.8 21.6,17.6 27,14 34 Z" class="kv-pin__body"/>
      <circle cx="14" cy="13.4" r="4.4" class="kv-pin__dot"/></svg>`;

  const shortDate = e => { const p = LD.parts(e); return `${p.monTitle} ${p.dayNum} '${String(p.y).slice(2)}`; };

  window.LD.map = function (el, events) {
    // one pin per spot; several jams at the same café share it
    const groups = [];
    events.filter(e => Array.isArray(e.mapPoint) && inBox(e.mapPoint)).forEach(e => {
      const key = e.mapPoint.map(n => Number(n).toFixed(3)).join(',');
      let g = groups.find(x => x.key === key);
      if (!g) groups.push(g = { key, point: e.mapPoint, jams: [] });
      g.jams.push(e);
    });
    groups.forEach(g => {
      g.jams.sort((a, b) => a.date.localeCompare(b.date));
      g.past = g.jams.filter(LD.isPast);
      g.next = g.jams.filter(e => !LD.isPast(e));
    });
    // the dashed "journey" line joins past jams in the order they happened
    const trail = events.filter(e => LD.isPast(e) && Array.isArray(e.mapPoint) && inBox(e.mapPoint))
      .sort((a, b) => a.date.localeCompare(b.date)).map(e => e.mapPoint)
      .filter((p, i, a) => !i || p.join() !== a[i - 1].join());
    const journey = trail.length > 1 ? curve(trail) : '';

    const pastJams = events.filter(LD.isPast).filter(e => Array.isArray(e.mapPoint) && inBox(e.mapPoint)).length;
    const cafes = groups.filter(g => g.past.length).length;

    el.innerHTML = `
      <div class="kv-frame">
        <div class="kv-map" id="kv-map">
          ${svg(journey)}
          ${groups.map((g, i) => {
            const [x, y] = xy(g.point);
            const n = g.jams.length;
            const label = `${g.jams[g.jams.length - 1].venueShort || g.jams[0].shortTitle}: ${n} jam${n > 1 ? 's' : ''}${g.past.length ? '' : ' coming up'}`;
            return `<button type="button" class="kv-pin${g.past.length ? '' : ' kv-pin--next'}" data-i="${i}"
              style="left:${(x / W * 100).toFixed(2)}%;top:${(y / H * 100).toFixed(2)}%;--i:${i}" aria-label="${LD.esc(label)}" aria-expanded="false">
              ${PIN}${n > 1 ? `<span class="kv-pin__count">${n}</span>` : ''}</button>`;
          }).join('')}
          ${groups.length ? '' : '<div class="kv-empty">first pin coming soon ✎</div>'}
          <div class="kv-card" id="kv-card" hidden></div>
        </div>
      </div>
      <div class="kv-legend">
        <span><i class="kv-key"></i>we've doodled here</span>
        <span><i class="kv-key kv-key--next"></i>next stop</span>
        ${cafes ? `<span class="kv-count">${cafes} café${cafes > 1 ? 's' : ''} · ${pastJams} jam${pastJams > 1 ? 's' : ''} so far ✎</span>` : ''}
      </div>`;

    const map = el.querySelector('#kv-map');
    const frame = el.querySelector('.kv-frame');
    const floating = () => matchMedia('(hover: hover) and (pointer: fine)').matches;
    const card = el.querySelector('#kv-card');
    const pins = [...el.querySelectorAll('.kv-pin')];
    let openPin = null, hideTimer = 0;

    function cardHtml(g) {
      const latest = g.past[g.past.length - 1] || g.next[0];
      const img = latest.thumbnail || (LD.isPast(latest) ? latest.photos[0] : '') || latest.cafePhotos[0] || latest.photos[0] || '';
      const venue = g.jams.map(e => e.venueShort).filter(v => v && !/tbd/i.test(v)).pop() || '';
      return `
        <div class="kv-card__img placeholder${img ? ' is-loading' : ''}">${img ? `<img src="${LD.esc(img)}" alt="" loading="lazy">` : '✎'}</div>
        <div class="kv-card__venue">${venue ? LD.esc(venue) : g.past.length ? 'a cosy café' : 'next stop ✎'}</div>
        <ul class="kv-card__jams">${g.jams.slice().reverse().map(e => `
          <li><a href="${LD.url.jam(e.id)}"><span>${LD.esc(e.shortTitle)}</span><small>${LD.isPast(e) ? shortDate(e) : 'coming up · ' + shortDate(e)}</small></a></li>`).join('')}
        </ul>`;
    }

    function show(pin) {
      clearTimeout(hideTimer);
      if (openPin === pin) return;
      if (openPin) openPin.setAttribute('aria-expanded', 'false'), openPin.classList.remove('is-active');
      openPin = pin;
      pin.classList.add('is-active');
      pin.setAttribute('aria-expanded', 'true');
      const g = groups[pin.dataset.i];
      card.innerHTML = cardHtml(g);
      const img = card.querySelector('img');
      if (img) {
        const done = () => img.parentNode.classList.remove('is-loading');
        img.complete ? done() : (img.onload = done, img.onerror = () => { img.remove(); done(); });
      }
      const px = pin.offsetLeft, py = pin.offsetTop;
      if (floating()) {
        // mouse: float next to the pin, kept inside the map; flip below when there's no room above
        if (card.parentNode !== map) map.appendChild(card);
        card.classList.remove('kv-card--dock');
        card.hidden = false;
        const mw = map.clientWidth, mh = map.clientHeight;
        const cw = card.offsetWidth, ch = card.offsetHeight;
        let left = clamp(px - cw / 2, 6, mw - cw - 6), top, origin;
        if (py - 40 - ch >= 6) { top = py - 40 - ch; origin = `${px - left}px 100%`; }      // above the pin
        else if (py + 8 + ch <= mh) { top = py + 8; origin = `${px - left}px 0%`; }         // below it
        else {                                                                              // beside it
          const right = px < mw / 2;
          left = right ? px + 20 : px - 20 - cw;
          top = clamp(py - 19 - ch / 2, 6, mh - ch - 6);
          origin = `${right ? '0%' : '100%'} ${py - 19 - top}px`;
        }
        Object.assign(card.style, { left: left + 'px', top: top + 'px', transformOrigin: origin });
      } else {
        // touch: dock under the map so every pin stays tappable; it grows out from below the pin
        if (card.parentNode !== frame) frame.appendChild(card);
        card.classList.add('kv-card--dock');
        card.hidden = false;
        Object.assign(card.style, { left: '', top: '', transformOrigin: `${px}px 0%` });
      }
      card.classList.remove('is-open');
      void card.offsetWidth; // restart the pop animation
      card.classList.add('is-open');
    }

    function hide() {
      if (!openPin) return;
      openPin.classList.remove('is-active');
      openPin.setAttribute('aria-expanded', 'false');
      openPin = null;
      card.classList.remove('is-open');
      card.hidden = true;
    }
    const hideSoon = () => { clearTimeout(hideTimer); hideTimer = setTimeout(hide, 220); };

    pins.forEach(pin => {
      pin.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') show(pin); });
      pin.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hideSoon(); });
      pin.addEventListener('click', () => (openPin === pin && !matchMedia('(hover: hover)').matches ? hide() : show(pin)));
      pin.addEventListener('focus', () => { if (pin.matches(':focus-visible')) show(pin); }); // keyboard only; taps go through click
    });
    card.addEventListener('pointerenter', () => clearTimeout(hideTimer));
    card.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hideSoon(); });
    document.addEventListener('click', e => { if (openPin && !e.target.closest('.kv-pin, .kv-card')) hide(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && openPin) { const p = openPin; hide(); p.focus({ preventScroll: true }); } });
    el.addEventListener('focusout', e => { if (!el.contains(e.relatedTarget)) hide(); });

    // draw the river, the journey and drop the pins when the map scrolls into view
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(entries => {
        if (entries.some(x => x.isIntersecting)) { map.classList.add('is-in'); io.disconnect(); }
      }, { threshold: 0.25 });
      io.observe(map);
    } else {
      map.classList.add('is-in');
    }
  };
})();
