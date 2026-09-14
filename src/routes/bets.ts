import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { WalletService } from '../services/walletService';
import { AuthRequest, auth } from '../middleware/auth';
import { v4 as uuidv4 } from 'uuid';

const router = Router();
const prisma = new PrismaClient();

const generateBookingCode = () => uuidv4().substring(0, 6).toUpperCase();

router.post('/place', auth, async (req: AuthRequest, res) => {
  const stake = parseFloat(req.body.stake) || 0;
  const selections = req.body.selections || [];
  const ticketType = req.body.ticketType || req.body.type || (selections.length > 1 ? 'COMBO' : 'SINGLE');
  const systemType = req.body.systemType || null;
  const userId = req.user!.userId;

  if (stake < 100) {
    return res.status(400).json({ 
      error: 'Shuma minimale për të vendosur një bast është 100 Lek', 
      message: 'Shuma minimale për të vendosur një bast është 100 Lek' 
    });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.status !== 'ACTIVE') {
    return res.status(403).json({ 
      error: 'Llogaria juaj nuk është aktive ose është e pezulluar', 
      message: 'Llogaria juaj nuk është aktive ose është e pezulluar' 
    });
  }
  if (user.balance < stake) {
    return res.status(400).json({ 
      error: `Bilanci juaj nuk mjafton për këtë bast. Ju keni ${user.balance.toLocaleString()} Lek në llogari.`, 
      message: `Bilanci juaj nuk mjafton për këtë bast. Ju keni ${user.balance.toLocaleString()} Lek në llogari.` 
    });
  }

  let totalOdds = 1;
  const linesData: any[] = [];

  for (const sel of selections) {
    const outcome = await prisma.outcome.findUnique({ where: { id: sel.outcomeId }, include: { market: { include: { match: true } } } });
    if (!outcome || outcome.status !== 'ACTIVE' || outcome.market.status !== 'ACTIVE' || outcome.market.match.isSuspended) {
      return res.status(400).json({ 
        error: `Ndeshja ose kuota për "${sel.matchName || 'zgjedhjen'}" nuk është më e disponueshme`, 
        message: `Ndeshja ose kuota për "${sel.matchName || 'zgjedhjen'}" nuk është më e disponueshme` 
      });
    }
    const clientOdds = sel.oddsAtPlacement || sel.odds || outcome.odds;
    if (Math.abs(outcome.odds - clientOdds) / clientOdds > 0.1) {
      return res.status(400).json({ 
        error: 'Koeficientët kanë ndryshuar gjatë vendosjes. Ju lutem pranoni koeficientët e rinj.', 
        message: 'Koeficientët kanë ndryshuar gjatë vendosjes. Ju lutem pranoni koeficientët e rinj.' 
      });
    }

    if (ticketType === 'COMBO') totalOdds *= outcome.odds;
    else totalOdds = outcome.odds;

    linesData.push({
      matchId: outcome.market.matchId,
      marketId: outcome.marketId,
      outcomeId: outcome.id,
      outcomeName: outcome.name,
      marketName: outcome.market.name,
      matchName: `${outcome.market.match.homeTeam} vs ${outcome.market.match.awayTeam}`,
      oddsAtPlacement: outcome.odds,
      status: 'PENDING'
    });
  }

  const potentialPayout = stake * totalOdds;

  const result = await prisma.$transaction(async (tx) => {
    const updatedUser = await tx.user.update({
      where: { id: userId },
      data: { balance: { decrement: stake } }
    });
    const ticket = await tx.ticket.create({
      data: {
        userId,
        stake,
        potentialPayout,
        totalOdds,
        ticketType,
        systemType,
        status: 'PENDING',
        lines: { create: linesData }
      },
      include: { lines: true }
    });
    await tx.transaction.create({
      data: {
        userId,
        amount: -stake,
        type: 'BET_PLACED',
        referenceId: ticket.id,
        balanceAfter: updatedUser.balance
      }
    });
    return ticket;
  });

  res.json(result);
});

