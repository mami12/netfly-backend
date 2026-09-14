import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { WalletService } from '../services/walletService';
import { BetSettler } from '../services/betSettler';

const router = Router();
const prisma = new PrismaClient();

router.get('/stats', async (req, res) => {
  const [users, tickets, managers] = await Promise.all([
    prisma.user.findMany({
      select: { id: true, username: true, role: true, balance: true, managerId: true }
    }),
    prisma.ticket.findMany({
      select: {
        id: true,
        userId: true,
        stake: true,
        potentialPayout: true,
        status: true,
        user: { select: { managerId: true } },
        lines: { select: { id: true } }
      }
    }),
    prisma.user.findMany({
      where: { role: 'MANAGER' },
      select: { id: true, username: true, balance: true }
    })
  ]);

  let totalPlayed = 0;
  let totalWon = 0;
  let totalLost = 0;
  let activeBets = 0;
  let activeStake = 0;

  let totalSingleStake = 0;
  let totalSingleCommission = 0;
  let totalDoubleStake = 0;
  let totalDoubleCommission = 0;
  let totalMultiStake = 0;
  let totalMultiCommission = 0;

  // Initialize manager map
  const managerMap = new Map<string, {
    managerId: string;
    managerUsername: string;
    managerBalance: number;
    playerCount: number;
    totalBalance: number;
    totalPlayed: number;
    totalWon: number;
    totalLost: number;
    netDifference: number;
    singleStake: number;
    singleCommission: number;
    doubleStake: number;
    doubleCommission: number;
    multiStake: number;
    multiCommission: number;
    totalCommission: number;
    cashDebt: {
      amount: number;
      direction: string;
      status: string;
    };
  }>();

  for (const m of managers) {
    managerMap.set(m.id, {
      managerId: m.id,
      managerUsername: m.username,
      managerBalance: m.balance,
      playerCount: 0,
      totalBalance: 0,
      totalPlayed: 0,
      totalWon: 0,
      totalLost: 0,
      netDifference: 0,
      singleStake: 0,
      singleCommission: 0,
      doubleStake: 0,
      doubleCommission: 0,
      multiStake: 0,
      multiCommission: 0,
      totalCommission: 0,
      cashDebt: {
        amount: Math.abs(m.balance),
        direction: m.balance >= 0 ? 'MANAGER_OWES_ADMIN' : 'ADMIN_OWES_MANAGER',
        status: m.balance >= 0 
          ? 'Menaxheri i detyrohet Adminit (Para kesh në arkë)'
          : 'Admini i detyrohet Menaxherit (Para kesh për të paguar fituesit)'
      }
    });
  }

  // Account for players
  let directPlayersCount = 0;
  let directPlayersBalance = 0;
  let directPlayed = 0;
  let directWon = 0;
  let directLost = 0;

  for (const u of users) {
    if (u.role === 'PLAYER') {
      if (u.managerId && managerMap.has(u.managerId)) {
        const mgr = managerMap.get(u.managerId)!;
        mgr.playerCount++;
        mgr.totalBalance += u.balance;
      } else {
        directPlayersCount++;
        directPlayersBalance += u.balance;
      }
    }
  }

  for (const t of tickets) {
    const linesCount = t.lines?.length || 1;

    if (t.status === 'PENDING') {
      activeBets++;
      activeStake += t.stake;
    }
    if (t.status !== 'REVERTED') {
      totalPlayed += t.stake;
      if (linesCount === 1) {
        totalSingleStake += t.stake;
        totalSingleCommission += t.stake * 0.03;
      } else if (linesCount === 2) {
        totalDoubleStake += t.stake;
        totalDoubleCommission += t.stake * 0.05;
      } else {
        totalMultiStake += t.stake;
        totalMultiCommission += t.stake * 0.07;
      }
    }
    if (t.status === 'WON') {
      totalWon += t.potentialPayout;
    }
    if (t.status === 'LOST') {
      totalLost += t.stake;
    }

    const mgrId = t.user?.managerId;
    if (mgrId && managerMap.has(mgrId)) {
      const mgr = managerMap.get(mgrId)!;
      if (t.status !== 'REVERTED') {
        mgr.totalPlayed += t.stake;
        if (linesCount === 1) {
          mgr.singleStake += t.stake;
          mgr.singleCommission += t.stake * 0.03;
        } else if (linesCount === 2) {
          mgr.doubleStake += t.stake;
          mgr.doubleCommission += t.stake * 0.05;
        } else {
          mgr.multiStake += t.stake;
          mgr.multiCommission += t.stake * 0.07;
        }
      }
      if (t.status === 'WON') mgr.totalWon += t.potentialPayout;
      if (t.status === 'LOST') mgr.totalLost += t.stake;
    } else {
      if (t.status !== 'REVERTED') directPlayed += t.stake;
      if (t.status === 'WON') directWon += t.potentialPayout;
      if (t.status === 'LOST') directLost += t.stake;
    }
  }

  const managerBreakdown = Array.from(managerMap.values()).map(m => {
    const totalComm = m.singleCommission + m.doubleCommission + m.multiCommission;
    return {
      ...m,
      netDifference: m.totalPlayed - m.totalWon,
      totalCommission: totalComm
    };
  });

  if (directPlayersCount > 0 || directPlayed > 0) {
    managerBreakdown.push({
      managerId: 'direct',
      managerUsername: 'Të Pavarur (Pa Menaxher)',
      managerBalance: 0,
      playerCount: directPlayersCount,
      totalBalance: directPlayersBalance,
      totalPlayed: directPlayed,
      totalWon: directWon,
      totalLost: directLost,
      netDifference: directPlayed - directWon,
      singleStake: 0,
      singleCommission: 0,
      doubleStake: 0,
      doubleCommission: 0,
      multiStake: 0,
      multiCommission: 0,
      totalCommission: 0,
      cashDebt: {
        amount: 0,
        direction: 'NONE',
        status: 'Nuk aplikohet'
      }
    });
  }

  const totalBalances = users.reduce((sum, u) => sum + u.balance, 0);
  const totalCommission = totalSingleCommission + totalDoubleCommission + totalMultiCommission;

  res.json({
    totalUsers: users.length,
    totalPlayers: users.filter(u => u.role === 'PLAYER').length,
    totalManagers: managers.length,
    activeBets,
    activeStake,
    totalPlayed,
    totalWon,
    totalLost,
    netDifference: totalPlayed - totalWon,
    totalBalances,
    totalCommission,
    commission: {
      single: { stake: totalSingleStake, commission: totalSingleCommission, rate: 3 },
      double: { stake: totalDoubleStake, commission: totalDoubleCommission, rate: 5 },
      multi: { stake: totalMultiStake, commission: totalMultiCommission, rate: 7 },
      totalCommission
    },
    managerBreakdown
  });
});

