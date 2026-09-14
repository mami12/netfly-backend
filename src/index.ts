import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { PORT } from './config';
import { WSService } from './services/wsService';
import { SimulationFeed } from './feeds/SimulationFeed';
import { auth, requireAdmin } from './middleware/auth';

import authRoutes from './routes/auth';
import adminRoutes from './routes/admin';
import managerRoutes from './routes/manager';
import sportsRoutes from './routes/sports';
import betsRoutes from './routes/bets';

const app = express();
const server = createServer(app);
const wsService = new WSService(server);

app.use(cors());
app.use(helmet());
app.use(compression());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/admin', auth, requireAdmin, adminRoutes);
app.use('/api/manager', auth, managerRoutes);
app.use('/api', sportsRoutes); // sports, matches, booking (publicly viewable)
app.use('/api/bets', betsRoutes);

const feed = new SimulationFeed();

feed.onOddsUpdate((delta) => {
  wsService.broadcast('odds', delta);
});
feed.onMatchEvent((event) => {
  wsService.broadcast(`match:${event.matchId}`, event);
});
feed.onPitchUpdate((state) => {
  wsService.broadcast(`tracker:${state.matchId}`, state);
});

feed.start();

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
