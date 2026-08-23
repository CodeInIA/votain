import './env.js';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import verifyRouter from './routes/verify.js';
import credentialsRouter from './routes/credentials.js';
import identityRouter from './routes/identity.js';
import relayRouter from './routes/relay.js';

const app = express();
const port = process.env.PORT || 3000;
const isDev = process.env.NODE_ENV !== 'production';

app.use(cors(
  isDev
    ? // Development: accept any origin (mobile, localhost, local IP)
      { origin: true, credentials: true }
    : // Production: restrict to the real frontend domain
      { origin: process.env.FRONTEND_URL, credentials: true }
));

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

app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Votain VC Issuer Backend is running' });
});

app.listen(Number(port), isDev ? '0.0.0.0' : '127.0.0.1', () => {
  console.log(`Server running in ${isDev ? 'DEVELOPMENT' : 'PRODUCTION'} mode on port ${port}`);
});