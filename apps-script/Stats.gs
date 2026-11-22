/**
 * laidoodle social stats: copies your Instagram and Threads posts and their stats into the Posts tab.
 * Paste this as a second file (Stats) in the same Apps Script project as Code.gs.
 *
 * One-time:
 *   1. Apps Script → ⚙️ Project Settings → Script Properties → add one property per account
 *      (names below), each holding that account's long-lived access token. Never put tokens in
 *      the sheet or the repo: the repo is public.
 *   2. Run testStats: it checks every token and logs what it finds, writing nothing.
 *   3. Run setup (in Code.gs): it adds the Posts columns and a weekly timer that keeps tokens fresh.
 *
 * Syncing: the dashboard's "Sync data" button opens <web app URL>?action=sync, or use the sheet's
 * laidoodle menu → Sync social stats. Both run syncSocial(). Stories are skipped (their stats only
 * last 24 hours).
 */

// Threads is switched off for now: its accounts are skipped (and their Script Properties ignored)
// until this is true.
const SYNC_THREADS = false;

const STATS_ACCOUNTS_ALL = [
  { account: '@laidoodle_ IG', prop: 'IG_LAIDOODLE_TOKEN', kind: 'ig' },
  { account: '@doodledaron IG', prop: 'IG_DOODLEDARON_TOKEN', kind: 'ig' },
  { account: '@laidoodle_ Threads', prop: 'THREADS_LAIDOODLE_TOKEN', kind: 'threads' },
  { account: '@doodledaron Threads', prop: 'THREADS_DOODLEDARON_TOKEN', kind: 'threads' },
];
const STATS_ACCOUNTS = STATS_ACCOUNTS_ALL.filter(a => SYNC_THREADS || a.kind !== 'threads');

// Posts tab columns. The sync fills the stats columns every time; it fills format and event_id only
// when they're empty, and never touches hook, first_slide or notes.
const POSTS_HEADERS = [
  'post_id', 'date', 'account', 'event_id', 'format', 'hook', 'first_slide', 'url',
  'reach', 'views', 'likes', 'comments', 'saves', 'shares', 'reposts', 'follows', 'profile_visits',
  'notes', 'caption', 'synced_at',
];
const STATS_OVERWRITE = ['date', 'account', 'url', 'reach', 'views', 'likes', 'comments', 'saves', 'shares', 'reposts', 'follows', 'profile_visits', 'caption', 'synced_at'];
const STATS_FILL_IF_EMPTY = ['format', 'event_id'];
const POST_FORMATS = ['Carousel', 'Reel', 'Photo', 'Poster', 'Video', 'Text', 'Text + photo'];

const STATS_SINCE = '2026-09-01';       // posts older than this are skipped
const SYNC_COOLDOWN_MINUTES = 2;        // the sync link is public, so it can't be run more often than this
const IG_API = 'https://graph.instagram.com';
const THREADS_API = 'https://graph.threads.net/v1.0';

// Instagram metrics differ by post type; one unsupported metric fails the whole request, so each
// type gets its own list, with a one-at-a-time fallback if Meta rejects the list.
const IG_METRICS = {
  FEED: ['reach', 'views', 'likes', 'comments', 'saved', 'shares', 'follows', 'profile_visits'],
  REELS: ['reach', 'views', 'likes', 'comments', 'saved', 'shares'],
};
const THREADS_METRICS = ['views', 'likes', 'replies', 'reposts', 'quotes', 'shares'];

// ---------- sync ----------