router.get('/users', async (req, res) => {
  const users = await prisma.user.findMany({
    select: {
      id: true, username: true, role: true, status: true, balance: true, currency: true, managerId: true, createdAt: true,
      manager: { select: { id: true, username: true } },
      tickets: {
        select: { stake: true, potentialPayout: true, status: true }
      },
      _count: { select: { managedUsers: true, tickets: true } }
    },
    orderBy: { createdAt: 'desc' }
  });

  const usersWithStats = users.map(u => {
    let totalPlayed = 0;
    let totalWon = 0;
    let totalLost = 0;

    for (const t of u.tickets) {
      if (t.status !== 'REVERTED') totalPlayed += t.stake;
      if (t.status === 'WON') totalWon += t.potentialPayout;
      if (t.status === 'LOST') totalLost += t.stake;
    }

    const { tickets, ...rest } = u;
    return {
      ...rest,
      totalPlayed,
      totalWon,
      totalLost,
      netDifference: totalPlayed - totalWon,
      totalTickets: u._count.tickets
    };
  });

  res.json(usersWithStats);
});

router.post('/users', async (req, res) => {
  const { username, password, initialBalance, role, managerId } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) return res.status(400).json({ error: 'Username already exists' });

  const hash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      username,
      passwordHash: hash,
      role: role || 'PLAYER',
      balance: initialBalance || 0,
      managerId: managerId || null
    }
  });
  res.json(user);
});

