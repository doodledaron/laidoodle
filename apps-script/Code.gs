/**
 * laidoodle backend: paste this into your Google Sheet (Extensions → Apps Script).
 *
 * Tabs:
 *   Events   – one row per jam. Put Y in "isHidden? (Y/N)" to take one off the site.
 *   Signups  – filled in automatically. Add your own columns freely; put Y in "isCancelled? (Y/N)" to free up a spot.
 *   Settings – host_instagram, bank_text, payment_qr, receipt_folder (where receipts are saved).
 *
 * Reminder emails: setup() also starts a daily timer (~10am) that runs sendReminders().
 *
 * First time: run setup() once, then Deploy → New deployment → Web app
 *   (Execute as: Me, Who has access: Anyone) and put the URL into data.js → apiUrl.
 * After editing THIS file: Deploy → Manage deployments → edit → Version: New version.
 * Editing the sheet itself never needs a redeploy.
 */

const HIDDEN_COL = 'isHidden? (Y/N)';
const CANCELLED_COL = 'isCancelled? (Y/N)';

const EVENT_HEADERS = [
  'id', HIDDEN_COL, 'short_title', 'title', 'date', 'start_time', 'end_time',
  'venue_short', 'venue', 'map_url', 'fee', 'fee_includes', 'capacity',
  'photos', 'cafe_photos', 'extra_questions', 'doodlers', 'thumbnail', 'cost_remark',
];

const SIGNUP_HEADERS = [
  'timestamp', 'event_id', 'event', 'name', 'instagram', 'phone', 'doodly',
  'paid', 'receipt', 'notes', 'extra_answers',
  'agree_safe', 'agree_fee', 'agree_photos', CANCELLED_COL, 'email', 'agree_marketing',
];

const SETTINGS_ROWS = [
  ['host_instagram', '@doodledaron'],
  ['bank_text', 'or bank transfer: account details'],
  ['payment_qr', ''],
  ['receipt_folder', 'https://drive.google.com/drive/folders/1mKrXlb5sxRFExk9kNA22RzQjDfi9W45D'],
  ['notify_email', ''], // filled with your own email by setup(); "off" turns sign-up emails off
  ['host_whatsapp', '011 39214061'], // your WhatsApp, in the confirmation email ("ask me anything"); "off" hides it
  ['reminder_days', '3,1'], // reminder emails this many days before a jam; "off" stops them
];

// Used when the Settings tab has no receipt_folder row.
const DEFAULT_RECEIPT_FOLDER_ID = '1mKrXlb5sxRFExk9kNA22RzQjDfi9W45D';
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

// ---------- one-time setup ----------

