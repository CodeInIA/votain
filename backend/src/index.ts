import './env.js';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import verifyRouter from './routes/verify.js';

const app = express();
const port = process.env.PORT || 3000;

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// Routes
app.use('/api', verifyRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Votain VC Issuer Backend (Phase 2) is running' });
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});