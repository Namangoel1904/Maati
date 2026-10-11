'use strict';

const crypto = require('node:crypto');
const Fastify = require('fastify');
const { pool, initializeDatabase } = require('./db');

const app = Fastify({ logger: true, trustProxy: true, bodyLimit: 12 * 1024 * 1024 });
const predictorUrl = process.env.PREDICTOR_URL || (process.env.PREDICTOR_HOSTPORT ? `http://${process.env.PREDICTOR_HOSTPORT}/predict` : 'http://127.0.0.1:5000/predict');
const predictorTimeoutMs = 180_000;
const backboardUrl = 'https://app.backboard.io/api/threads/messages';
const sessionCookie = 'maati_session';
const sessionDurationSeconds = 7 * 24 * 60 * 60;
const authSecret = process.env.AUTH_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'local-development-only-change-before-deploy');

if (!authSecret) throw new Error('AUTH_SECRET is required in production.');

const adviceSystemPrompt = [
  'You are Maati, a botanical and city-break companion. Return exactly one valid JSON object and nothing else: {"message":"string","mission_type":"string","scrapbook_badge_id":"string","transit_link":"string or null","audio_theme":"string or null"}. Do not use markdown, code fences, comments, or extra keys.',
  'Use profile preferences, user area, visit history, and current context supplied in the user message. The application separately provides three verified nearby place options; do not invent bus numbers, station names, venue details, distances, opening times, or ecological claims.',
  'Interpret localTime as the user’s local 24-hour HH:mm time. Daytime is before 17:30. If viabilityScore is at least 60 and the requested seed is confidently suitable for local ecology, suggest planting; use mission_type "plant_seed". Otherwise suggest a nature sidequest and use mission_type "nature_sidequest". In daytime, transit_link and audio_theme must be null. If a seed may harm Maharashtra ecology, recommend an indoor desk pot instead of outdoor planting.',
  'Evening is 17:30 inclusive to 19:00 exclusive. Ignore planting. Suggest a city outing that fits the user vibe and use mission_type "city_outing". Use a playful 8-bit badge id. The nearby list is chosen separately from OpenStreetMap and routing services.',
  'Late night is 19:00 or later. Keep the user indoors. Ask them to step away, have the refuel they selected or water, and take a 10-minute audio break. Use mission_type "indoor_audio_break" and a soothing audio_theme such as "lofi", "rain", "ocean", or "forest_wind". transit_link must be null.',
  'Keep the mission friendly, concise, and strictly conform to the five-field JSON schema.',
].join(' ');

const placePreferenceTags = {
  parks: '["leisure"~"park|garden|nature_reserve"]',
  cafes: '["amenity"~"cafe|ice_cream"]',
  culture: '["tourism"~"museum|gallery|attraction"]',
  markets: '["amenity"~"marketplace|food_court"]',
};
const profileSchema = {
  type: 'object', additionalProperties: false,
  required: ['area', 'city', 'transportMode', 'refuelPreference', 'vibe', 'placePreferences'],
  properties: {
    area: { type: 'string', minLength: 1, maxLength: 100 },
    city: { type: 'string', minLength: 1, maxLength: 100 },
    transportMode: { type: 'string', enum: ['ebus', 'walk', 'auto'] },
    refuelPreference: { type: 'string', enum: ['tea_coffee', 'high_protein_veg_snacks', 'cool_drinks'] },
    vibe: { type: 'string', enum: ['nature', 'urban', 'quiet'] },
    placePreferences: { type: 'array', minItems: 1, maxItems: 4, uniqueItems: true, items: { type: 'string', enum: Object.keys(placePreferenceTags) } },
  },
};

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const index = part.indexOf('=');
    if (index < 0) return [part, ''];
    let value = part.slice(index + 1);
    try { value = decodeURIComponent(value); } catch { /* Ignore malformed cookie values. */ }
    return [part.slice(0, index), value];
  }));
}