function setup() {
  const ss = SpreadsheetApp.getActive();

  const events = ensureSheet_(ss, 'Events', EVENT_HEADERS);
  upgradeHeaders_(events, EVENT_HEADERS, { how_it_works_photo: 'cafe_photos', status: HIDDEN_COL });
  if (events.getLastRow() === 1) {
    [
      ['jam-05', '', 'Doodle Jam #05', 'autumn leaves & lemon tea', '2026-11-14', '2pm', '5pm', 'café TBD', 'café name, street', '', 10, '1 drink', 8, '', '', '', ''],
      ['winter-zine', '', 'Winter zine jam', 'winter zine jam', '2026-12-06', '3pm', '6pm', 'café TBD', 'café TBD', '', 0, '', 8, '', '', '', ''],
      ['jam-04', '', '#04 picnic edition', 'picnic edition', '2025-10-12', '2pm', '5pm', 'park', 'park', '', 0, '', 10, '', '', '', 9],
      ['jam-03', '', '#03 rainy café', 'rainy café', '2025-09-21', '2pm', '5pm', 'café', 'café', '', 0, '', 8, '', '', '', 6],
    ].forEach(v => {
      const o = {};
      EVENT_HEADERS.forEach((k, n) => { o[key_(k)] = v[n] === undefined ? '' : v[n]; });
      o.is_hidden = 'N';
      appendByHeader_(events, o); // by column name, so it works whatever order the columns are in
    });
  }
  events.getRange('E:E').setNumberFormat('yyyy-mm-dd');
  yesNoColumn_(events, 'is_hidden');

  const signups = ensureSheet_(ss, 'Signups', SIGNUP_HEADERS);
  upgradeHeaders_(signups, SIGNUP_HEADERS, { status: CANCELLED_COL });
  yesNoColumn_(signups, 'is_cancelled');
  signups.getRange('F:F').setNumberFormat('@'); // keep "+60…" phone numbers as text

  const settings = ensureSheet_(ss, 'Settings', ['key', 'value']);
  const current = settings.getDataRange().getValues();
  const keys = current.map(r => String(r[0]).trim());
  SETTINGS_ROWS.forEach(r => {
    const value = r[0] === 'notify_email' ? Session.getEffectiveUser().getEmail() : r[1];
    const i = keys.indexOf(r[0]);
    if (i === -1 && r[0] === 'reminder_days') {                                        // as text, so "3,1" doesn't turn into 31
      settings.appendRow([r[0], '']);
      settings.getRange(settings.getLastRow(), 2).setNumberFormat('@').setValue(value);
    } else if (i === -1) settings.appendRow([r[0], value]);                            // add missing rows
    else if (r[0] === 'host_whatsapp' && !String(current[i][1]).trim()) settings.getRange(i + 1, 2).setValue(value); // fill an empty one
  });

  upgradeHeaders_(signups, reminderColumns_(ss), {}); // reminded_3d, reminded_1d: when each reminder went out
  installReminders_(ss);

  receiptFolder_(ss); // fails here (not at sign-up time) if the folder can't be reached
  const done = 'laidoodle is set up ✎ Reminder emails go out every day around 10am.\n' +
    'First time? Deploy → New deployment → Web app. Edited the code? Deploy → Manage deployments → New version.';
  console.log(done);
  try { SpreadsheetApp.getUi().alert(done); } catch (err) { /* no pop-up when the sheet isn't open in a tab; the log above says it instead */ }
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

// Brings an older sheet's header row up to date: renames old columns and adds missing ones at the end.
// A renamed "status" column also has its old words turned into Y/N (hidden / cancelled → Y).
// Your data rows stay where they are.
function upgradeHeaders_(sheet, headers, renames) {
  const width = sheet.getLastColumn();
  const row = sheet.getRange(1, 1, 1, width).getValues()[0].map(v => String(v).trim());
  const keys = () => row.map(key_);
  Object.keys(renames).forEach(from => {
    const i = keys().indexOf(from);
    if (i === -1 || keys().indexOf(key_(renames[from])) !== -1) return;
    sheet.getRange(1, i + 1).setValue(renames[from]);
    row[i] = renames[from];
    if (from === 'status' && sheet.getLastRow() > 1) {
      const cells = sheet.getRange(2, i + 1, sheet.getLastRow() - 1, 1);
      cells.setValues(cells.getValues().map(r => [isYes_(r[0]) ? 'Y' : 'N']));
    }
  });
  headers.filter(h => keys().indexOf(key_(h)) === -1).forEach(h => {
    row.push(h);
    sheet.getRange(1, row.length).setValue(h).setFontWeight('bold');
  });
}

// A Y/N dropdown on that column, so it's obvious what to type.
function yesNoColumn_(sheet, key) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(key_);
  const col = headers.indexOf(key) + 1;
  if (!col || sheet.getMaxRows() < 2) return;
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(['Y', 'N'], true).setAllowInvalid(true)
    .setHelpText('Y = yes, N or empty = no').build();
  sheet.getRange(2, col, sheet.getMaxRows() - 1, 1).setDataValidation(rule);
}

// Settings → receipt_folder (a Drive folder link or ID), else the default above.
function receiptFolder_(ss) {
  const value = String(settingsMap_(ss).receipt_folder || '').trim();
  const m = value.match(/folders\/([\w-]+)|[?&]id=([\w-]+)/);
  const id = m ? (m[1] || m[2]) : (value || DEFAULT_RECEIPT_FOLDER_ID);
  return DriveApp.getFolderById(id);
}