function syncSocial() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { ok: false, message: 'A sync is already running. Try again in a minute.' };
  try {
    const props = PropertiesService.getScriptProperties();
    const last = Number(props.getProperty('SOCIAL_LAST_SYNC') || 0);
    if (Date.now() - last < SYNC_COOLDOWN_MINUTES * 60000) {
      return { ok: true, message: 'Already synced a moment ago. Your numbers are up to date.', added: 0, updated: 0, errors: [] };
    }
    props.setProperty('SOCIAL_LAST_SYNC', String(Date.now()));

    const ss = SpreadsheetApp.getActive();
    const tz = ss.getSpreadsheetTimeZone();
    const sheet = ensureSheet_(ss, 'Posts', POSTS_HEADERS);
    upgradeHeaders_(sheet, POSTS_HEADERS, {});
    const jams = readRows_(ss.getSheetByName('Events'))
      .filter(r => r.id && !isHiddenRow_(r))
      .map(r => ({ id: String(r.id).trim(), date: asDate_(r.date, tz) }))
      .filter(j => /^\d{4}-\d\d-\d\d$/.test(j.date))
      .sort((a, b) => a.date.localeCompare(b.date));

    const posts = [];
    const errors = [];
    STATS_ACCOUNTS.forEach(a => {
      const token = props.getProperty(a.prop);
      if (!token) return; // not connected yet
      try {
        refreshTokenIfDue_(a, token);
        const fresh = props.getProperty(a.prop);
        (a.kind === 'ig' ? igPosts_(fresh, tz) : threadsPosts_(fresh, tz)).forEach(p => posts.push(Object.assign({ account: a.account }, p)));
      } catch (err) {
        errors.push(a.account + ': ' + err.message);
      }
    });

    const result = writePosts_(sheet, posts, jams, tz);
    result.errors = errors;
    result.ok = errors.length === 0;
    result.message = result.added + ' new post(s), ' + result.updated + ' updated' + (errors.length ? '. Problems: ' + errors.join('; ') : '.');
    console.log('syncSocial: ' + result.message);
    if (errors.length) mailStatsProblem_(ss, errors);
    return result;
  } finally {
    lock.releaseLock();
  }
}

// Writes by post_id: new posts get a new row, known posts get their stats refreshed.
function writePosts_(sheet, posts, jams, tz) {
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(key_);
  const col = {};
  headers.forEach((h, i) => { col[h] = i; });
  const rowOf = {};
  for (let r = 1; r < values.length; r++) {
    const id = String(values[r][col.post_id] || '').trim();
    if (id) rowOf[id] = r;
  }
  const now = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');
  let added = 0, updated = 0;
  posts.forEach(p => {
    p.synced_at = now;
    p.event_id = (jams.find(j => j.date >= p.date) || {}).id || '';
    let r = rowOf[p.post_id];
    if (r === undefined) {
      r = values.length;
      values.push(headers.map(() => ''));
      values[r][col.post_id] = p.post_id;
      rowOf[p.post_id] = r;
      added++;
    } else {
      updated++;
    }
    STATS_OVERWRITE.forEach(k => { if (k in col && p[k] !== undefined) values[r][col[k]] = p[k] === null ? '' : safeCell_(p[k]); });
    STATS_FILL_IF_EMPTY.forEach(k => { if (k in col && p[k] && !String(values[r][col[k]]).trim()) values[r][col[k]] = p[k]; });
  });
  if (values.length > 1) sheet.getRange(1, 1, values.length, headers.length).setValues(values);
  sheet.getRange(2, col.date + 1, Math.max(1, sheet.getMaxRows() - 1), 1).setNumberFormat('yyyy-mm-dd');
  return { added: added, updated: updated };
}

// ---------- Instagram ----------

function igPosts_(token, tz) {
  const out = [];
  let url = IG_API + '/me/media?fields=id,caption,media_type,media_product_type,permalink,timestamp&limit=50&access_token=' + encodeURIComponent(token);
  while (url) {
    const page = getJson_(url);
    let older = false;
    (page.data || []).forEach(m => {
      const date = Utilities.formatDate(new Date(m.timestamp), tz, 'yyyy-MM-dd');
      if (date < STATS_SINCE) { older = true; return; }
      if (m.media_product_type === 'STORY') return;
      const reel = m.media_product_type === 'REELS' || m.media_type === 'VIDEO';
      const s = metrics_(IG_API + '/' + m.id + '/insights', reel ? IG_METRICS.REELS : IG_METRICS.FEED, token);
      out.push({
        post_id: 'ig_' + m.id, date: date, url: m.permalink || '', caption: String(m.caption || '').slice(0, 300),
        format: reel ? 'Reel' : m.media_type === 'CAROUSEL_ALBUM' ? 'Carousel' : 'Photo',
        reach: s.reach, views: s.views, likes: s.likes, comments: s.comments, saves: s.saved, shares: s.shares,
        reposts: null, follows: s.follows, profile_visits: s.profile_visits,
      });
    });
    url = older ? null : (page.paging && page.paging.next) || null;
  }
  return out;
}

