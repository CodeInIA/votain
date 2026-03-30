import './env.js';
import express from 'express';
import cors from 'cors';
import verifyRouter from './routes/verify.js';

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Routes
app.use('/api', verifyRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Votain VC Issuer Backend (Phase 2) is running' });
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
