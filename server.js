const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDb } = require('./db');

async function startServer() {
  // Initialize database first
  const db = await initDb();

  // Make db available to route modules
  global.db = db;

  const app = express();
  const PORT = process.env.PORT || 3000;

  // Middleware
  app.use(cors());
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Cooperative server is running' });
  });

  // Routes
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/members', require('./routes/members'));
  app.use('/api/admin', require('./routes/admin'));

  // Serve frontend - any non-API route returns index.html
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'Endpoint not found' });
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  app.listen(PORT, () => {
    console.log(`Cooperative server running on http://localhost:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