// ---------- Threads ----------

function threadsPosts_(token, tz) {
  const out = [];
  let url = THREADS_API + '/me/threads?fields=id,media_type,text,permalink,timestamp&limit=50&access_token=' + encodeURIComponent(token);
  while (url) {
    const page = getJson_(url);
    let older = false;
    (page.data || []).forEach(m => {
      const date = Utilities.formatDate(new Date(m.timestamp), tz, 'yyyy-MM-dd');
      if (date < STATS_SINCE) { older = true; return; }
      if (m.media_type === 'REPOST_FACADE') return; // someone else's post you reposted
      const s = metrics_(THREADS_API + '/' + m.id + '/insights', THREADS_METRICS, token);
      out.push({
        post_id: 'th_' + m.id, date: date, url: m.permalink || '', caption: String(m.text || '').slice(0, 300),
        format: m.media_type === 'TEXT_POST' ? 'Text' : m.media_type === 'CAROUSEL_ALBUM' ? 'Carousel' : m.media_type === 'VIDEO' ? 'Video' : 'Text + photo',
        reach: null, views: s.views, likes: s.likes, comments: s.replies, saves: null, shares: s.shares,
        reposts: (s.reposts || 0) + (s.quotes || 0), follows: null, profile_visits: null,
      });
    });
    url = older ? null : (page.paging && page.paging.next) || null;
  }
  return out;
}

// ---------- shared ----------

// { metric: number }. Tries the whole list, then one metric at a time if Meta rejects the list.
function metrics_(base, list, token) {
  const read = names => {
    const res = getJson_(base + '?metric=' + names.join(',') + '&access_token=' + encodeURIComponent(token));
    const o = {};
    (res.data || []).forEach(d => {
      const v = d.total_value ? d.total_value.value : d.values && d.values[0] ? d.values[0].value : null;
      o[d.name] = typeof v === 'number' ? v : null;
    });
    return o;
  };
  try {
    return read(list);
  } catch (err) {
    const o = {};
    list.forEach(n => { try { Object.assign(o, read([n])); } catch (e) { o[n] = null; } });
    return o;
  }
}

function getJson_(url) {
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  let body = {};
  try { body = JSON.parse(res.getContentText()); } catch (err) { /* not JSON */ }
  if (res.getResponseCode() >= 400 || body.error) {
    const msg = body.error ? body.error.message || JSON.stringify(body.error) : 'HTTP ' + res.getResponseCode();
    throw new Error(msg);
  }
  return body;
}

// Long-lived tokens last 60 days; refreshing resets that. Done at most once a week per account.
function refreshTokenIfDue_(a, token) {
  const props = PropertiesService.getScriptProperties();
  const key = a.prop + '_REFRESHED';
  const last = Number(props.getProperty(key) || 0);
  if (Date.now() - last < 7 * 86400000) return;
  const url = a.kind === 'ig'
    ? IG_API + '/refresh_access_token?grant_type=ig_refresh_token&access_token=' + encodeURIComponent(token)
    : 'https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=' + encodeURIComponent(token);
  try {
    const res = getJson_(url);
    if (res.access_token) props.setProperty(a.prop, res.access_token);
    props.setProperty(key, String(Date.now()));
  } catch (err) {
    // A brand-new token can't be refreshed for 24 hours; the old one still works, so just try again later.
    console.log('token refresh for ' + a.account + ' skipped: ' + err.message);
  }
}

// Weekly timer (setup starts it), so tokens stay fresh even if you don't sync for a while.
function refreshSocialTokens() {
  const props = PropertiesService.getScriptProperties();
  STATS_ACCOUNTS.forEach(a => { const t = props.getProperty(a.prop); if (t) refreshTokenIfDue_(a, t); });
}

