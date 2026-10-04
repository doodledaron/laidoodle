// laidoodle config. Events, sign-ups and settings live in your Google Sheet (see README.md).

window.LAIDOODLE = {
  // Your Apps Script web-app URL (Deploy → Manage deployments → Web app URL, ends in /exec).
  // While this is empty the site shows the sample jams below and sign-ups are NOT saved.
  apiUrl: 'https://script.google.com/macros/s/AKfycbzu8hKQmmFOYPWd5bSI0vTuIKkAdCfVfolW63p57DgNaPTthDw_V73R5tNPegy6-u2j/exec',

  // Sample data, used only while apiUrl is empty. Same shape as what the sheet returns.
  sample: {
    settings: {
      hostInstagram: '@doodledaron',
      bankText: 'or bank transfer: account details',
      paymentQr: '',
    },
    events: [
      { id: 'jam-05', shortTitle: 'Doodle Jam #05', title: 'autumn leaves & lemon tea', date: '2026-11-14', dayLabel: 'Sat', timeShort: '2pm', timeRange: '2–5pm', venueShort: 'café TBD', venue: 'café name, street', mapUrl: '', fee: 10, feeIncludes: '1 drink', capacity: 8, spotsLeft: 4, photos: [], cafePhotos: [], extraQuestions: [], doodlers: 4, thumbnail: '' },
      { id: 'winter-zine', shortTitle: 'Winter zine jam', title: 'winter zine jam', date: '2026-12-06', dayLabel: 'Sun', timeShort: '3pm', timeRange: '3–6pm', venueShort: 'café TBD', venue: 'café TBD', mapUrl: '', fee: 0, capacity: 8, spotsLeft: 8, photos: [], cafePhotos: [], extraQuestions: ['which part of town works best for u?'], doodlers: 0, thumbnail: '' },
      { id: 'jam-04', shortTitle: '#04 picnic edition', title: 'picnic edition', date: '2025-10-12', dayLabel: 'Sun', timeShort: '2pm', timeRange: '2–5pm', venueShort: 'park', venue: 'park', mapUrl: '', fee: 0, capacity: 10, spotsLeft: 1, photos: [], cafePhotos: [], extraQuestions: [], doodlers: 9, thumbnail: '' },
      { id: 'jam-03', shortTitle: '#03 rainy café', title: 'rainy café', date: '2025-09-21', dayLabel: 'Sun', timeShort: '2pm', timeRange: '2–5pm', venueShort: 'café', venue: 'café', mapUrl: '', fee: 0, capacity: 8, spotsLeft: 2, photos: [], cafePhotos: [], extraQuestions: [], doodlers: 6, thumbnail: '' },
    ],
  },
};

// Small helpers shared by every page.
window.LD = {
  months: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'],

  esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  isPast(e) {
    return !!e.date && e.date < LD.today();
  },

  // → { settings, events, upcoming, past }. Rejects if the sheet can't be reached.
  async load() {
    const cfg = window.LAIDOODLE;
    let data = cfg.sample;
    if (cfg.apiUrl) {
      const res = await fetch(cfg.apiUrl);
      if (!res.ok) throw new Error(`events: ${res.status}`);
      data = await res.json();
    }
    const events = data.events.filter(e => e.date).sort((a, b) => a.date.localeCompare(b.date));
    return {
      settings: data.settings,
      events,
      upcoming: events.filter(e => !LD.isPast(e)),
      past: events.filter(e => LD.isPast(e)).reverse(),
    };
  },

  // Sends a sign-up to the sheet. text/plain keeps it a "simple" request, which Apps Script accepts.
  async submit(payload) {
    const cfg = window.LAIDOODLE;
    if (!cfg.apiUrl) return { ok: true, sample: true };
    const res = await fetch(cfg.apiUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error(`signup: ${res.status}`);
    return res.json();
  },

  loadError() {
    return `couldn't load the jams right now, try refreshing (or DM ${LD.esc(window.LAIDOODLE.sample.settings.hostInstagram)})`;
  },

  parts(e) {
    const [y, m, d] = e.date.split('-').map(Number);
    const mon = LD.months[m - 1];
    const monTitle = mon[0] + mon.slice(1).toLowerCase();
    return { y, mon, monTitle, day: String(d).padStart(2, '0'), dayNum: d };
  },

  spotsText(e) {
    return e.spotsLeft === e.capacity ? `${e.capacity}/${e.capacity} open` : `${e.spotsLeft}/${e.capacity} spots left`;
  },

  photoStyle(url) {
    return url ? ` style="background-image:url('${LD.esc(url)}')"` : '';
  },

  message(el, title, text) {
    el.innerHTML = `<div class="done"><h1 class="h-step">${title}</h1><p>${text}</p><a class="pill pill--ink" href="index.html" style="padding:10px 22px;font-size:18px;margin-top:10px">back to laidoodle</a></div>`;
  },
};