// "Doodle Jam #05 - Ron - 2026-10-04 15.30.12.png": event + who + when, keeping the file's extension.
function receiptName_(eventName, person, original, when, tz) {
  const clean = s => String(s).replace(/[\\/:*?"<>|\n\r\t]+/g, '-').trim();
  const ext = (String(original).match(/\.[A-Za-z0-9]{1,5}$/) || [''])[0].toLowerCase();
  return [clean(eventName) || 'jam', clean(person) || 'someone', Utilities.formatDate(when, tz, 'yyyy-MM-dd HH.mm.ss')].join(' - ') + ext;
}

// ---------- GET: events for the site (never returns sign-up details) ----------

function doGet() {
  const ss = SpreadsheetApp.getActive();
  const counts = signupCounts_(ss);
  const events = readRows_(ss.getSheetByName('Events'))
    .filter(r => r.id && !isHiddenRow_(r))
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
    feeIncludes: String(r.fee_includes || '').trim(),
    costRemark: String(r.cost_remark || '').trim(), // free text, e.g. "another RM 10 will be collected at the café"
    photos: photoList_(r.photos),
    cafePhotos: photoList_(r.cafe_photos),
    thumbnail: photoList_(r.thumbnail)[0] || '', // one image link (or a folder: its first image)
    extraQuestions: lines_(r.extra_questions),
    doodlers: r.doodlers === '' ? taken : Number(r.doodlers),
  };
}

// ---------- POST: a sign-up from the form ----------

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'invalid' }); }
  if (body.website) return json_({ ok: true }); // honeypot: bots fill this, people never see it

  const required = ['event_id', 'name', 'instagram', 'phone', 'doodly', 'email'];
  body.email = String(body.email || '').trim();
  if (required.some(k => !String(body[k] || '').trim()) || !body.agree_safe || !body.agree_photos || !isEmail_(body.email)) {
    return json_({ ok: false, error: 'invalid' });
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.getActive();
    const tz = ss.getSpreadsheetTimeZone();
    const row = readRows_(ss.getSheetByName('Events')).find(r => String(r.id).trim() === body.event_id);
    if (!row || isHiddenRow_(row)) return json_({ ok: false, error: 'not_found' });

    const event = toEvent_(row, signupCounts_(ss)[row.id] || 0, tz);
    const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    if (event.date && event.date < today) return json_({ ok: false, error: 'closed' });
    if (event.spotsLeft <= 0) return json_({ ok: false, error: 'full' });
    if (event.fee > 0 && (!body.paid || !body.agree_fee)) return json_({ ok: false, error: 'invalid' });
    if (event.fee > 0 && !(body.receipt && body.receipt.data)) return json_({ ok: false, error: 'receipt_missing' });

    const now = new Date();
    let receipt = '';
    if (event.fee > 0 && body.receipt && body.receipt.data) {
      const bytes = Utilities.base64Decode(body.receipt.data);
      if (bytes.length > MAX_RECEIPT_BYTES) return json_({ ok: false, error: 'receipt_too_big' });
      const name = receiptName_(event.shortTitle, body.name, body.receipt.name, now, tz);
      receipt = receiptFolder_(ss).createFile(Utilities.newBlob(bytes, body.receipt.type || 'application/octet-stream', name)).getUrl();
    }

    const extra = (body.extra || []).map(x => x.q + ': ' + (x.a || '')).join('\n');
    const signup = {
      timestamp: now,
      event_id: event.id,
      event: event.shortTitle,
      name: body.name,
      instagram: body.instagram,
      phone: body.phone,
      email: body.email,
      doodly: body.doodly,
      paid: event.fee > 0 ? (body.paid ? 'yes' : 'no') : 'free',
      receipt: receipt,
      notes: body.notes || '',
      extra_answers: extra,
      agree_safe: 'yes',
      agree_fee: event.fee > 0 ? 'yes' : '',
      agree_photos: 'yes',
      agree_marketing: body.agree_marketing ? 'yes' : 'no', // the form requires it; older cached pages may not send it
      is_cancelled: 'N',
    };
    appendByHeader_(ss.getSheetByName('Signups'), signup);
    lock.releaseLock(); // the sign-up is saved; the email below doesn't need to hold anyone else up
    notifyHost_(ss, event, signup);
    confirmToDoodler_(ss, event, signup);
    return json_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

// ---------- email to you for every sign-up ----------

// Sends to Settings → notify_email (comma-separate several addresses; "off" to stop).
// If the email fails, the sign-up is still saved.
function notifyHost_(ss, event, s) {
  try {
    const to = String(settingsMap_(ss).notify_email || '').trim() || Session.getEffectiveUser().getEmail();
    if (!to || /^(off|no|n|none)$/i.test(to)) return;
    const left = Math.max(0, event.spotsLeft - 1);
    const ig = String(s.instagram).replace(/^@?/, '');
    const rows = [
      ['jam', event.shortTitle + ' · ' + event.dayLabel + ' ' + event.date + ' ' + event.timeShort],
      ['name', s.name],
      ['instagram', '@' + ig, 'https://instagram.com/' + encodeURIComponent(ig)],
      ['phone / whatsapp', s.phone, waLink_(s.phone)],
      ['email', s.email, 'mailto:' + s.email],
      ['how doodly', s.doodly],
      ['paid', s.paid],
      ['marketing ok', s.agree_marketing],
      ['receipt', s.receipt ? 'open receipt' : '', s.receipt],
      ['anything to know', s.notes],
      ['extra answers', s.extra_answers],
      ['cost note', event.costRemark],
      ['spots left', left + ' / ' + event.capacity],
    ].filter(r => String(r[1]).trim());
    const html = '<div style="font-family:sans-serif;font-size:15px;color:#1d1d1d">' +
      '<p style="font-size:18px">✎ <b>' + esc_(s.name) + '</b> just signed up for <b>' + esc_(event.shortTitle) + '</b></p>' +
      '<table cellpadding="6" style="border-collapse:collapse">' +
      rows.map(r => '<tr><td style="color:#888;vertical-align:top">' + r[0] + '</td><td>' +
        (r[2] ? '<a href="' + esc_(r[2]) + '">' + esc_(r[1]) + '</a>' : esc_(r[1]).replace(/\n/g, '<br>')) + '</td></tr>').join('') +
      '</table><p><a href="' + ss.getUrl() + '">open the sheet</a></p></div>';
    const text = rows.map(r => r[0] + ': ' + (r[2] && r[0] === 'receipt' ? r[2] : r[1])).join('\n');
    MailApp.sendEmail({
      to: to,
      subject: '✎ new sign-up: ' + s.name + ' → ' + event.shortTitle + ' (' + left + ' spots left)',
      body: text,
      htmlBody: html,
      name: 'laidoodle',
    });
  } catch (err) {
    console.error('sign-up email failed: ' + err); // shows under Executions in Apps Script
  }
}

// Run this from the Apps Script editor to check sign-up emails work. Any problem shows up as a red error.
function testEmail() {
  const ss = SpreadsheetApp.getActive();
  const setting = String(settingsMap_(ss).notify_email || '').trim();
  const to = setting || Session.getEffectiveUser().getEmail();
  console.log('notify_email in Settings: "' + setting + '" → sending to: ' + to);
  console.log('emails left today: ' + MailApp.getRemainingDailyQuota());
  if (/^(off|no|n|none)$/i.test(to)) throw new Error('notify_email is set to "' + to + '", so emails are switched off');
  MailApp.sendEmail({ to: to, subject: '✎ laidoodle test email', body: 'if u can read this, sign-up emails work ✎', name: 'laidoodle' });
  console.log('sent ✓ (check Inbox, Spam, and "All Mail" — emails to yourself sometimes skip the inbox)');
}

// ---------- confirmation email to the person who signed up ----------

// The when / where / cost / bring table and your contact links, shared by the confirmation and reminder emails.
function jamEmailParts_(ss, event, s) {
  const st = settingsMap_(ss);
  const ig = String(st.host_instagram || '').trim();
  const wa = /^(off|no|none)$/i.test(String(st.host_whatsapp || '').trim()) ? '' : String(st.host_whatsapp || '').trim();
  const host = String(st.notify_email || '').trim();
  const when = event.dayLabel + ', ' + longDate_(event.date) + ' · ' + event.timeRange;
  let cost = event.fee > 0 ? 'RM ' + event.fee + (event.feeIncludes ? ' · includes ' + event.feeIncludes : ' commitment fee') + ' · non-refundable' + (s.paid === 'yes' ? ' (paid ✓)' : '')
    : 'free · just order something at the café ☕';
  if (event.costRemark) cost += '\n+ ' + event.costRemark;

  // [label, text, link?]
  const details = [
    ['when', when],
    ['where', event.venue, /^https?:\/\//.test(event.mapUrl) ? event.mapUrl : ''],
    ['cost', cost],
    ['bring', 'your own pens / markers / pencils / crayons (no watercolors or anything messy please)'],
  ];
  const contact = [];
  if (wa) contact.push(['WhatsApp', wa, waLink_(wa)]);
  if (ig) contact.push(['IG', ig, 'https://instagram.com/' + encodeURIComponent(ig.replace(/^@/, ''))]);

  const cell = v => esc_(v).replace(/\n/g, '<br>');
  const link = r => r[2] ? '<a href="' + esc_(r[2]) + '" style="color:#2b3a9e">' + cell(r[1]) + '</a>' : cell(r[1]);
  const replyTo = host && isEmail_(host.split(',')[0].trim()) ? host.split(',')[0].trim() : '';
  return {
    contact: contact,
    contactText: contact.map(c => c[0] + ' ' + c[1]).join(' or ') || 'DM me',
    contactHtml: fallback => contact.length ? contact.map(c => c[0] + ' ' + link(c)).join(' or ') : fallback,
    tableHtml: '<table cellpadding="6" style="border-collapse:collapse;background:#f5eedc;border-radius:10px">' +
      details.map(r => '<tr><td style="color:#888;vertical-align:top">' + r[0] + '</td><td>' + link(r) + '</td></tr>').join('') +
      '</table>',
    tableText: details.map(r => r[0] + ': ' + r[1] + (r[2] ? ' (' + r[2] + ')' : '')).join('\n'),
    replyTo: replyTo, // replies come to you
  };
}

function confirmToDoodler_(ss, event, s) {
  try {
    const x = jamEmailParts_(ss, event, s);
    const html = '<div style="font-family:sans-serif;font-size:15px;line-height:1.5;color:#1d1d1d;max-width:480px">' +
      '<p style="font-size:20px;margin:0 0 8px">hi ' + esc_(s.name) + ', u\'re in! ✎</p>' +
      '<p style="margin:0 0 14px">see u at <b>' + esc_(event.shortTitle) + '</b>' + (event.title && event.title !== event.shortTitle ? ' (' + esc_(event.title) + ')' : '') + '.</p>' +
      x.tableHtml +
      '<p style="margin:16px 0 0"><b>questions? ask me anything</b> on ' + x.contactHtml('IG') + ' ✎</p>' +
      '<p style="margin:10px 0 0"><b>can\'t make it?</b> please let me know so someone else can take ur spot: ' + x.contactHtml('DM me') + '.</p>' +
      '<p style="margin:10px 0 0;color:#666">if the date or venue changes, i\'ll let u know on WhatsApp or IG.</p>' +
      '<p style="margin:16px 0 0">see u soon,<br>laidoodle 来涂鸦</p></div>';
    const text = 'hi ' + s.name + ", u're in! ✎\n\nsee u at " + event.shortTitle + '.\n\n' +
      x.tableText +
      '\n\nquestions? ask me anything on ' + x.contactText + ' ✎' +
      "\ncan't make it? please let me know so someone else can take ur spot: " + x.contactText + '.' +
      "\nif the date or venue changes, i'll let u know on WhatsApp or IG.\n\nsee u soon,\nlaidoodle 来涂鸦";
    const mail = {
      to: s.email,
      subject: "✎ u're in: " + event.shortTitle + ' · ' + event.dayLabel + ', ' + longDate_(event.date),
      body: text,
      htmlBody: html,
      name: 'laidoodle',
    };
    if (x.replyTo) mail.replyTo = x.replyTo;
    MailApp.sendEmail(mail);
  } catch (err) {
    console.error('confirmation email failed: ' + err);
  }
}

// ---------- reminder emails (3 days and 1 day before; Settings → reminder_days) ----------

// Runs every day around 10am (setup() starts the timer). Emails everyone signed up for a jam that is
// exactly N days away, for each N in reminder_days, and writes the send time into reminded_Nd so nobody
// gets the same reminder twice. Then sends you a short summary.
function sendReminders() {
  runReminders_(false);
}

function runReminders_(dryRun) {
  const ss = SpreadsheetApp.getActive();
  const tz = ss.getSpreadsheetTimeZone();
  const days = reminderDays_(ss);
  const result = { sent: [], noEmail: [], failed: [] };
  if (!days.length) return result;

  const signups = ss.getSheetByName('Signups');
  if (!dryRun) upgradeHeaders_(signups, reminderColumns_(ss), {}); // e.g. you changed reminder_days to 7,3,1
  const headers = signups.getRange(1, 1, 1, signups.getLastColumn()).getValues()[0].map(key_);
  const now = new Date();
  const today = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  const counts = signupCounts_(ss);

  // jams (not hidden) that are exactly N days away today
  const due = {};
  readRows_(ss.getSheetByName('Events')).forEach(r => {
    if (!r.id || isHiddenRow_(r)) return;
    const left = daysBetween_(today, asDate_(r.date, tz));
    if (days.indexOf(left) !== -1) due[String(r.id).trim()] = { event: toEvent_(r, counts[r.id] || 0, tz), days: left };
  });

  readRows_(signups).forEach((s, i) => {
    const jam = due[String(s.event_id).trim()];
    if (!jam || isYes_(s.is_cancelled) || /^cancell?ed$/i.test(String(s.status))) return;
    const col = headers.indexOf('reminded_' + jam.days + 'd');
    if (col === -1 || String(s['reminded_' + jam.days + 'd']).trim()) return;      // already reminded
    if (s.timestamp instanceof Date && Utilities.formatDate(s.timestamp, tz, 'yyyy-MM-dd') >= today) return; // signed up today: the confirmation is enough
    const who = { name: s.name, phone: s.phone, jam: jam };
    const email = String(s.email || '').trim();
    if (!isEmail_(email)) return result.noEmail.push(who);
    if (dryRun) return result.sent.push(who);
    try {
      if (MailApp.getRemainingDailyQuota() < 2) throw new Error('daily email limit reached');
      MailApp.sendEmail(reminderMail_(ss, jam.event, { name: s.name, email: email, paid: String(s.paid) }, jam.days));
      signups.getRange(i + 2, col + 1).setValue(now);
      result.sent.push(who);
    } catch (err) {
      console.error('reminder to ' + email + ' failed: ' + err);
      result.failed.push(Object.assign(who, { error: String(err) }));
    }
  });

  if (!dryRun) remindSummary_(ss, result);
  return result;
}

function reminderMail_(ss, event, s, days) {
  const x = jamEmailParts_(ss, event, s);
  const soon = days === 0 ? 'today' : days === 1 ? 'tomorrow' : 'in ' + days + ' days';
  const html = '<div style="font-family:sans-serif;font-size:15px;line-height:1.5;color:#1d1d1d;max-width:480px">' +
    '<p style="font-size:20px;margin:0 0 8px">hi ' + esc_(s.name) + ' ✎</p>' +
    '<p style="margin:0 0 14px">just a reminder: <b>' + esc_(event.shortTitle) + '</b> is <b>' + soon + '</b>!</p>' +
    x.tableHtml +
    '<p style="margin:16px 0 0;padding:10px 12px;background:#fff3a8;border:2px dashed #e0a800;border-radius:10px">' +
    '<b>can\'t make it?</b> please tell me asap on ' + x.contactHtml('DM me') + ' so someone else can take ur spot 🙏</p>' +
    '<p style="margin:12px 0 0"><b>questions? ask me anything</b> ✎</p>' +
    '<p style="margin:16px 0 0">see u soon,<br>laidoodle 来涂鸦</p></div>';
  const text = 'hi ' + s.name + ' ✎\n\njust a reminder: ' + event.shortTitle + ' is ' + soon + '!\n\n' +
    x.tableText +
    "\n\n‼ can't make it? please tell me asap on " + x.contactText + ' so someone else can take ur spot 🙏' +
    '\nquestions? ask me anything ✎\n\nsee u soon,\nlaidoodle 来涂鸦';
  const mail = {
    to: s.email,
    subject: (days === 1 ? '✎ see u tomorrow: ' : days === 0 ? '✎ see u today: ' : '✎ ' + days + ' days to go: ') +
      event.shortTitle + ' · ' + event.dayLabel + ', ' + longDate_(event.date),
    body: text,
    htmlBody: html,
    name: 'laidoodle',
  };
  if (x.replyTo) mail.replyTo = x.replyTo;
  return mail;
}

// One email to you on days reminders go out: who got one, and who has no email (message them yourself).
function remindSummary_(ss, r) {
  try {
    if (!r.sent.length && !r.noEmail.length && !r.failed.length) return;
    const to = String(settingsMap_(ss).notify_email || '').trim() || Session.getEffectiveUser().getEmail();
    if (!to || /^(off|no|n|none)$/i.test(to)) return;
    const jamName = j => j.event.shortTitle + ' (' + (j.days === 1 ? 'tomorrow' : j.days + ' days to go') + ')';
    const groups = {};
    ['sent', 'noEmail', 'failed'].forEach(kind => r[kind].forEach(w => {
      const g = groups[w.jam.event.id] = groups[w.jam.event.id] || { jam: w.jam, sent: [], noEmail: [], failed: [] };
      g[kind].push(w);
    }));
    const person = w => esc_(w.name) + (String(w.phone).trim() ? ' · <a href="' + esc_(waLink_(w.phone)) + '">WhatsApp ' + esc_(w.phone) + '</a>' : '');
    let html = '<div style="font-family:sans-serif;font-size:15px;color:#1d1d1d">';
    let text = '';
    Object.keys(groups).forEach(id => {
      const g = groups[id];
      html += '<p style="font-size:17px;margin:14px 0 4px">✎ <b>' + esc_(jamName(g.jam)) + '</b></p>';
      text += jamName(g.jam) + '\n';
      if (g.sent.length) {
        html += '<p style="margin:0">sent ' + g.sent.length + ' reminder' + (g.sent.length > 1 ? 's' : '') + ': ' + g.sent.map(w => esc_(w.name)).join(', ') + '</p>';
        text += 'sent ' + g.sent.length + ': ' + g.sent.map(w => w.name).join(', ') + '\n';
      }
      if (g.noEmail.length) {
        html += '<p style="margin:6px 0 0"><b>no email for these, message them yourself:</b><br>' + g.noEmail.map(person).join('<br>') + '</p>';
        text += 'no email, message them yourself: ' + g.noEmail.map(w => w.name + (String(w.phone).trim() ? ' (' + waLink_(w.phone) + ')' : '')).join(', ') + '\n';
      }
      if (g.failed.length) {
        html += '<p style="margin:6px 0 0;color:#b00020"><b>couldn\'t send to:</b> ' + g.failed.map(w => esc_(w.name) + ' (' + esc_(w.error) + ')').join(', ') + '</p>';
        text += "couldn't send to: " + g.failed.map(w => w.name + ' (' + w.error + ')').join(', ') + '\n';
      }
      text += '\n';
    });
    html += '<p><a href="' + ss.getUrl() + '">open the sheet</a></p></div>';
    MailApp.sendEmail({ to: to, subject: '✎ reminders sent: ' + Object.keys(groups).map(id => groups[id].jam.event.shortTitle).join(', '), body: text, htmlBody: html, name: 'laidoodle' });
  } catch (err) {
    console.error('reminder summary failed: ' + err);
  }
}

// Run this from the Apps Script editor: emails YOU a sample reminder for the next jam (nothing is marked
// in the sheet), and lists who would get a real reminder today.
function testReminder() {
  const ss = SpreadsheetApp.getActive();
  const tz = ss.getSpreadsheetTimeZone();
  const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const counts = signupCounts_(ss);
  const next = readRows_(ss.getSheetByName('Events'))
    .filter(r => r.id && !isHiddenRow_(r) && asDate_(r.date, tz) >= today)
    .sort((a, b) => asDate_(a.date, tz).localeCompare(asDate_(b.date, tz)))[0];
  if (!next) throw new Error('no upcoming jam in the Events tab to make a sample from');
  const event = toEvent_(next, counts[next.id] || 0, tz);
  const to = String(settingsMap_(ss).notify_email || '').trim().split(',')[0].trim() || Session.getEffectiveUser().getEmail();
  console.log('reminder_days: ' + (reminderDays_(ss).join(', ') || 'off'));
  MailApp.sendEmail(reminderMail_(ss, event, { name: 'test', email: to, paid: '' }, daysBetween_(today, event.date)));
  console.log('sample reminder for ' + event.shortTitle + ' sent to ' + to + ' ✓ (check Inbox, Spam and All Mail)');
  const r = runReminders_(true);
  console.log('today the timer would remind: ' + (r.sent.map(w => w.name + ' (' + w.jam.event.shortTitle + ')').join(', ') || 'nobody') +
    (r.noEmail.length ? ' · no email: ' + r.noEmail.map(w => w.name).join(', ') : ''));
  const timer = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'sendReminders');
  console.log(timer ? 'daily timer is on ✓' : 'daily timer is OFF: run setup to start it');
}

// Settings → reminder_days "3,1" → [3, 1]. "off" / empty → [].
function reminderDays_(ss) {
  const v = String(settingsMap_(ss).reminder_days === undefined ? '3,1' : settingsMap_(ss).reminder_days).trim();
  if (/^(off|no|n|none)?$/i.test(v)) return [];
  return v.split(/[^0-9]+/).filter(Boolean).map(Number).filter((d, i, a) => a.indexOf(d) === i);
}

function reminderColumns_(ss) {
  return reminderDays_(ss).map(d => 'reminded_' + d + 'd');
}

// One daily timer for sendReminders (re-running setup replaces it rather than adding another).
function installReminders_(ss) {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'sendReminders').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sendReminders').timeBased().everyDays(1).atHour(10).inTimezone(ss.getSpreadsheetTimeZone()).create();
}

