# laidoodle 来涂鸦

just come and doodle ✎ A mobile-first site for small-circle doodle jams.

Live at **https://doodledaron.github.io/laidoodle/**

## How it works

```
 the site (GitHub Pages)  ── reads jams ──▶  Apps Script  ◀──▶  your Google Sheet
 index / event / signup   ── sends sign-ups ─▶ (Code.gs)          Events | Signups | Settings
                                                      └─ receipts ──▶ your Drive receipts folder
```

- **The Google Sheet is your admin panel.** You never need to edit code to run jams.
- **`apps-script/Code.gs`** is the only "backend": one file attached to the sheet. It hands the jams to the site and writes sign-ups into the sheet. It never sends sign-up details (phones, IGs) to the site.
- **The site** is plain HTML/CSS/JS. You only touch it to change the design or wording.

---

## One-time setup (~10 min)

1. Create a new Google Sheet (name it e.g. `laidoodle`).
2. **Extensions → Apps Script**. Delete what's there, paste in everything from [`apps-script/Code.gs`](apps-script/Code.gs), and press 💾 Save.
3. In the function dropdown at the top, pick **`setup`** and press **Run**. Google asks for permission: choose your account → *Advanced* → *Go to … (unsafe)* → *Allow*. (It says "unsafe" because the script is yours and not verified by Google. It only touches this sheet and its own Drive folder.)
   This creates the **Events**, **Signups** and **Settings** tabs (with sample jams). Running it again later is safe: it only adds what's missing.
4. **Deploy → New deployment** → ⚙️ type **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**

   Click **Deploy** and copy the **Web app URL** (ends in `/exec`).
5. Put that URL into `data.js` → `apiUrl: 'https://script.google.com/macros/s/…/exec'` and push (or send it to Claude to do it).

Until step 5 is done, the site shows sample jams and **sign-ups are not saved**.

---

## Day to day: everything happens in the sheet

Changes show up on the site the next time someone loads the page. No redeploys.

### Add / edit / remove a jam (Events tab)

| column | what to put | example |
| --- | --- | --- |
| `id` | short unique name, used in links. **Don't change it after people sign up.** | `jam-06` |
| `isHidden? (Y/N)` | `Y` takes it off the site; `N` or empty shows it (pick from the dropdown) | `N` |
| `short_title` | shown on the home list and the form | `Doodle Jam #06` |
| `title` | the big heading on the event page | `autumn leaves & lemon tea` |
| `date` | the jam's date. It moves to "past jams" automatically after this day. | `2026-11-14` |
| `start_time` / `end_time` | | `2pm` / `5pm` |
| `venue_short` | home list (keep it short) | `café TBD` |
| `venue` | event page | `Kopi Kopi, Jalan 1` |
| `map_url` | Google Maps link (optional) | |
| `fee` | RM amount. `0` = free: the site says *"just order something at the café"* and the payment step is skipped | `10` |
| `fee_includes` | paid jams only: what the fee covers, shown as "RM 10 · includes …" | `1 drink + snacks` |
| `cost_remark` | optional free text shown under the cost (event page + payment step), for anything extra | `another RM 10 will be collected at the café for food` |
| `capacity` | max people. Spots left are counted automatically. | `8` |
| `photos` | event photos, shown at the top of a **past** jam's page (not used on upcoming jams): a Google Drive **folder** link (every image in it is shown, A→Z by file name), or single image links one per line | |
| `cafe_photos` | café photos: a Drive folder link, or image links one per line. **Upcoming** jams show them as the swipe photos at the top of the page; **past** jams show them in a "the café" section below (hidden if empty). | |
| `extra_questions` | extra questions just for this jam, one per line | `dietary needs?` |
| `doodlers` | only for old jams from before sign-ups were in the sheet; otherwise leave it empty and it counts sign-ups | `9` |
| `thumbnail` | the cover picture on the home page's upcoming list and past jams: one Drive image link (a folder link uses its first image). Optional: without it, upcoming jams show no picture and past jams use the first of `photos`. | |

- **Photo folders:** just paste the folder link. The script switches each photo in it to *anyone with the link* so visitors can see it (your receipts folder is never touched). New photos you drop into a folder show up on the site within ~10 minutes.
- **Add a jam:** add a row.
- **Edit:** change the cell.
- **Remove:** set `isHidden? (Y/N)` to `Y` (better than deleting the row, because the sign-ups keep their link to it).

### Sign-ups (Signups tab)

A row is added for each person who signs up. For paid jams a receipt upload is required. It's saved in your receipts folder as **`event - name - date time`** (e.g. `Doodle Jam #05 - Ron - 2026-10-04 15.30.12.png`, same time as the `timestamp` column), and the `receipt` column links to it.

- **Someone cancels:** set their `isCancelled? (Y/N)` cell to `Y` and the spot opens up again.
- You can add your own columns (e.g. `confirmed`, `notes to self`). The script only fills in its own columns and leaves yours alone.
- Tip: **Data → Create a filter** on `event_id` shows one jam's list.

### Sign-up emails

Every new sign-up emails you the details: name, IG (tap to open), WhatsApp (tap to chat), how doodly, paid, a receipt link, their answers, and spots left. It goes to `notify_email` in Settings. Gmail lets a script send about 100 emails a day, far more than a jam needs. If an email ever fails, the sign-up is still saved.

### Confirmation email to the doodler

The form asks for an email address. Right after signing up, the person gets a "u're in!" email with when / where (with the map link) / cost / what to bring, plus: *can't make it? let me know on WhatsApp `host_whatsapp` or IG `host_instagram`*. If they reply, the reply goes to your `notify_email`.

### Settings tab

| key | value |
| --- | --- |
| `host_instagram` | `@doodledaron` |
| `bank_text` | shown under the QR on the payment step |
| `payment_qr` | Drive link to your payment QR image (shared as *anyone with the link*) |
| `receipt_folder` | Drive folder link where receipts are saved. Keep this folder's sharing **Restricted**: receipts have people's names and bank details. |
| `notify_email` | who gets an email for every new sign-up (filled with your own address by `setup`). Several addresses: separate with commas. `off` stops the emails. |
| `host_whatsapp` | your WhatsApp number (`setup` fills in `011 39214061` if empty). Shown in the confirmation email as "questions? ask me anything" and "can't make it?". Local numbers starting with 0 get Malaysia's 60 added for the chat link. `off` hides it. |

### If you edit `Code.gs` later

The live site keeps using the old version until you run **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. The URL stays the same.

---

## Files

| file | what |
| --- | --- |
| `index.html` | home: title, keyword tapes, upcoming + past jams, FAQ |
| `event.html?id=…` | event detail |
| `signup.html?id=…` | sign-up form (3 steps for free jams, 4 for paid) |
| `data.js` | `apiUrl` + sample data + small shared helpers |
| `styles.css` | all styling |
| `apps-script/Code.gs` | the Google Sheet backend |

Preview locally: `python3 -m http.server` in this folder, then open http://localhost:8000.
