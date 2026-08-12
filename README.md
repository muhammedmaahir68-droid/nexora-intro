# NEXORA AI Control Center

A production-ready, no-build-step futuristic dashboard for the NEXORA multi-device ecosystem concept.

## What changed

- Replaced the logo-intro-only experience with a responsive sci-fi HUD dashboard.
- Kept `nexora-logo.jpg` as the primary brand asset.
- Added modular `styles.css` and `app.js`.
- Added simulated AI transcription + intent detection.
- Added a three-node mobile device matrix with battery, connection, lock and signal telemetry.
- Added simulated global actions:
  - Unlock all nodes
  - Launch media stream
  - Run diagnostics
  - Voice feed mode
- Added a live terminal/activity log and network telemetry.
- Added mobile/tablet responsive layouts.
- Kept the project dependency-free except for Google Fonts.
- Added security-oriented Vercel headers.

> Safety boundary: this project is a UI simulation. It does not actually unlock, control, mirror, stream from, or access Android devices.

## Project structure

```text
nexora-intro-project/
├── index.html
├── styles.css
├── app.js
├── nexora-logo.jpg
├── vercel.json
├── .gitignore
└── README.md
```

## Run locally

Because this is a static app, you can open `index.html` directly. For a better local experience, use VS Code Live Server or:

```bash
python -m http.server 5500
```

Then open:

```text
http://localhost:5500
```

## Deploy to Vercel

### GitHub method

```bash
git add .
git commit -m "Upgrade NEXORA to AI control center"
git push
```

Then import the repository in Vercel.

Recommended Vercel settings:

- Framework Preset: Other
- Build Command: leave empty
- Output Directory: `.`
- Install Command: leave empty

### Vercel CLI

```bash
npm i -g vercel
vercel
vercel --prod
```

## Extending this into a real ecosystem

The current controls intentionally stop at simulation. For legitimate real-device management, connect the UI to a backend/API that authenticates each enrolled device and exposes only authorized operations. A practical architecture is:

```text
Browser Dashboard
       │
       ▼
Authenticated API / WebSocket Gateway
       │
       ├── Device registry
       ├── Telemetry service
       ├── Command queue
       └── Audit/event log
       │
       ▼
Authorized Android agent / device-management service
```

Do not place device credentials or privileged keys in browser JavaScript.