router.patch('/users/:id', async (req, res) => {
  const { username, password, role, managerId } = req.body;
  const userId = req.params.id;

  const data: any = {};
  if (username) {
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing && existing.id !== userId) return res.status(400).json({ error: 'Username already exists' });
    data.username = username;
  }
  if (password) data.passwordHash = await bcrypt.hash(password, 10);
  if (role && ['ADMIN', 'MANAGER', 'PLAYER'].includes(role)) data.role = role;
  if (managerId !== undefined) data.managerId = managerId;

  const user = await prisma.user.update({ where: { id: userId }, data });
  res.json(user);
});

router.delete('/users/:id', async (req, res) => {
  const userId = req.params.id;

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.role === 'ADMIN') return res.status(400).json({ error: 'Cannot delete admin accounts' });

  await prisma.$transaction(async (tx) => {
    if (target.role === 'MANAGER') {
      const managedUsers = await tx.user.findMany({ where: { managerId: userId } });
      for (const mu of managedUsers) {
        await tx.ticketLine.deleteMany({ where: { ticket: { userId: mu.id } } });
        await tx.ticket.deleteMany({ where: { userId: mu.id } });
        await tx.transaction.deleteMany({ where: { userId: mu.id } });
      }
      await tx.user.deleteMany({ where: { managerId: userId } });
    }

    await tx.ticketLine.deleteMany({ where: { ticket: { userId } } });
    await tx.ticket.deleteMany({ where: { userId } });
    await tx.transaction.deleteMany({ where: { userId } });
    await tx.user.delete({ where: { id: userId } });
  });

  res.json({ success: true });
});

router.patch('/users/:id/status', async (req, res) => {
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { status: req.body.status }
  });
  res.json(user);
});

router.post('/users/:id/deposit', async (req, res) => {
  const result = await WalletService.deposit(req.params.id, req.body.amount, 'Admin deposit');
  res.json(result);
});

router.post('/users/:id/withdraw', async (req, res) => {
  try {
    const result = await WalletService.withdraw(req.params.id, req.body.amount, 'Admin withdrawal');
    res.json(result);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/tickets', async (req, res) => {
  const tickets = await prisma.ticket.findMany({ 
    include: { user: true, lines: true }, 
    take: 100,
    orderBy: { placedAt: 'desc' }
  });
  res.json(tickets);
});

router.post('/tickets/:id/revert', async (req, res) => {
  const ticketId = req.params.id;

  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { user: true }
  });

  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  if (ticket.status !== 'PENDING') return res.status(400).json({ error: 'Only pending tickets can be reverted' });
  if (!ticket.userId) return res.status(400).json({ error: 'Cannot revert guest tickets' });

  await prisma.$transaction(async (tx) => {
    const updatedUser = await tx.user.update({
      where: { id: ticket.userId! },
      data: { balance: { increment: ticket.stake } }
    });

    await tx.ticket.update({
      where: { id: ticketId },
      data: { status: 'REVERTED', settledAt: new Date() }
    });

    await tx.ticketLine.updateMany({
      where: { ticketId },
      data: { status: 'VOID' }
    });

    await tx.transaction.create({
      data: {
        userId: ticket.userId!,
        amount: ticket.stake,
        type: 'TICKET_REVERT',
        referenceId: ticketId,
        balanceAfter: updatedUser.balance,
        description: 'Ticket reverted by admin'
      }
    });
  });

  res.json({ success: true, refunded: ticket.stake });
});

router.get('/matches', async (req, res) => {
  const matches = await prisma.match.findMany({ 
    include: { 
      tournament: true,
      markets: { include: { outcomes: true } }
    },
    orderBy: { startTime: 'asc' }
  });
  res.json(matches);
});

