import './env.js';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import verifyRouter from './routes/verify.js';
import credentialsRouter from './routes/credentials.js';
import identityRouter from './routes/identity.js';
import relayRouter from './routes/relay.js';
import organizerDomainsRouter from './routes/organizerDomains.js';
import eligibilityRouter from './routes/eligibility.js';
import enrolmentRouter from './routes/enrolment.js';
import preferencesRouter from './routes/preferences.js';

const app = express();
const port = process.env.PORT || 3000;
const isDev = process.env.NODE_ENV !== 'production';

/**
 * Who is allowed to tell us the client's address.
 *
 * NOT cosmetic, even though it surfaced as a warning in the log. Every rate
 * limit here is keyed on `req.ip`, and with no proxy trusted that is the
 * SOCKET peer. Reached through the dev tunnel, every request in the world
 * arrives from 127.0.0.1, so the whole internet shared one bucket: 120 requests
 * a minute for everybody together, and 20 for the relayer. One person refreshing
 * could lock out every voter, and the per-IP limit protected nothing.
 *
 * "loopback" rather than `true`, and the difference is the security of it.
 * `true` trusts the LEFTMOST entry of `X-Forwarded-For`, which the client
 * writes, so anyone could invent an address per request and never be limited at
 * all. Trusting loopback means we trust only a proxy running on this machine,
 * and Express then takes the rightmost entry the client could not have written:
 * the one `cloudflared` appended.
 *
 * Overridable because the right answer is the deployment's, not ours: behind
 * two proxies it is `2`, behind none `false`.
 */
function trustProxySetting(): boolean | number | string {
  const raw = process.env.TRUST_PROXY;
  if (raw === undefined || raw === '') return 'loopback';
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return /^\d+$/.test(raw) ? Number(raw) : raw;
}
app.set('trust proxy', trustProxySetting());

/**
 * Cross-origin access: OFF unless a deployment names who needs it.
 *
 * THE APP DOES NOT NEED IT. The browser calls `/api/...` on its own origin,
 * in development through the tunnel and in production on the same domain, so
 * every request the app makes is same-origin and CORS never enters into it.
 *
 * WHAT IT USED TO SAY. In development, `origin: true` with `credentials: true`,
 * which reflects back whatever `Origin` the caller sends and tells the browser
 * to include the session cookie. `SameSite=strict` means that cookie is not
 * sent cross-site anyway, so nothing was exploitable, but the pair is the
 * shape people quote as the CORS mistake and the reason it was there had gone
 * away: it dated from the frontend and the backend being two origins.
 *
 * `CORS_ORIGINS` takes a comma separated list for a deployment that really does
 * split them, and an exact allowlist with no reflection is what that gets.
 */
const corsOrigins = (process.env.CORS_ORIGINS ?? process.env.FRONTEND_URL ?? '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

if (corsOrigins.length > 0) {
  app.use(cors({ origin: corsOrigins, credentials: true }));
}

app.use(express.json());
app.use(cookieParser());

// Global API rate limit + a stricter one for the expensive verification path
app.use('/api', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));
app.use(
  '/api/verify-human',
  rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false }),
);

app.use('/api', verifyRouter);
app.use('/api', credentialsRouter);
app.use('/api', identityRouter);
app.use('/api', relayRouter);
app.use('/api', organizerDomainsRouter);
app.use('/api', eligibilityRouter);
app.use('/api', enrolmentRouter);
app.use('/api', preferencesRouter);

app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Votain VC Issuer Backend is running' });
});

/**
 * WHICH INTERFACE TO ANSWER ON, and why it is not simply "all of them".
 *
 * In production this binds to the LOOPBACK, so nothing outside the machine can
 * reach the port directly and every request has to arrive through whatever
 * terminates TLS in front of it. On a VPS with a reverse proxy beside it, that
 * is right and costs nothing.
 *
 * IN A CONTAINER IT IS WRONG, and silently so. A container's loopback is its
 * own: the process comes up, logs that it is running, and answers nobody —
 * not a published port, and not a sibling container like `dstack-ingress`,
 * which is what terminates TLS on the Phala deployment. The symptom is a
 * healthy-looking log beside a connection reset, which is a bad afternoon.
 *
 * So the address is configurable and the default is unchanged. A deployment
 * that puts this behind a proxy IN ANOTHER CONTAINER says so explicitly with
 * `BIND_ADDRESS=0.0.0.0`; the container is still not published to the outside
 * world, because the compose gives it no ports of its own.
 */
const bindAddress = process.env.BIND_ADDRESS ?? (isDev ? '0.0.0.0' : '127.0.0.1');

app.listen(Number(port), bindAddress, () => {
  console.log(
    `Server running in ${isDev ? 'DEVELOPMENT' : 'PRODUCTION'} mode on ${bindAddress}:${port}`,
  );
});