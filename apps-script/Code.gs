/**
 * laidoodle backend: paste this into your Google Sheet (Extensions → Apps Script).
 *
 * Tabs:
 *   Events   – one row per jam. Set status to "hidden" to take one off the site.
 *   Signups  – filled in automatically. Add your own columns freely; set status to "cancelled" to free up a spot.
 *   Settings – host_instagram, bank_text, payment_qr.
 *
 * First time: run setup() once, then Deploy → New deployment → Web app
 *   (Execute as: Me, Who has access: Anyone) and put the URL into data.js → apiUrl.
 * After editing THIS file: Deploy → Manage deployments → edit → Version: New version.
 * Editing the sheet itself never needs a redeploy.
 */

const EVENT_HEADERS = [
  'id', 'status', 'short_title', 'title', 'date', 'start_time', 'end_time',
  'venue_short', 'venue', 'map_url', 'fee', 'capacity',
  'photos', 'how_it_works_photo', 'extra_questions', 'doodlers',
];

const SIGNUP_HEADERS = [
  'timestamp', 'event_id', 'event', 'name', 'instagram', 'phone', 'doodly',
  'paid', 'receipt', 'notes', 'extra_answers',
  'agree_safe', 'agree_fee', 'agree_photos', 'status',
];

const SETTINGS_ROWS = [
  ['host_instagram', '@doodledaron'],
  ['bank_text', 'or bank transfer: account details'],
  ['payment_qr', ''],
];

const RECEIPT_FOLDER = 'laidoodle receipts';
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

// ---------- one-time setup ----------

function setup() {
  const ss = SpreadsheetApp.getActive();

  const events = ensureSheet_(ss, 'Events', EVENT_HEADERS);
  if (events.getLastRow() === 1) {
    events.getRange(2, 1, 4, EVENT_HEADERS.length).setValues([
      ['jam-05', '', 'Doodle Jam #05', 'autumn leaves & lemon tea', '2026-11-14', '2pm', '5pm', 'café TBD', 'café name, street', '', 10, 8, '', '', '', ''],
      ['winter-zine', '', 'Winter zine jam', 'winter zine jam', '2026-12-06', '3pm', '6pm', 'café TBD', 'café TBD', '', 0, 8, '', '', '', ''],
      ['jam-04', '', '#04 picnic edition', 'picnic edition', '2025-10-12', '2pm', '5pm', 'park', 'park', '', 0, 10, '', '', '', 9],
      ['jam-03', '', '#03 rainy café', 'rainy café', '2025-09-21', '2pm', '5pm', 'café', 'café', '', 0, 8, '', '', '', 6],
    ]);
  }
  events.getRange('E:E').setNumberFormat('yyyy-mm-dd');

  const signups = ensureSheet_(ss, 'Signups', SIGNUP_HEADERS);
  signups.getRange('F:F').setNumberFormat('@'); // keep "+60…" phone numbers as text

  const settings = ensureSheet_(ss, 'Settings', ['key', 'value']);
  if (settings.getLastRow() === 1) settings.getRange(2, 1, SETTINGS_ROWS.length, 2).setValues(SETTINGS_ROWS);

  receiptFolder_();
  SpreadsheetApp.getUi().alert('laidoodle is set up ✎ Now: Deploy → New deployment → Web app.');
}

function ensureSheet_(ss, name, headers) {
  const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function receiptFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('RECEIPT_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (err) { /* folder was deleted, make a new one */ }
  }
  const folder = DriveApp.createFolder(RECEIPT_FOLDER);
  props.setProperty('RECEIPT_FOLDER_ID', folder.getId());
  return folder;
}

// ---------- GET: events for the site (never returns sign-up details) ----------

function doGet() {
  const ss = SpreadsheetApp.getActive();
  const counts = signupCounts_(ss);
  const events = readRows_(ss.getSheetByName('Events'))
    .filter(r => r.id && String(r.status).toLowerCase() !== 'hidden')
    .map(r => toEvent_(r, counts[r.id] || 0, ss.getSpreadsheetTimeZone()));
  return json_({ settings: readSettings_(ss), events: events });
}

function toEvent_(r, taken, tz) {
  const date = asDate_(r.date, tz);
  const start = asTime_(r.start_time, tz);
  const end = asTime_(r.end_time, tz);
  const capacity = Number(r.capacity) || 0;
  return {
    id: String(r.id).trim(),
    shortTitle: String(r.short_title),
    title: String(r.title || r.short_title),
    date: date,
    dayLabel: date ? Utilities.formatDate(new Date(date + 'T12:00:00Z'), 'UTC', 'EEE') : '',
    timeShort: start,
    timeRange: end ? start + '–' + end : start,
    venueShort: String(r.venue_short || r.venue),
    venue: String(r.venue),
    mapUrl: String(r.map_url),
    fee: Number(r.fee) || 0,
    capacity: capacity,
    spotsLeft: Math.max(0, capacity - taken),
    photos: lines_(r.photos).map(imageUrl_),
    howItWorksPhoto: imageUrl_(String(r.how_it_works_photo)),
    extraQuestions: lines_(r.extra_questions),
    doodlers: r.doodlers === '' ? taken : Number(r.doodlers),
  };
}

