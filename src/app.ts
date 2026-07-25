import express from 'express';
import healthRouter from './routes/health';
import testRouter from './routes/test';

const app = express();

// ---------------------------------------------------------------------------
// Body parsing
// ---------------------------------------------------------------------------
app.use(express.json());

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.use('/', healthRouter);        // GET /health
app.use('/api', testRouter);       // GET /api/test

// ---------------------------------------------------------------------------
// 404 catch-all
// ---------------------------------------------------------------------------
app.use((_req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

export default app;
export { app };
