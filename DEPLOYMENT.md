# Maati production deployment notes

## Render services

`render.yaml` defines three services:

- `maati-api`: Fastify API; requires `DATABASE_URL`, `BACKBOARD_API_KEY`, and `GOOGLE_MAPS_API_KEY`. Render generates `AUTH_SECRET`.
- `maati-predictor`: private Flask/TabPFN service; requires `TABPFN_TOKEN` and loads the crop dataset/model during startup.
- `maati-web`: Next.js app; receives the API's private `hostport` as `MAATI_BACKEND_URL`.

All three are set to Ohio to keep the services near the existing Neon database in AWS us-east-2. The blueprint pins the API and web service at 0.5 CPU / 512 MB and the TabPFN service at 2 CPU / 8 GB. At Render's currently listed rates, that is approximately $149/month total for the three instances, before any workspace charges or taxes. Confirm the plan and price in Render before creating the Blueprint.

Before creating the Render Blueprint, connect this repository to a Git provider and add the required secrets in Render. Use a rotated Neon database credential: the prior connection string was pasted into chat and should no longer be treated as private. Keep `.env` files out of Git and never put server API keys in `NEXT_PUBLIC_*` variables.

The API initializes `backend/db/schema.sql` at startup, including the migration that restores old test-only 10-second break schedules to the three-hour default. Confirm the API health check at `/api/healthz` after the database is reachable.

## Desktop companion

The Windows x64 installer is built from `frontend` after the web service is deployed:

```powershell
npm ci
npm run desktop:win
```

The NSIS installer is written to `frontend/release`. The packaged app opens `https://maati-web.onrender.com` by default. If Render assigns a different hostname, update `PRODUCTION_WEB_URL` in `frontend/main.js` and rebuild; `MAATI_WEB_URL` can also override it on an individual machine. After installing, the profile page's **Open Desktop Companion** link launches the registered `maati://open` protocol. The user must approve the browser's external-app prompt where the browser displays one.

Before distributing the installer publicly, publish it from a stable HTTPS release location (for example, a GitHub Release), add that download link to the profile onboarding panel, and sign the Windows installer with the project's code-signing certificate. The current profile link only launches an already installed companion.

## Production checks still needed

- Attach the repository to Render and confirm the generated public web hostname; set `PRODUCTION_WEB_URL` accordingly before building the installer if it differs from the default.
- Configure all Render secrets and verify Neon connectivity from Render, not only from the developer machine.
- Confirm the TabPFN model/license download completes within the predictor service startup limits and that its health check passes.
- Run a production build and a full signup/profile/mission/post flow against the deployed services before sharing the app.
- Revisit the current six-character minimum password policy before public launch; it was kept to match the requested prototype behavior.