// ---------- POST: a sign-up from the form ----------

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'invalid' }); }
  if (body.website) return json_({ ok: true }); // honeypot: bots fill this, people never see it

  const required = ['event_id', 'name', 'instagram', 'phone', 'doodly'];
  if (required.some(k => !String(body[k] || '').trim()) || !body.agree_safe || !body.agree_photos) {
    return json_({ ok: false, error: 'invalid' });
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.getActive();
    const tz = ss.getSpreadsheetTimeZone();
    const row = readRows_(ss.getSheetByName('Events')).find(r => String(r.id).trim() === body.event_id);
    if (!row || String(row.status).toLowerCase() === 'hidden') return json_({ ok: false, error: 'not_found' });

    const event = toEvent_(row, signupCounts_(ss)[row.id] || 0, tz);
    const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    if (event.date && event.date < today) return json_({ ok: false, error: 'closed' });
    if (event.spotsLeft <= 0) return json_({ ok: false, error: 'full' });
    if (event.fee > 0 && (!body.paid || !body.agree_fee)) return json_({ ok: false, error: 'invalid' });

    let receipt = '';
    if (event.fee > 0 && body.receipt && body.receipt.data) {
      const bytes = Utilities.base64Decode(body.receipt.data);
      if (bytes.length > MAX_RECEIPT_BYTES) return json_({ ok: false, error: 'receipt_too_big' });
      const name = [event.id, body.name, body.receipt.name || 'receipt'].join(' - ');
      receipt = receiptFolder_().createFile(Utilities.newBlob(bytes, body.receipt.type || 'application/octet-stream', name)).getUrl();
    }

    const extra = (body.extra || []).map(x => x.q + ': ' + (x.a || '')).join('\n');
    appendByHeader_(ss.getSheetByName('Signups'), {
      timestamp: new Date(),
      event_id: event.id,
      event: event.shortTitle,
      name: body.name,
      instagram: body.instagram,
      phone: body.phone,
      doodly: body.doodly,
      paid: event.fee > 0 ? (body.paid ? 'yes' : 'no') : 'free',
      receipt: receipt,
      notes: body.notes || '',
      extra_answers: extra,
      agree_safe: 'yes',
      agree_fee: event.fee > 0 ? 'yes' : '',
      agree_photos: 'yes',
      status: '',
    });
    return json_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

// ---------- helpers ----------

function readRows_(sheet) {
  const values = sheet.getDataRange().getValues();
  const headers = values.shift().map(h => String(h).trim().toLowerCase());
  return values.map(v => {
    const o = {};
    headers.forEach((h, i) => { o[h] = v[i] === null || v[i] === undefined ? '' : v[i]; });
    return o;
  });
}

function readSettings_(ss) {
  const s = {};
  ss.getSheetByName('Settings').getDataRange().getValues().slice(1).forEach(r => { s[String(r[0]).trim()] = r[1]; });
  return {
    hostInstagram: String(s.host_instagram || ''),
    bankText: String(s.bank_text || ''),
    paymentQr: imageUrl_(String(s.payment_qr || '')),
  };
}

function signupCounts_(ss) {
  const counts = {};
  readRows_(ss.getSheetByName('Signups')).forEach(r => {
    if (!r.event_id || String(r.status).toLowerCase() === 'cancelled') return;
    counts[r.event_id] = (counts[r.event_id] || 0) + 1;
  });
  return counts;
}

// Writes values under the matching header, so extra columns you add yourself are left alone.
function appendByHeader_(sheet, data) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim().toLowerCase());
  const row = headers.map(h => (h in data ? safeCell_(data[h]) : ''));
  sheet.appendRow(row);
}

// Stops "+60…" turning into a number and "=…" turning into a formula.
function safeCell_(v) {
  if (typeof v !== 'string') return v;
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

function asDate_(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  return String(v).trim();
}

// Sheets turns "2pm" into a time value; turn it back into "2pm" / "2:30pm".
function asTime_(v, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'h:mma').toLowerCase().replace(':00', '');
  return String(v).trim();
}

function lines_(v) {
  return String(v || '').split(/\n|\s*;\s*/).map(s => s.trim()).filter(Boolean);
}

// Google Drive share links → direct image URLs (the file must be shared as "anyone with the link").
function imageUrl_(url) {
  const m = String(url).match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]+)/);
  return m ? 'https://lh3.googleusercontent.com/d/' + m[1] : String(url).trim();
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