function createSession(userId) {
  const expires = Math.floor(Date.now() / 1000) + sessionDurationSeconds;
  const body = `${userId}.${expires}`;
  const signature = crypto.createHmac('sha256', authSecret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function readSession(token) {
  if (typeof token !== 'string') return null;
  const [userId, expiresText, signature, extra] = token.split('.');
  if (!userId || !expiresText || !signature || extra || !/^[0-9a-f-]{36}$/i.test(userId)) return null;
  const expires = Number(expiresText);
  if (!Number.isInteger(expires) || expires <= Math.floor(Date.now() / 1000)) return null;
  const body = `${userId}.${expires}`;
  const expected = crypto.createHmac('sha256', authSecret).update(body).digest();
  let actual;
  try { actual = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  return userId;
}

function setSessionCookie(reply, userId) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  reply.header('Set-Cookie', `${sessionCookie}=${encodeURIComponent(createSession(userId))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionDurationSeconds}${secure}`);
}

function clearSessionCookie(reply) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  reply.header('Set-Cookie', `${sessionCookie}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

async function requireAuth(request, reply) {
  const token = parseCookies(request.headers.cookie)[sessionCookie];
  const userId = readSession(token);
  if (!userId) return reply.code(401).send({ error: 'Please sign in to continue.' });
  request.userId = userId;
}

async function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = await new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (error, key) => error ? reject(error) : resolve(key)));
  return { salt, hash: derived.toString('hex') };
}

async function verifyPassword(password, salt, expectedHex) {
  const { hash } = await hashPassword(password, salt);
  const actual = Buffer.from(hash, 'hex');
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function sessionUser(row) {
  return { id: row.id, email: row.email, username: row.username };
}

function publicProfile(row) {
  if (!row) return null;
  return {
    area: row.area, city: row.city, transportMode: row.transport_mode,
    refuelPreference: row.refuel_preference, vibe: row.vibe, placePreferences: row.place_preferences || [],
  };
}

function buildMapsUrl(origin, destination, transportMode) {
  const travelmode = transportMode === 'walk' ? 'walking' : transportMode === 'auto' ? 'driving' : 'transit';
  const params = new URLSearchParams({ api: '1', origin, destination, travelmode });
  return `https://www.google.com/maps/dir/?${params}`;
}

async function geocodeLocation(locationString) {
  const queries = [...new Set([locationString.trim(), ...locationString.split(',').map(part => part.trim()).filter(Boolean)])];
  for (const query of queries) {
    const params = new URLSearchParams({ name: query, count: '1' });
    const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Open-Meteo geocoding returned HTTP ${response.status}`);
    const payload = await response.json();
    const place = payload?.results?.[0];
    if (place && Number.isFinite(place.latitude) && Number.isFinite(place.longitude)) return { latitude: place.latitude, longitude: place.longitude };
  }
  const error = new Error('No matching location was found. Try a nearby city or region.');
  error.statusCode = 404;
  throw error;
}

async function fetchLiveWeather(lat, lon) {
  const params = new URLSearchParams({ latitude: String(lat), longitude: String(lon), current: 'temperature_2m,relative_humidity_2m' });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Open-Meteo returned HTTP ${response.status}`);
  const payload = await response.json();
  const temperature = payload?.current?.temperature_2m;
  const humidity = payload?.current?.relative_humidity_2m;
  if (!Number.isFinite(temperature) || !Number.isFinite(humidity)) throw new Error('Open-Meteo response is missing valid current weather values');
  return { temperature, humidity };
}

function distanceInKm(fromLat, fromLon, toLat, toLon) {
  const radians = degrees => degrees * Math.PI / 180;
  const dLat = radians(toLat - fromLat);
  const dLon = radians(toLon - fromLon);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(fromLat)) * Math.cos(radians(toLat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getPlaceCategory(tags = {}) {
  if (tags.leisure) return tags.leisure.replaceAll('_', ' ');
  if (tags.tourism) return tags.tourism.replaceAll('_', ' ');
  return tags.amenity?.replaceAll('_', ' ') || 'local place';
}

function activitiesForCategory(category, profile) {
  if (/park|garden|nature reserve/.test(category)) return ['Take an easy walk', 'Find a shady place to rest', 'Notice three plants or birds'];
  if (/cafe|ice cream|restaurant|food court|market/.test(category)) {
    const refuel = profile.refuel_preference === 'high_protein_veg_snacks'
      ? 'Look for a vegetarian protein snack such as paneer or soya if the venue offers one'
      : profile.refuel_preference === 'cool_drinks' ? 'Pick a cool drink if you feel like one' : 'Enjoy a tea or coffee break';
    return [refuel, 'Take a short walk away from your screen'];
  }
  if (/museum|gallery|attraction/.test(category)) return ['Explore one exhibit or landmark', 'Take a photo of a detail you like'];
  return ['Walk around at an easy pace', 'Take a quiet 10-minute reset'];
}

function distanceLabel(distanceKm) {
  return `${distanceKm.toFixed(1)} km direct distance`;
}

async function getTransitGuide(origin, destination, transportMode) {
  const directionsUrl = buildMapsUrl(origin, destination, transportMode);
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return { directionsUrl, routeDuration: null, transitLegs: [], transitAlternatives: [] };
  const travelMode = transportMode === 'walk' ? 'WALK' : transportMode === 'auto' ? 'DRIVE' : 'TRANSIT';
  try {
    const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'routes.duration,routes.legs.steps.travelMode,routes.legs.steps.transitDetails.stopDetails,routes.legs.steps.transitDetails.transitLine',
      },
      body: JSON.stringify({
        origin: { address: origin }, destination: { address: destination }, travelMode,
        ...(travelMode === 'TRANSIT' ? {
          computeAlternativeRoutes: true,
          transitPreferences: { routingPreference: 'FEWER_TRANSFERS', ...(transportMode === 'ebus' ? { allowedTravelModes: ['BUS'] } : {}) },
        } : {}),
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      app.log.warn({ statusCode: response.status, responseText: await response.text().catch(() => '') }, 'Route details unavailable; using Maps directions link');
      return { directionsUrl, routeDuration: null, transitLegs: [], transitAlternatives: [] };
    }
    const payload = await response.json();
    const routes = (payload?.routes || []).map(route => {
      const legs = (route?.legs || []).flatMap(leg => (leg.steps || [])
        .filter(step => step.travelMode === 'TRANSIT' && step.transitDetails)
        .map(step => {
          const details = step.transitDetails;
          return {
            mode: details.transitLine?.vehicle?.type?.toLowerCase().replaceAll('_', ' ') || 'public transit',
            line: details.transitLine?.nameShort || details.transitLine?.name || null,
            boardAt: details.stopDetails?.departureStop?.name || null,
            getOffAt: details.stopDetails?.arrivalStop?.name || null,
          };
        }));
      const seconds = Number.parseInt(String(route?.duration || '').replace(/s$/, ''), 10);
      return { duration: Number.isFinite(seconds) ? `${Math.floor(seconds / 60)} min` : null, legs };
    });
    const primary = routes[0] || { duration: null, legs: [] };
    return { directionsUrl, routeDuration: primary.duration, transitLegs: primary.legs, transitAlternatives: routes.filter(route => route.legs.length) };
  } catch (error) {
    app.log.warn({ err: error }, 'Route lookup failed; using Maps directions link');
    return { directionsUrl, routeDuration: null, transitLegs: [], transitAlternatives: [] };
  }
}

async function getProfile(userId) {
  const result = await pool.query('SELECT * FROM user_profiles WHERE user_id = $1', [userId]);
  return result.rows[0] || null;
}

async function getCurrentItinerary(userId) {
  const result = await pool.query(
    `SELECT id, mission_type, message, badge_id, status, itinerary, created_at
     FROM missions WHERE user_id = $1 AND status IN ('accepted', 'completed') AND itinerary IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`, [userId],
  );
  if (!result.rowCount) return null;
  return { missionId: result.rows[0].id, ...result.rows[0].itinerary, missionType: result.rows[0].mission_type, message: result.rows[0].message, status: result.rows[0].status };
}

function publicPost(row) {
  return {
    id: row.id,
    username: row.username,
    initials: row.username.slice(0, 2).toUpperCase(),
    city: row.city,
    timeLabel: new Date(row.created_at).toLocaleString(),
    mission: row.mission,
    caption: row.caption || '',
    badgeId: row.badge_id,
    photoUrl: row.photo_mime ? `/api/posts/${row.id}/photo` : null,
    photoLabel: row.photo_label,
    photoEmoji: row.photo_emoji,
    photoTone: row.photo_tone,
    isMine: row.is_mine === true,
    reactions: { sprouted: Number(row.sprouted_count) || 0, touchedGrass: Number(row.grass_count) || 0 },
    myReactions: { sprouted: row.my_sprouted === true, touchedGrass: row.my_grass === true },
  };
}

function parsePhotoData(data) {
  if (data == null) return { bytes: null, mime: null };
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(data);
  if (!match) { const error = new Error('Photo must be a base64 JPG, PNG, or WebP image.'); error.statusCode = 400; throw error; }
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 4 * 1024 * 1024) { const error = new Error('Photo must be 4 MB or smaller.'); error.statusCode = 400; throw error; }
  return { bytes, mime: match[1] };
}

app.get('/api/healthz', async (_request, reply) => {
  await pool.query('SELECT 1');
  return reply.send({ status: 'ok', database: 'connected' });
});

app.post('/api/auth/signup', {
  schema: { body: { type: 'object', additionalProperties: false, required: ['email', 'username', 'password'], properties: {
    email: { type: 'string', format: 'email', maxLength: 254 }, username: { type: 'string', minLength: 2, maxLength: 30 }, password: { type: 'string', minLength: 6, maxLength: 200 },
  } } },
}, async (request, reply) => {
  const email = request.body.email.trim().toLowerCase();
  const username = request.body.username.trim().replace(/^@/, '');
  if (!/^[a-zA-Z0-9_.-]{2,30}$/.test(username)) return reply.code(400).send({ error: 'Username must use 2–30 letters, numbers, dots, dashes, or underscores.' });
  const { salt, hash } = await hashPassword(request.body.password);
  try {
    const result = await pool.query('INSERT INTO users(email, username, password_salt, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, email, username', [email, username, salt, hash]);
    const user = sessionUser(result.rows[0]);
    setSessionCookie(reply, user.id);
    return reply.code(201).send({ user, profile: null });
  } catch (error) {
    if (error.code === '23505') return reply.code(409).send({ error: error.constraint?.includes('username') ? 'That username is already taken.' : 'That email is already registered.' });
    throw error;
  }
});

app.post('/api/auth/login', {
  schema: { body: { type: 'object', additionalProperties: false, required: ['email', 'password'], properties: {
    email: { type: 'string', format: 'email', maxLength: 254 }, password: { type: 'string', minLength: 1, maxLength: 200 },
  } } },
}, async (request, reply) => {
  const result = await pool.query('SELECT id, email, username, password_salt, password_hash FROM users WHERE email = $1', [request.body.email.trim().toLowerCase()]);
  const row = result.rows[0];
  if (!row || !(await verifyPassword(request.body.password, row.password_salt, row.password_hash))) {
    return reply.code(401).send({ error: 'Email or password is incorrect.' });
  }
  setSessionCookie(reply, row.id);
  return { user: sessionUser(row), profile: publicProfile(await getProfile(row.id)) };
});

app.post('/api/auth/logout', async (_request, reply) => {
  clearSessionCookie(reply);
  return { ok: true };
});

app.get('/api/auth/me', async request => {
  const userId = readSession(parseCookies(request.headers.cookie)[sessionCookie]);
  if (!userId) return { user: null, profile: null };
  const result = await pool.query('SELECT id, email, username FROM users WHERE id = $1', [userId]);
  if (!result.rowCount) return { user: null, profile: null };
  return { user: sessionUser(result.rows[0]), profile: publicProfile(await getProfile(userId)) };
});

app.put('/api/profile', { preHandler: requireAuth, schema: { body: profileSchema } }, async (request, reply) => {
  const p = request.body;
  const result = await pool.query(
    `INSERT INTO user_profiles(user_id, area, city, transport_mode, refuel_preference, vibe, place_preferences, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,now())
     ON CONFLICT (user_id) DO UPDATE SET area=EXCLUDED.area, city=EXCLUDED.city, transport_mode=EXCLUDED.transport_mode,
       refuel_preference=EXCLUDED.refuel_preference, vibe=EXCLUDED.vibe, place_preferences=EXCLUDED.place_preferences, updated_at=now()
     RETURNING *`, [request.userId, p.area.trim(), p.city.trim(), p.transportMode, p.refuelPreference, p.vibe, JSON.stringify(p.placePreferences)],
  );
  return reply.send({ profile: publicProfile(result.rows[0]) });
});

app.get('/api/break-state', { preHandler: requireAuth }, async (request, reply) => {
  const localDate = request.query?.date;
  if (typeof localDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(localDate)) return reply.code(400).send({ error: 'A local date in YYYY-MM-DD format is required.' });
  const result = await pool.query('SELECT local_date::text AS date,next_threshold_seconds,skipped_first FROM user_break_state WHERE user_id=$1', [request.userId]);
  const row = result.rows[0];
  if (!row || row.date !== localDate) return { date: localDate, nextThreshold: 10_800, skippedFirst: false };
  return { date: row.date, nextThreshold: row.next_threshold_seconds, skippedFirst: row.skipped_first };
});

app.put('/api/break-state', {
  preHandler: requireAuth,
  schema: { body: { type: 'object', additionalProperties: false, required: ['date','nextThreshold','skippedFirst'], properties: {
    date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, nextThreshold: { type: 'integer', minimum: 0, maximum: 86400 }, skippedFirst: { type: 'boolean' },
  } } },
}, async request => {
  const { date, nextThreshold, skippedFirst } = request.body;
  await pool.query(
    `INSERT INTO user_break_state(user_id,local_date,next_threshold_seconds,skipped_first,updated_at)
     VALUES($1,$2::date,$3,$4,now()) ON CONFLICT(user_id) DO UPDATE SET local_date=EXCLUDED.local_date,
       next_threshold_seconds=EXCLUDED.next_threshold_seconds,skipped_first=EXCLUDED.skipped_first,updated_at=now()`,
    [request.userId, date, nextThreshold, skippedFirst],
  );
  return { date, nextThreshold, skippedFirst };
});

app.put('/api/screen-time', {
  preHandler: requireAuth,
  schema: { body: { type: 'object', additionalProperties: false, required: ['date','activeSeconds'], properties: {
    date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, activeSeconds: { type: 'integer', minimum: 0, maximum: 86400 },
  } } },
}, async request => {
  const { date, activeSeconds } = request.body;
  await pool.query(
    `INSERT INTO user_screen_time_daily(user_id,local_date,active_seconds,updated_at)
     VALUES($1,$2::date,$3,now()) ON CONFLICT(user_id,local_date) DO UPDATE SET active_seconds=EXCLUDED.active_seconds,updated_at=now()`,
    [request.userId, date, activeSeconds],
  );
  return { date, activeSeconds };
});

app.get('/api/me', { preHandler: requireAuth }, async request => {
  const [userResult, profile, itinerary, currentMission, completed, cities, badges, completedDays] = await Promise.all([
    pool.query('SELECT id, email, username FROM users WHERE id=$1', [request.userId]),
    getProfile(request.userId),
    getCurrentItinerary(request.userId),
    pool.query(`SELECT id,mission_type,message,badge_id,status,created_at FROM missions WHERE user_id=$1 AND status='accepted' ORDER BY created_at DESC LIMIT 1`, [request.userId]),
    pool.query(`SELECT count(*)::int AS breaks, count(*) FILTER (WHERE mission_type='plant_seed')::int AS seeds FROM missions WHERE user_id=$1 AND status='completed'`, [request.userId]),
    pool.query(`SELECT count(DISTINCT city)::int AS count FROM community_posts WHERE user_id=$1`, [request.userId]),
    pool.query('SELECT badge_id AS id,title,condition,pixel,tone,unlocked_at FROM scrapbook_badges WHERE user_id=$1 ORDER BY unlocked_at DESC', [request.userId]),
    pool.query(`SELECT DISTINCT to_char(completed_at::date,'YYYY-MM-DD') AS day FROM missions WHERE user_id=$1 AND status='completed' AND completed_at >= current_date - interval '31 days' ORDER BY day DESC`, [request.userId]),
  ]);
  const completedDaySet = new Set(completedDays.rows.map(row => row.day));
  const today = new Date().toISOString().slice(0, 10);
  const yesterdayDate = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  let cursor = completedDaySet.has(today) ? new Date(`${today}T00:00:00Z`) : new Date(`${yesterdayDate}T00:00:00Z`);
  let streak = 0;
  while (completedDaySet.has(cursor.toISOString().slice(0, 10))) { streak += 1; cursor = new Date(cursor.getTime() - 86_400_000); }
  return {
    user: userResult.rows[0] ? sessionUser(userResult.rows[0]) : null,
    profile: publicProfile(profile),
    itinerary,
    currentMission: currentMission.rows[0] ? {
      missionId: currentMission.rows[0].id, missionType: currentMission.rows[0].mission_type,
      message: currentMission.rows[0].message, badgeId: currentMission.rows[0].badge_id,
      status: currentMission.rows[0].status, createdAt: currentMission.rows[0].created_at,
    } : null,
    stats: { streak, seedsPlanted: completed.rows[0]?.seeds || 0, citiesExplored: cities.rows[0]?.count || 0, breaksCompleted: completed.rows[0]?.breaks || 0 },
    badges: badges.rows.map(row => ({ id: row.id, title: row.title, condition: row.condition, pixel: row.pixel, tone: row.tone, unlockedAt: row.unlocked_at })),
  };
});

app.get('/api/feed', { preHandler: requireAuth }, async request => {
  const rows = await pool.query(
    `SELECT p.*, u.username,
       count(r.*) FILTER (WHERE r.reaction='sprouted')::int AS sprouted_count,
       count(r.*) FILTER (WHERE r.reaction='touched_grass')::int AS grass_count,
       bool_or(r.user_id=$1 AND r.reaction='sprouted') AS my_sprouted,
       bool_or(r.user_id=$1 AND r.reaction='touched_grass') AS my_grass,
       (p.user_id=$1) AS is_mine
     FROM community_posts p JOIN users u ON u.id=p.user_id
     LEFT JOIN post_reactions r ON r.post_id=p.id
     GROUP BY p.id,u.username ORDER BY p.created_at DESC LIMIT 50`, [request.userId],
  );
  return { posts: rows.rows.map(publicPost) };
});

app.post('/api/posts/:postId/reactions', {
  preHandler: requireAuth,
  schema: {
    params: { type: 'object', required: ['postId'], properties: { postId: { type: 'string', format: 'uuid' } } },
    body: { type: 'object', additionalProperties: false, required: ['reaction'], properties: { reaction: { type: 'string', enum: ['sprouted', 'touched_grass'] } } },
  },
}, async (request, reply) => {
  const { postId } = request.params;
  const { reaction } = request.body;
  const exists = await pool.query('SELECT 1 FROM community_posts WHERE id=$1', [postId]);
  if (!exists.rowCount) return reply.code(404).send({ error: 'Post not found.' });
  const prior = await pool.query('DELETE FROM post_reactions WHERE post_id=$1 AND user_id=$2 AND reaction=$3 RETURNING 1', [postId, request.userId, reaction]);
  if (!prior.rowCount) await pool.query('INSERT INTO post_reactions(post_id,user_id,reaction) VALUES ($1,$2,$3)', [postId, request.userId, reaction]);
  const counts = await pool.query(`SELECT count(*) FILTER (WHERE reaction='sprouted')::int AS sprouted, count(*) FILTER (WHERE reaction='touched_grass')::int AS touched_grass FROM post_reactions WHERE post_id=$1`, [postId]);
  return { reactions: { sprouted: counts.rows[0].sprouted, touchedGrass: counts.rows[0].touched_grass }, active: !prior.rowCount };
});

app.get('/api/posts/:postId/photo', {
  preHandler: requireAuth,
  schema: { params: { type: 'object', required: ['postId'], properties: { postId: { type: 'string', format: 'uuid' } } } },
}, async (request, reply) => {
  const result = await pool.query('SELECT photo_data,photo_mime FROM community_posts WHERE id=$1', [request.params.postId]);
  if (!result.rowCount || !result.rows[0].photo_data) return reply.code(404).send({ error: 'Post photo not found.' });
  return reply.header('Content-Type', result.rows[0].photo_mime).header('Cache-Control', 'private, max-age=3600').send(result.rows[0].photo_data);
});

app.put('/api/posts/:postId', {
  preHandler: requireAuth,
  schema: {
    params: { type: 'object', required: ['postId'], properties: { postId: { type: 'string', format: 'uuid' } } },
    body: { type: 'object', additionalProperties: false, required: ['caption'], properties: {
      caption: { type: 'string', maxLength: 500 }, photoData: { type: ['string', 'null'], maxLength: 5_600_000 },
    } },
  },
}, async (request, reply) => {
  const { bytes, mime } = parsePhotoData(request.body.photoData);
  const updated = await pool.query(
    `UPDATE community_posts SET caption=$3, photo_data=COALESCE($4,photo_data), photo_mime=COALESCE($5,photo_mime)
     WHERE id=$1 AND user_id=$2 RETURNING id`,
    [request.params.postId, request.userId, request.body.caption.trim(), bytes, mime],
  );
  if (!updated.rowCount) return reply.code(404).send({ error: 'Your post was not found.' });
  return { ok: true };
});

app.post('/api/places/recommend', {
  preHandler: requireAuth,
  schema: { body: { type: 'object', additionalProperties: false, properties: {} } },
}, async (request, reply) => {
  try {
    const profile = await getProfile(request.userId);
    if (!profile) return reply.code(409).send({ error: 'Complete your profile before finding nearby places.' });
    const origin = `${profile.area}, ${profile.city}`;
    const { latitude, longitude } = await geocodeLocation(origin);
    const preferences = profile.place_preferences || ['parks', 'cafes'];
    const tags = [...new Set(preferences)].map(key => placePreferenceTags[key]).filter(Boolean);
    const selectors = tags.map(tag => `nwr(around:5000,${latitude},${longitude})${tag};`).join('');
    const query = `[out:json][timeout:18];(${selectors});out center tags;`;
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST', headers: {
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        accept: 'application/json',
        // Overpass asks applications to identify themselves instead of using a generic client UA.
        'user-agent': 'Maati/1.0 (nearby break place recommendations)',
      },
      body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(22_000),
    });
    if (!response.ok) {
      const responseText = await response.text().catch(() => '<unable to read response body>');
      request.log.error({ statusCode: response.status, responseText }, 'OpenStreetMap search returned a non-success response');
      const error = new Error(response.status === 406 || response.status === 429
        ? 'The map service is temporarily busy. Please retry in about 30 seconds.'
        : `OpenStreetMap search returned HTTP ${response.status}`);
      error.statusCode = response.status === 406 || response.status === 429 ? 503 : 502;
      throw error;
    }
    const payload = await response.json();
    const recent = await pool.query(
      `SELECT DISTINCT place_id FROM (
         SELECT place_id FROM place_visits WHERE user_id=$1 AND visited_at > now()-interval '7 days'
         UNION ALL
         SELECT place_id FROM place_recommendations WHERE user_id=$1 AND recommended_at > now()-interval '7 days'
       ) recent_places`, [request.userId],
    );
    const visited = new Set(recent.rows.map(row => row.place_id));
    const unique = new Map();
    for (const item of payload?.elements || []) {
      const name = item.tags?.name;
      const lat = item.lat ?? item.center?.lat;
      const lon = item.lon ?? item.center?.lon;
      if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const id = `osm:${item.type}:${item.id}`;
      if (visited.has(id)) continue;
      const category = getPlaceCategory(item.tags);
      const distanceKm = Number(distanceInKm(latitude, longitude, lat, lon).toFixed(2));
      const pitch = profile.vibe === 'quiet' ? `A quieter ${category} break near your area.`
        : profile.vibe === 'urban' ? `A local ${category} stop for a change of scene.`
          : `A nearby ${category} stop for a little fresh air.`;
      unique.set(id, {
        id, name, shortPitch: pitch, category, latitude: lat, longitude: lon, distanceKm,
        distanceLabel: distanceLabel(distanceKm),
        suggestedActivities: activitiesForCategory(category, profile),
      });
    }
    const recommendations = [...unique.values()].sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 3);
    await Promise.all(recommendations.map(place => pool.query(
      'INSERT INTO place_recommendations(user_id,place_id,place_name,city) VALUES($1,$2,$3,$4)',
      [request.userId, place.id, place.name, profile.city],
    )));
    return { origin, recommendations, source: 'OpenStreetMap', transportMode: profile.transport_mode };
  } catch (error) {
    request.log.error({ err: error }, 'Nearby place recommendations failed');
    if (error.statusCode === 404) return reply.code(404).send({ error: error.message });
    if (error.statusCode === 503) return reply.code(503).send({ error: error.message });
    if (error.name === 'TimeoutError' || error.name === 'AbortError') return reply.code(504).send({ error: 'Nearby place search timed out. Please try again.' });
    return reply.code(502).send({ error: 'Could not find nearby places right now.' });
  }
});