// "2026-11-11", "2026-11-14" → 3
function daysBetween_(from, to) {
  if (!/^\d{4}-\d\d-\d\d$/.test(String(to))) return NaN;
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);
}

// WhatsApp chat link. Local Malaysian numbers ("011 3921 4061") get the 60 country code.
function waLink_(phone) {
  let d = String(phone).replace(/\D/g, '');
  if (/^0\d{8,10}$/.test(d)) d = '60' + d.slice(1);
  return 'https://wa.me/' + d;
}

function isEmail_(v) {
  return /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(String(v));
}

// "2026-11-14" → "Nov 14"
function longDate_(iso) {
  const m = String(iso).match(/^(\d{4})-(\d\d)-(\d\d)$/);
  if (!m) return String(iso);
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1] + ' ' + Number(m[3]);
}

function esc_(v) {
  return String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ---------- helpers ----------

function readRows_(sheet) {
  const values = sheet.getDataRange().getValues();
  const headers = values.shift().map(key_);
  return values.map(v => {
    const o = {};
    headers.forEach((h, i) => { o[h] = v[i] === null || v[i] === undefined ? '' : v[i]; });
    return o;
  });
}

function settingsMap_(ss) {
  const s = {};
  ss.getSheetByName('Settings').getDataRange().getValues().slice(1).forEach(r => { s[String(r[0]).trim()] = r[1]; });
  return s;
}

// Only these settings are sent to the site (receipt_folder stays private).
function readSettings_(ss) {
  const s = settingsMap_(ss);
  return {
    hostInstagram: String(s.host_instagram || ''),
    bankText: String(s.bank_text || ''),
    paymentQr: imageUrl_(String(s.payment_qr || '')),
  };
}

function signupCounts_(ss) {
  const counts = {};
  readRows_(ss.getSheetByName('Signups')).forEach(r => {
    if (!r.event_id || isYes_(r.is_cancelled) || /^cancell?ed$/i.test(String(r.status))) return;
    counts[r.event_id] = (counts[r.event_id] || 0) + 1;
  });
  return counts;
}

// Writes values under the matching header, so extra columns you add yourself are left alone.
function appendByHeader_(sheet, data) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(key_);
  const row = headers.map(h => (h in data ? safeCell_(data[h]) : ''));
  sheet.appendRow(row);
}

