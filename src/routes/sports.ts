import { Router } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

router.get('/sports', async (req, res) => {
  const sports = await prisma.sport.findMany({
    where: { isActive: true },
    include: { categories: { include: { tournaments: true } } }
  });
  res.json(sports);
});

router.get('/sports/tree', async (req, res) => {
  const sports = await prisma.sport.findMany({
    where: { isActive: true },
    include: { categories: { include: { tournaments: true } } }
  });
  res.json(sports);
});

router.get('/matches', async (req, res) => {
  const { tournamentId, sportId, categoryId, status } = req.query;
  const whereClause: any = {};

  if (tournamentId) {
    whereClause.tournamentId = parseInt(String(tournamentId));
  } else if (categoryId) {
    whereClause.tournament = { category: { id: parseInt(String(categoryId)) } };
  } else if (sportId) {
    whereClause.tournament = { category: { sportId: parseInt(String(sportId)) } };
  }
  if (status) {
    whereClause.status = String(status);
  } else {
    whereClause.status = { in: ['PREMATCH', 'LIVE'] };
  }

  const matches = await prisma.match.findMany({
    where: whereClause,
    include: {
      tournament: { include: { category: { include: { sport: true } } } },
      markets: {
        include: { outcomes: true },
        orderBy: { sortOrder: 'asc' }
      }
    },
    orderBy: [
      { status: 'asc' }, // LIVE first
      { startTime: 'asc' }
    ]
  });
  res.json(matches);
});

router.get('/sports/:sportId/matches', async (req, res) => {
  const { status } = req.query;
  const matches = await prisma.match.findMany({
    where: {
      tournament: { category: { sportId: parseInt(req.params.sportId) } },
      ...(status ? { status: String(status) } : { status: { in: ['PREMATCH', 'LIVE'] } })
    },
    include: { markets: { include: { outcomes: true } } }
  });
  res.json(matches);
});

router.get('/matches/:id', async (req, res) => {
  const match = await prisma.match.findUnique({
    where: { id: req.params.id },
    include: { markets: { include: { outcomes: true } } }
  });
  res.json(match);
});

router.get('/matches/:id/tracker', async (req, res) => {
  // Mock tracker response or could hook into SimulationFeed pitch states if we stored them globally
  res.json({
    matchId: req.params.id,
    message: "Subscribe to websocket 'tracker:' channel for real-time updates."
  });
});

router.get('/booking/:code', async (req, res) => {
  const ticket = await prisma.ticket.findUnique({
    where: { bookingCode: req.params.code },
    include: { lines: true }
  });
  res.json(ticket);
});

router.get('/tickets/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Search query required' });

  const query = String(q).trim().toUpperCase();

  // Search by booking code (exact match) or ticket ID (partial match)
  const ticket = await prisma.ticket.findFirst({
    where: {
      OR: [
        { bookingCode: query },
        { id: { contains: query.toLowerCase() } }
      ]
    },
    include: { lines: true, user: { select: { username: true } } }
  });

  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  res.json(ticket);
});

export default router;
