# Maati deployment guide

## Temporary Render free demo

The root [`render.yaml`](render.yaml) is configured for a short, no-cost demo using three Render Free web services:

| Service | Purpose | Health check |
| --- | --- | --- |
| `maati-web` | Next.js portal | `/` |
| `maati-api` | Fastify API and PostgreSQL access | `/api/healthz` |
| `maati-predictor` | Lightweight Flask/scikit-learn crop predictor | `/healthz` |

The free configuration uses the existing Neon PostgreSQL database; it does not create a Render database. It uses the real crop recommendation CSV and does not return mock results. TabPFN remains in `backend/ai/tabpfn_predictor.py` for the sponsor build, but the free demo runs `backend/ai/sklearn_predictor.py` because Render does not offer a free private service and the TabPFN model needs substantially more memory than a free instance provides.

The lightweight predictor is exposed as a public web service and protected by a generated bearer token shared only with the API. The API and Next.js proxy use the services' public HTTPS URLs. Free Render services cannot receive private-network traffic.

### Create the Blueprint

1. In the Render Dashboard, select **New → Blueprint**.
2. Connect `Namangoel1904/Maati` and select the `main` branch.
3. Confirm Render is using the root `render.yaml` and that **all three services show the Free plan** before creating them.
4. Provide these secrets when prompted:
   - `DATABASE_URL`: a newly rotated Neon connection string.
   - `BACKBOARD_API_KEY`: your Backboard key.
   - `GOOGLE_MAPS_API_KEY`: your Google Maps key.
5. Render generates `AUTH_SECRET` and `PREDICTOR_API_TOKEN`; Blueprint references wire the predictor token and public service URLs to their consumers.
6. Deploy the Blueprint. Watch the build and runtime logs for each service.

Do not commit secret values to Git or place them in `NEXT_PUBLIC_*` variables. The Neon connection string previously shared in chat should be rotated before deployment.

### Demo availability and monitoring

Render Free web services spin down after 15 minutes without inbound traffic and may take about a minute to start on the next request. Render grants 750 free instance-hours per workspace per calendar month; three services running continuously for 72 hours would use 216 hours. The allowance is shared with other free services in the workspace. Render can also restart free services, so this setup is suitable for a short demo rather than a production uptime commitment.

An external monitor can request these public endpoints every five minutes:

- The web service root URL (`/`).
- The API URL at `/api/healthz` (checks the database connection too).
- The predictor URL at `/healthz`.

Inbound monitoring traffic should normally prevent the idle timer from expiring, but it does not guarantee uninterrupted service. Confirm the Render workspace's spending and usage settings before deployment; free bandwidth and build limits still apply.

### Demo smoke check

After all services are live:

1. Open the web service URL and wait for its first cold start if it has idled.
2. Open the API `/api/healthz` endpoint and confirm it returns `status: ok`.
3. Open the predictor `/healthz` endpoint and confirm it returns `model: scikit-learn-demo`.
4. Create an account, save a profile, request a mission, accept it, and complete/post it.
5. Check that a seed viability request returns a model result and that an unknown crop is marked `isKnownCrop: false`.

### Limits of the free demo

- Free instances have limited CPU and memory. Model startup, first requests, and Next.js responses may be slow.
- The lightweight classifier uses only temperature and humidity from the dataset. Its result is an experimental crop-recommendation signal, not a calibrated probability of seed germination.
- The free plan is temporary and may be affected by workspace usage limits, provider maintenance, cold starts, external API availability, or the Neon connection.
- Signup currently accepts passwords of six characters or more to match the prototype. Strengthen this before public launch.

## Restore the TabPFN sponsor deployment

For the TabPFN sponsor build, use `backend/ai/tabpfn_predictor.py` and `backend/ai/requirements.txt`, configure `TABPFN_TOKEN`, and run the predictor on a paid private service with sufficient memory. Restore the private service reference in `render.yaml` only after confirming the current Render plan and cost. The prior configuration used a 2 CPU / 8 GB instance; check current pricing before enabling it.

## Desktop companion installer

Build the Windows installer from `frontend` after the deployed web app URL is known:

```powershell
npm ci
npm run desktop:win
```

The installer is written to `frontend/release/` and is ignored by Git. The desktop app defaults to `https://maati-web.onrender.com`. If Render assigns another hostname, set `MAATI_WEB_URL` for the local packaging process or update `PRODUCTION_WEB_URL` in `frontend/main.js`, then rebuild. Before distributing the installer, publish it from a stable HTTPS release location and sign it with the project's code-signing certificate.