function installStatsTimer_() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'refreshSocialTokens').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('refreshSocialTokens').timeBased().everyWeeks(1).onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(9).create();
}

// Posts tab: headers, a date format, and dropdowns for account and format.
function setupPosts_(ss) {
  const sheet = ensureSheet_(ss, 'Posts', POSTS_HEADERS);
  upgradeHeaders_(sheet, POSTS_HEADERS, {});
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(key_);
  const list = (key, items) => {
    const c = headers.indexOf(key) + 1;
    if (!c || sheet.getMaxRows() < 2) return;
    sheet.getRange(2, c, sheet.getMaxRows() - 1, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(items, true).setAllowInvalid(true).build());
  };
  list('account', STATS_ACCOUNTS_ALL.map(a => a.account));
  list('format', POST_FORMATS);
}

// At most one problem email a day, since anyone with the sync link can start a sync.
function mailStatsProblem_(ss, errors) {
  const props = PropertiesService.getScriptProperties();
  const today = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  if (props.getProperty('SOCIAL_LAST_MAIL') === today) return;
  props.setProperty('SOCIAL_LAST_MAIL', today);
  try {
    const to = String(settingsMap_(ss).notify_email || '').trim() || Session.getEffectiveUser().getEmail();
    if (!to || /^(off|no|n|none)$/i.test(to)) return;
    MailApp.sendEmail({
      to: to, name: 'laidoodle', subject: '✎ social stats sync had a problem',
      body: 'Some accounts could not be synced:\n\n' + errors.join('\n') +
        '\n\nIf a token expired, generate a new one in the Meta app dashboard and replace it in Apps Script → Project Settings → Script Properties.',
    });
  } catch (err) {
    console.error('problem email failed: ' + err);
  }
}

// The page the dashboard's "Sync data" button opens (web app URL + ?action=sync).
function syncPage_() {
  let r;
  try { r = syncSocial(); } catch (err) { r = { ok: false, message: String(err.message || err) }; }
  const html = '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<div style="font-family:sans-serif;max-width:480px;margin:48px auto;padding:0 16px;color:#1f35b3">' +
    '<h2>' + (r.ok ? '✎ synced' : 'sync finished with problems') + '</h2>' +
    '<p style="font-size:16px;line-height:1.5">' + esc_(r.message) + '</p>' +
    '<p style="font-size:16px">You can close this tab and go back to the dashboard. It reloads your numbers when you return.</p></div>';
  return HtmlService.createHtmlOutput(html).setTitle('laidoodle sync');
}

// Sheet menu: laidoodle → Sync social stats.
function onOpen() {
  SpreadsheetApp.getUi().createMenu('laidoodle').addItem('Sync social stats', 'syncSocialFromMenu').addToUi();
}

function syncSocialFromMenu() {
  const r = syncSocial();
  SpreadsheetApp.getActive().toast(r.message, 'laidoodle', 10);
}

// Checks every token without writing anything. Run it from the editor after adding tokens.
function testStats() {
  const props = PropertiesService.getScriptProperties();
  if (!SYNC_THREADS) console.log('Threads is switched off (SYNC_THREADS = false), so only Instagram is checked.');
  STATS_ACCOUNTS.forEach(a => {
    const token = props.getProperty(a.prop);
    if (!token) { console.log(a.account + ': no token yet (Script Property ' + a.prop + ')'); return; }
    try {
      const me = getJson_((a.kind === 'ig' ? IG_API : THREADS_API) + '/me?fields=username&access_token=' + encodeURIComponent(token));
      const list = getJson_((a.kind === 'ig' ? IG_API + '/me/media' : THREADS_API + '/me/threads') + '?fields=id,timestamp&limit=5&access_token=' + encodeURIComponent(token));
      console.log(a.account + ': OK, signed in as @' + me.username + ', latest posts found: ' + (list.data || []).length);
    } catch (err) {
      console.log(a.account + ': PROBLEM: ' + err.message);
    }
  });
}