// Header text → the name the script uses. "isHidden? (Y/N)" → is_hidden, "isCancelled? (Y/N)" → is_cancelled,
// anything else is just lower-cased, so small spelling/spacing changes in those two headers don't matter.
function key_(header) {
  const text = String(header).trim();
  const flat = text.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (flat.indexOf('ishidden') === 0) return 'is_hidden';
  if (flat.indexOf('iscancel') === 0 || flat.indexOf('iscancl') === 0) return 'is_cancelled';
  return text.toLowerCase();
}

// Y / yes / true / ticked checkbox (and the old words "hidden" / "cancelled") count as yes.
function isYes_(v) {
  return v === true || /^(y|yes|true|hidden|cancell?ed)$/i.test(String(v).trim());
}

function isHiddenRow_(r) {
  return isYes_(r.is_hidden) || /^hidden$/i.test(String(r.status || ''));
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

// A cell of photos → image URLs. Each line is a Drive folder link (every image inside, A→Z by name)
// or a single image link. Folder listings are cached for 10 minutes so pages stay fast.
function photoList_(cell) {
  const out = [];
  lines_(cell).forEach(line => {
    const folder = line.match(/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([\w-]+)/);
    if (folder) folderImages_(folder[1]).forEach(u => out.push(u));
    else out.push(imageUrl_(line));
  });
  return out;
}

function folderImages_(id) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('photos-v2:' + id);
  if (hit) return JSON.parse(hit);
  const files = [];
  try {
    const it = DriveApp.getFolderById(id).getFiles();
    while (it.hasNext()) {
      const f = it.next();
      if (String(f.getMimeType()).indexOf('image/') !== 0) continue;
      makeViewable_(f);
      files.push({ name: f.getName(), id: f.getId() });
    }
  } catch (err) {
    return []; // wrong link or no access: show no photos rather than break the page
  }
  const urls = files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map(f => driveImage_(f.id));
  cache.put('photos-v2:' + id, JSON.stringify(urls), 600);
  return urls;
}

