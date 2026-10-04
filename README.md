# laidoodle site

Static, mobile-first site built from the Claude Design wireframes **2a** (home), **2b** (event detail) and **2c** (sign-up form). No build step: open `index.html` or host the folder anywhere static (GitHub Pages, Netlify, etc.).

| file | screen |
| --- | --- |
| `index.html` | 2a: torn title card, keyword tapes, upcoming, past jams, FAQ |
| `event.html?id=…` | 2b: photo carousel, info rows, how it works, bring your own, sticky join bar |
| `signup.html?id=…` | 2c: 4-step form (the commitment-fee step only shows when `fee > 0`) |
| `data.js` | all jams, host IG, payment QR/bank text, sign-up endpoint |

## Editing content

Everything lives in `data.js`:

- `upcoming[]`: set `fee: 0` for a free jam (the form becomes 3 steps and drops the payment acknowledgement). Add `photos`, `mapUrl` and `howItWorksPhoto` when you have them. Until then the striped placeholders show.
- `past[]`: past jams for the swipe row.
- `payment.qrImage`: drop your QR into `assets/` and point to it.
- `signupEndpoint`: a URL that accepts a multipart POST (Formspree, Google Apps Script, …). While it's empty, the form only shows the "you're in!" screen and **sends nothing**.

Preview locally: `python3 -m http.server` in this folder, then open http://localhost:8000.
