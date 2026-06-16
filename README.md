# CrownGrid 👑

A free, **unlimited** "Queens-style" crown-placement logic puzzle — pure static
HTML/CSS/JS, no build step, no backend, no login. Built as the fast-to-launch,
ad-monetizable web puzzle from the market research (the "unlimited / no-login"
niche + SEO content + display ads).

## What's inside

```
crowngrid/
├── index.html        # Landing hub (hero, SEO copy, FAQ, schema.org markup)
├── play.html         # The game
├── how-to-play.html  # SEO content / strategy guide
├── css/style.css     # All styling (mobile-first, responsive)
├── js/generator.js   # Puzzle generator + solver (guarantees unique solutions)
├── js/game.js        # UI, input, win detection, streaks/stats (localStorage)
├── robots.txt
└── sitemap.xml
```

## Run locally

It's fully static. Either open `index.html` directly, or serve it (recommended,
so relative paths + localStorage behave like production):

```bash
cd crowngrid
python3 -m http.server 8000
# open http://localhost:8000
```

## How the puzzle engine works (`js/generator.js`)

1. **Solution** — a random permutation of columns where consecutive rows differ
   by ≥2 columns (guarantees one crown per row/column and no two touching).
2. **Regions** — each crown seeds one region; cells are grown outward randomly
   into N contiguous colored regions (so each region holds exactly one crown).
3. **Uniqueness** — a backtracking solver counts solutions; layouts are
   regenerated until the board has exactly **one** logical solution.

The **Daily Challenge** is seeded by the UTC date (`mulberry32` PRNG), so every
player gets the same board; **New puzzle** uses `Math.random` for unlimited play.

## Deploy (fastest paths — all free tiers)

- **Netlify / Vercel / Cloudflare Pages:** drag-and-drop the folder, or connect a
  git repo. Done in ~1 minute.
- **GitHub Pages:** push to a repo, enable Pages on the root.

Then point your domain at it. Per the research: use **one domain + subfolders**
(`yoursite.com/play`), not a domain per game.

### Before going live — checklist

1. Replace `https://example.com/` in `<link rel="canonical">`, `robots.txt`,
   and `sitemap.xml` with your real domain.
2. **Pick a final brand name** if you want extra trademark distance (the code
   uses "CrownGrid", not "Queens"). Keep the non-affiliation disclaimer.
3. **AdSense:** search for `ad-slot` / "AD SLOT" comments and paste your approved
   AdSense unit code. Start on AdSense; migrate to a higher-RPM network once
   traffic grows (target ≈100k+ pageviews/month for meaningful revenue).
4. Submit `sitemap.xml` in Google Search Console.
5. (Growth) Add daily "answer/hint" pages keyed to puzzle numbers — that's where
   the high-intent search traffic lives.

## Legal note

Game **rules/mechanics are not copyrightable** — this clone is built on original
code, original visuals, and an original name, with a non-affiliation disclaimer.
Avoid copying any other game's exact look, colors, or trademarked name. (US-centric;
verify your jurisdiction.)