// Google Drive share links → direct image URLs (the file must be shared as "anyone with the link").
// Single Drive files are also switched to "anyone with the link" (checked once every 6 hours).
function imageUrl_(url) {
  const m = String(url).match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]+)/);
  if (!m) return String(url).trim();
  const cache = CacheService.getScriptCache();
  if (!cache.get('viewable:' + m[1])) {
    try { makeViewable_(DriveApp.getFileById(m[1])); } catch (err) { /* not yours or no access */ }
    cache.put('viewable:' + m[1], '1', 21600);
  }
  return driveImage_(m[1]);
}

// Visitors' browsers can only load a Drive image that is shared as "anyone with the link".
// Photo files are set that way here, so you don't have to share each one by hand.
// (Only photo files and the payment QR pass through this. Receipts never do.)
function makeViewable_(file) {
  try {
    const access = file.getSharingAccess();
    if (access !== DriveApp.Access.ANYONE && access !== DriveApp.Access.ANYONE_WITH_LINK) {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    }
  } catch (err) { /* e.g. a work/school account that blocks public sharing */ }
}

// =w1600 asks Google for a resized JPEG/PNG: loads fast and also works for iPhone HEIC photos.
function driveImage_(id) {
  return 'https://lh3.googleusercontent.com/d/' + id + '=w1600';
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