router.patch('/matches/:id/suspend', async (req, res) => {
  const match = await prisma.match.update({
    where: { id: req.params.id },
    data: { isSuspended: req.body.isSuspended }
  });
  res.json(match);
});

// Bulk adjust all odds in a match by percentage (e.g., +10%, -5%)
router.patch('/matches/:id/odds-adjust', async (req, res) => {
  const { percentage } = req.body;
  const pct = parseFloat(percentage);
  if (isNaN(pct)) return res.status(400).json({ error: 'Valid percentage required' });

  const multiplier = 1 + (pct / 100);
  const outcomes = await prisma.outcome.findMany({
    where: { market: { matchId: req.params.id } }
  });

  await prisma.$transaction(
    outcomes.map(oc => {
      const updatedOdds = Math.max(1.01, parseFloat((oc.odds * multiplier).toFixed(2)));
      return prisma.outcome.update({
        where: { id: oc.id },
        data: { odds: updatedOdds }
      });
    })
  );

  res.json({ success: true, updatedCount: outcomes.length, multiplier });
});

router.patch('/markets/:id/suspend', async (req, res) => {
  const market = await prisma.market.update({
    where: { id: req.params.id },
    data: { status: req.body.status }
  });
  res.json(market);
});

// Bulk adjust all odds in a specific market by percentage
router.patch('/markets/:id/odds-adjust', async (req, res) => {
  const { percentage } = req.body;
  const pct = parseFloat(percentage);
  if (isNaN(pct)) return res.status(400).json({ error: 'Valid percentage required' });

  const multiplier = 1 + (pct / 100);
  const outcomes = await prisma.outcome.findMany({
    where: { marketId: req.params.id }
  });

  await prisma.$transaction(
    outcomes.map(oc => {
      const updatedOdds = Math.max(1.01, parseFloat((oc.odds * multiplier).toFixed(2)));
      return prisma.outcome.update({
        where: { id: oc.id },
        data: { odds: updatedOdds }
      });
    })
  );

  res.json({ success: true, updatedCount: outcomes.length, multiplier });
});

// Suspend/Close or Activate an individual outcome (e.g., close '1', 'X', '2', 'Over', etc.)
router.patch('/outcomes/:id/suspend', async (req, res) => {
  const { status, isSuspended } = req.body;
  let newStatus = status;

  if (!newStatus) {
    if (typeof isSuspended === 'boolean') {
      newStatus = isSuspended ? 'SUSPENDED' : 'ACTIVE';
    } else {
      const current = await prisma.outcome.findUnique({ where: { id: req.params.id } });
      newStatus = current?.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';
    }
  }

  const outcome = await prisma.outcome.update({
    where: { id: req.params.id },
    data: { status: newStatus }
  });
  res.json(outcome);
});

// Update an individual outcome's odds directly OR by percentage
router.patch('/outcomes/:id/odds', async (req, res) => {
  const { odds, percentage, status } = req.body;
  const data: any = {};

  if (odds !== undefined) {
    const val = parseFloat(odds);
    if (isNaN(val) || val < 1.01) return res.status(400).json({ error: 'Odds must be at least 1.01' });
    data.odds = parseFloat(val.toFixed(2));
  } else if (percentage !== undefined) {
    const pct = parseFloat(percentage);
    if (isNaN(pct)) return res.status(400).json({ error: 'Valid percentage required' });
    const current = await prisma.outcome.findUnique({ where: { id: req.params.id } });
    if (!current) return res.status(404).json({ error: 'Outcome not found' });
    data.odds = Math.max(1.01, parseFloat((current.odds * (1 + pct / 100)).toFixed(2)));
  }

  if (status) {
    data.status = status;
  }

  const outcome = await prisma.outcome.update({
    where: { id: req.params.id },
    data
  });
  res.json(outcome);
});

router.post('/matches/:id/settle', async (req, res) => {
  await BetSettler.settleMatch(req.params.id, req.body.homeScore, req.body.awayScore);
  res.json({ success: true });
});

export default router;
