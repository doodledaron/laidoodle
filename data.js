// laidoodle content — edit this file to add/change jams. No build step needed.

window.LAIDOODLE = {
  hostInstagram: '@doodledaron',

  // Where sign-ups are POSTed as multipart form data (e.g. a Formspree or Google Apps Script URL).
  // Leave empty and the form just shows the confirmation screen without sending anything.
  signupEndpoint: '',

  // Payment details shown on the commitment-fee step (paid jams only).
  payment: {
    qrImage: '',              // e.g. 'assets/payment-qr.png'
    bankText: 'or bank transfer: account details',
  },

  upcoming: [
    {
      id: 'jam-05',
      number: 5,
      shortTitle: 'Doodle Jam #05',
      title: 'autumn leaves & lemon tea',
      date: '2026-11-16',
      dayLabel: 'Sat',
      timeShort: '2pm',
      timeRange: '2–5pm',
      venueShort: 'café TBD',
      venue: 'café name, street',
      mapUrl: '',             // google maps link; "→ map" shows when set
      fee: 10,                // RM; 0 = free (sign-up skips the payment step)
      capacity: 8,
      spotsLeft: 4,
      photos: [],             // image URLs for the swipe carousel; empty = placeholders
      howItWorksPhoto: '',
    },
    {
      id: 'winter-zine',
      number: 6,
      shortTitle: 'Winter zine jam',
      title: 'winter zine jam',
      date: '2026-12-07',
      dayLabel: 'Sun',
      timeShort: '3pm',
      timeRange: '3–6pm',
      venueShort: 'café TBD',
      venue: 'café TBD',
      mapUrl: '',
      fee: 0,
      capacity: 8,
      spotsLeft: 8,
      photos: [],
      howItWorksPhoto: '',
    },
  ],

  past: [
    { title: '#04 picnic edition', date: 'Oct 12', doodlers: 9, photo: '' },
    { title: '#03 rainy café', date: 'Sep 21', doodlers: 6, photo: '' },
  ],
};

// Small helpers shared by every page.
window.LD = {
  months: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'],

  esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  findEvent(id) {
    const list = window.LAIDOODLE.upcoming;
    return list.find(e => e.id === id) || list[0];
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
};