app.post('/api/accept-mission', {
  preHandler: requireAuth,
  schema: { body: { type: 'object', additionalProperties: false, required: ['missionType', 'message', 'badgeId'], properties: {
    missionType: { type: 'string', enum: ['plant_seed', 'nature_sidequest', 'city_outing', 'indoor_audio_break'] },
    message: { type: 'string', minLength: 1, maxLength: 1000 }, badgeId: { type: 'string', minLength: 1, maxLength: 100 },
    place: { type: 'object', additionalProperties: false, required: ['id','name','category','latitude','longitude','distanceKm','suggestedActivities'], properties: {
      id: { type: 'string', maxLength: 150 }, name: { type: 'string', maxLength: 200 }, category: { type: 'string', maxLength: 100 },
      latitude: { type: 'number', minimum: -90, maximum: 90 }, longitude: { type: 'number', minimum: -180, maximum: 180 },
      distanceKm: { type: 'number', minimum: 0, maximum: 1000 }, distanceLabel: { type: 'string', maxLength: 100 }, shortPitch: { type: 'string', maxLength: 300 },
      suggestedActivities: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 250 } },
    } },
  } } },
}, async (request, reply) => {
  const profile = await getProfile(request.userId);
  if (!profile) return reply.code(409).send({ error: 'Complete your profile before accepting a mission.' });
  const { missionType, message, badgeId, place } = request.body;
  if (missionType === 'city_outing' && !place) return reply.code(400).send({ error: 'Choose one of the nearby places first.' });
  let itinerary = null;
  if (place) {
    const origin = `${profile.area}, ${profile.city}`;
    const destination = `${place.name}, ${profile.city}`;
    const guide = await getTransitGuide(origin, destination, profile.transport_mode);
    itinerary = {
      place, origin, city: profile.city, transportMode: profile.transport_mode,
      preparedAt: new Date().toISOString(), routeDuration: guide.routeDuration,
      transitLegs: guide.transitLegs, transitAlternatives: guide.transitAlternatives,
      directionsUrl: guide.directionsUrl,
    };
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO missions(user_id,mission_type,message,badge_id,status,place_id,itinerary)
       VALUES($1,$2,$3,$4,'accepted',$5,$6::jsonb) RETURNING id,created_at`,
      [request.userId, missionType, message, badgeId, place?.id || null, itinerary ? JSON.stringify(itinerary) : null],
    );
    const mission = inserted.rows[0];
    if (place) await client.query('INSERT INTO place_visits(user_id,place_id,place_name,city) VALUES($1,$2,$3,$4)', [request.userId, place.id, place.name, profile.city]);
    await client.query('COMMIT');
    return reply.code(201).send({ missionId: mission.id, createdAt: mission.created_at, itinerary });
  } catch (error) {
    await client.query('ROLLBACK');
    request.log.error({ err: error }, 'Could not persist accepted mission');
    return reply.code(500).send({ error: 'Could not save the accepted mission.' });
  } finally { client.release(); }
});

app.post('/api/missions/complete', {
  preHandler: requireAuth,
  schema: { body: { type: 'object', additionalProperties: false, required: ['missionId','photoLabel','photoEmoji','photoTone'], properties: {
    missionId: { type: 'string', format: 'uuid' }, photoLabel: { type: 'string', minLength: 1, maxLength: 100 },
    photoEmoji: { type: 'string', maxLength: 20 }, photoTone: { type: 'string', enum: ['leaf','sunset','sky','earth'] },
    caption: { type: 'string', maxLength: 500 }, photoData: { type: ['string', 'null'], maxLength: 5_600_000 },
  } } },
}, async (request, reply) => {
  const { bytes: photoBytes, mime: photoMime } = parsePhotoData(request.body.photoData);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE missions SET status='completed', completed_at=now() WHERE id=$1 AND user_id=$2 AND status='accepted' RETURNING *`,
      [request.body.missionId, request.userId],
    );
    if (!result.rowCount) {
      await client.query('ROLLBACK');
      // A previous request may have committed but lost its response at the proxy.
      // Return that post on retry instead of making the user think it failed.
      const existing = await client.query(
        `SELECT p.*,u.username,0::int AS sprouted_count,0::int AS grass_count,
         false AS my_sprouted,false AS my_grass,true AS is_mine
         FROM community_posts p JOIN users u ON u.id=p.user_id
         WHERE p.mission_id=$1 AND p.user_id=$2 LIMIT 1`,
        [request.body.missionId, request.userId],
      );
      if (existing.rowCount) return reply.code(200).send({ post: publicPost(existing.rows[0]) });
      return reply.code(404).send({ error: 'Accepted mission not found.' });
    }
    const mission = result.rows[0];
    const profile = await client.query('SELECT city FROM user_profiles WHERE user_id=$1', [request.userId]);
    const city = mission.itinerary?.city || profile.rows[0]?.city || 'Unknown';
    const post = await client.query(
      `INSERT INTO community_posts(user_id,mission_id,city,mission,badge_id,photo_label,photo_emoji,photo_tone,caption,photo_data,photo_mime)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [request.userId, mission.id, city, mission.message, mission.badge_id, request.body.photoLabel, request.body.photoEmoji, request.body.photoTone, request.body.caption?.trim() || '', photoBytes, photoMime],
    );
    const badgeTitle = mission.badge_id.replaceAll('_', ' ').replace(/^badge /, '').replace(/^pixel /, '');
    await client.query(
      `INSERT INTO scrapbook_badges(user_id,badge_id,title,condition,pixel,tone)
       VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,badge_id) DO NOTHING`,
      [request.userId, mission.badge_id, badgeTitle, 'Complete a Maati break mission.', request.body.photoEmoji, request.body.photoTone],
    );
    const user = await client.query('SELECT username FROM users WHERE id=$1', [request.userId]);
    await client.query('COMMIT');
    return reply.code(201).send({ post: publicPost({ ...post.rows[0], username: user.rows[0].username, sprouted_count: 0, grass_count: 0, my_sprouted: false, my_grass: false }) });
  } catch (error) {
    await client.query('ROLLBACK').catch(rollbackError => {
      request.log.error({ err: rollbackError }, 'Could not roll back mission completion transaction');
    });
    request.log.error({ err: error }, 'Could not complete mission');
    return reply.code(500).send({ error: 'Could not save the completed mission.' });
  } finally { client.release(); }
});

app.post('/api/viability', { preHandler: requireAuth, schema: { body: { type: 'object', additionalProperties: false, required: ['seedType','location'], properties: {
  seedType: { type: 'string', minLength: 1, maxLength: 80 }, location: { type: 'string', minLength: 1, maxLength: 120 },
} } } }, async (request, reply) => {
  const { seedType, location } = request.body;
  try {
    const { latitude, longitude } = await geocodeLocation(location.trim());
    const weather = await fetchLiveWeather(latitude, longitude);
    const response = await fetch(predictorUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seed_type: seedType, current_temp: weather.temperature, current_humidity: weather.humidity }),
      signal: AbortSignal.timeout(predictorTimeoutMs) });
    if (!response.ok) throw new Error(`Prediction service returned HTTP ${response.status}: ${await response.text()}`);
    const prediction = await response.json();
    const score = prediction?.score;
    if (!Number.isFinite(score) || score < 0 || score > 100) throw new Error('Prediction service returned an invalid viability index');
    return { seedType, viabilityScore: score, viabilityIndex: prediction.viability_index ?? score, rawProbability: prediction.raw_probability ?? null, isKnownCrop: prediction.is_known_crop !== false, weather };
  } catch (error) {
    request.log.error({ err: error }, 'Viability prediction failed');
    if (error.statusCode === 404) return reply.code(404).send({ error: error.message });
    if (error.name === 'TimeoutError' || error.name === 'AbortError') return reply.code(504).send({ error: 'Prediction service timed out after 180 seconds' });
    return reply.code(502).send({ error: 'Viability prediction failed' });
  }
});

app.post('/api/advice', { preHandler: requireAuth, schema: { body: { type: 'object', additionalProperties: false, required: ['seedType','location','viabilityScore','localTime','weather'], properties: {
  seedType: { type: 'string', minLength: 1, maxLength: 80 }, location: { type: 'string', minLength: 1, maxLength: 120 },
  viabilityScore: { anyOf: [{ type: 'number', minimum: 0, maximum: 100 }, { type: 'null' }] }, localTime: { type: 'string', minLength: 1, maxLength: 80 }, weather: { type: 'object', additionalProperties: true },
} } } }, async (request, reply) => {
  const apiKey = process.env.BACKBOARD_API_KEY;
  if (!apiKey) return reply.code(503).send({ error: 'Advice generation is unavailable because BACKBOARD_API_KEY is not configured.' });
  try {
    const profile = await getProfile(request.userId);
    const visited = await pool.query('SELECT place_name,city,visited_at FROM place_visits WHERE user_id=$1 ORDER BY visited_at DESC LIMIT 50', [request.userId]);
    const weatherLocation = profile ? `${profile.area}, ${profile.city}` : request.body.location;
    const coordinates = await geocodeLocation(weatherLocation);
    const currentWeather = await fetchLiveWeather(coordinates.latitude, coordinates.longitude);
    const context = {
      ...request.body,
      viabilityScore: request.body.viabilityScore,
      weather: currentWeather,
      location: weatherLocation,
      profile: profile ? {
        user_area: profile.area, city: profile.city, transport_mode: profile.transport_mode,
        refuel_preference: profile.refuel_preference, vibe: profile.vibe, place_preferences: profile.place_preferences,
      } : null,
      visited_locations: visited.rows,
    };
    const response = await fetch(backboardUrl, {
      method: 'POST', headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ content: JSON.stringify(context), system_prompt: adviceSystemPrompt, llm_provider: 'openai', model_name: 'gpt-4o', stream: false, json_output: true }),
      signal: AbortSignal.timeout(45_000),
    });
    const rawText = await response.text().catch(() => '<unable to read response body>');
    if (!response.ok) {
      request.log.error({ statusCode: response.status, responseText: rawText }, 'Backboard returned a non-success response');
      return reply.code(502).send({ error: 'Advice generation failed' });
    }
    let payload;
    try { payload = JSON.parse(rawText); } catch (error) {
      request.log.error({ err: error, responseText: rawText }, 'Backboard response was not valid JSON');
      return reply.code(502).send({ error: 'Advice generation failed' });
    }
    let advice;
    try { advice = JSON.parse(payload?.content); } catch (error) {
      request.log.error({ err: error, responseText: payload?.content }, 'Backboard message content was not valid JSON');
      return reply.code(502).send({ error: 'Advice generation failed' });
    }
    const keys = ['message','mission_type','scrapbook_badge_id','transit_link','audio_theme'];
    const exact = advice && typeof advice === 'object' && Object.keys(advice).length === keys.length && keys.every(key => Object.hasOwn(advice, key));
    if (!exact || typeof advice.message !== 'string' || typeof advice.mission_type !== 'string' || typeof advice.scrapbook_badge_id !== 'string'
      || !(advice.transit_link === null || typeof advice.transit_link === 'string') || !(advice.audio_theme === null || typeof advice.audio_theme === 'string')) {
      request.log.error({ responseText: payload?.content }, 'Backboard advice did not match schema');
      return reply.code(502).send({ error: 'Advice generation failed' });
    }
    return advice;
  } catch (error) {
    request.log.error({ err: error }, 'Backboard advice request failed');
    return reply.code(502).send({ error: 'Advice generation failed' });
  }
});

async function start() {
  try {
    const retryableDatabaseErrors = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED']);
    for (let attempt = 1; ; attempt += 1) {
      try {
        await initializeDatabase();
        break;
      } catch (error) {
        if (!retryableDatabaseErrors.has(error.code) || attempt >= 3) throw error;
        const delayMs = attempt * 1_000;
        app.log.warn({ code: error.code, attempt, retryInMs: delayMs }, 'Temporary PostgreSQL connection failure; retrying startup');
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    const address = await app.listen({ port: Number(process.env.PORT) || 3000, host: '0.0.0.0' });
    app.log.info(`Maati API ready at ${address}`);
  } catch (error) {
    app.log.error(error, 'Could not start Maati API');
    await pool.end().catch(() => {});
    process.exit(1);
  }
}

start();