router.post('/book', async (req, res) => {
  const stake = parseFloat(req.body.stake) || 0;
  const selections = req.body.selections || [];
  const ticketType = req.body.ticketType || req.body.type || (selections.length > 1 ? 'COMBO' : 'SINGLE');
  const systemType = req.body.systemType || null;
  
  if (stake < 100) {
    return res.status(400).json({ 
      error: 'Shuma minimale për të prenotuar një skedinë është 100 Lek', 
      message: 'Shuma minimale për të prenotuar një skedinë është 100 Lek' 
    });
  }
  let totalOdds = 1;
  const linesData: any[] = [];

  for (const sel of selections) {
    const outcome = await prisma.outcome.findUnique({ where: { id: sel.outcomeId }, include: { market: { include: { match: true } } } });
    if (!outcome) return res.status(400).json({ error: 'Selection invalid' });
    
    if (ticketType === 'COMBO') totalOdds *= outcome.odds;
    else totalOdds = outcome.odds;

    linesData.push({
      matchId: outcome.market.matchId,
      marketId: outcome.marketId,
      outcomeId: outcome.id,
      outcomeName: outcome.name,
      marketName: outcome.market.name,
      matchName: `${outcome.market.match.homeTeam} vs ${outcome.market.match.awayTeam}`,
      oddsAtPlacement: outcome.odds,
      status: 'PENDING'
    });
  }

  const potentialPayout = stake * totalOdds;
  const bookingCode = generateBookingCode();

  const ticket = await prisma.ticket.create({
    data: {
      bookingCode,
      stake,
      potentialPayout,
      totalOdds,
      ticketType,
      systemType: systemType || undefined,
      status: 'PENDING',
      lines: { create: linesData }
    },
    include: { lines: true }
  });

  res.json({ bookingCode, ticket });
});

router.get('/active', auth, async (req: AuthRequest, res) => {
  const tickets = await prisma.ticket.findMany({
    where: { userId: req.user!.userId, status: 'PENDING' },
    include: { lines: true }
  });
  res.json(tickets);
});

router.get('/history', auth, async (req: AuthRequest, res) => {
  const tickets = await prisma.ticket.findMany({
    where: { userId: req.user!.userId, status: { not: 'PENDING' } },
    include: { lines: true },
    take: 50,
    orderBy: { placedAt: 'desc' }
  });
  res.json(tickets);
});

router.post('/cashout/:ticketId', auth, async (req: AuthRequest, res) => {
  const ticketId = req.params.ticketId;
  const ticket = await prisma.ticket.findUnique({ 
    where: { id: ticketId, userId: req.user!.userId },
    include: { user: true }
  });
  
  if (!ticket || ticket.status !== 'PENDING') return res.status(400).json({ error: 'Invalid ticket' });

  const reducedPayout = ticket.potentialPayout * 0.7;

  await prisma.$transaction(async (tx) => {
    await tx.ticket.update({
      where: { id: ticket.id },
      data: { status: 'WON', potentialPayout: reducedPayout, settledAt: new Date() }
    });
    await WalletService.creditWinnings(ticket.userId!, reducedPayout, ticket.id);

    if (ticket.user?.managerId) {
      const updatedMgr = await tx.user.update({
        where: { id: ticket.user.managerId },
        data: { balance: { decrement: reducedPayout } }
      });
      await tx.transaction.create({
        data: {
          userId: ticket.user.managerId,
          amount: -reducedPayout,
          type: 'MANAGER_PAYOUT_DEDUCTION',
          referenceId: ticket.id,
          balanceAfter: updatedMgr.balance,
          description: `Pagesë për Cashout të skedinës së lojtarit ${ticket.user.username} (#${ticket.id.substring(0, 8)})`
        }
      });
    }
  });

  res.json({ success: true, amount: reducedPayout });
});

export default router;
