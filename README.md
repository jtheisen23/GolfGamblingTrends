# Golf Gambling Trends, Matchups and Predictions

A GHIN-powered dashboard for golf handicap trends, head-to-head matchups, form analysis, and win probability predictions.

## Project Structure

```
.
├── index.html              # Main HTML shell
├── css/
│   └── styles.css          # All styles
├── js/
│   └── app.js              # Application logic (GHIN API, charts, matchup calc)
├── package.json
└── .github/workflows/
    └── deploy.yml          # Auto-deploy to GitHub Pages on push to main
```

## Local Development

Install dependencies once:

```bash
npm install
```

Start the live-reload dev server on http://localhost:3000:

```bash
npm run dev
```

Any change to `index.html`, `css/styles.css`, or `js/app.js` will reload the browser automatically.

## Deployment

Pushing to `main` triggers the GitHub Actions workflow in `.github/workflows/deploy.yml`, which publishes the site to GitHub Pages.

**One-time setup** — in your GitHub repo settings:
1. Go to **Settings → Pages**
2. Under **Build and deployment**, set **Source** to **GitHub Actions**

After that, every push to `main` auto-deploys.

## Notes

- Connects directly to the GHIN API (`api2.ghin.com`) from the browser
- Credentials are never stored server-side; only the username is optionally saved in localStorage via "Remember me"
- Not affiliated with USGA
