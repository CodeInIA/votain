import './env.js';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import verifyRouter from './routes/verify.js';

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

app.use('/api', verifyRouter);

app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Votain VC Issuer Backend is running' });
});

app.listen(Number(port), isDev ? '0.0.0.0' : '127.0.0.1', () => {
  console.log(`Server running in ${isDev ? 'DEVELOPMENT' : 'PRODUCTION'} mode on port ${port}`);
});