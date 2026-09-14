import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { WalletService } from '../services/walletService';
import { AuthRequest, auth, requireManager } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

// Get stats for this manager (including commission and difference breakdown)
router.get('/stats', auth, requireManager, async (req: AuthRequest, res) => {
  const managerId = req.user!.userId;

  const [manager, users] = await Promise.all([
    prisma.user.findUnique({
      where: { id: managerId },
      select: { id: true, username: true, balance: true }
    }),
    prisma.user.findMany({
      where: { managerId },
      select: {
        id: true,
        username: true,
        balance: true,
        tickets: {
          select: {
            id: true,
            stake: true,
            potentialPayout: true,
            status: true,
            lines: { select: { id: true } }
          }
        }
      }
    })
  ]);

  const managerBalance = manager?.balance || 0;
  const totalPlayers = users.length;
  const totalPlayerBalance = users.reduce((sum, u) => sum + u.balance, 0);

  let totalPlayedFunds = 0;
  let totalWonFunds = 0;
  let totalLostFunds = 0;
  let totalTickets = 0;

  // Commission breakdown
  let singleStake = 0;
  let singleCount = 0;
  let singleCommission = 0;

  let doubleStake = 0;
  let doubleCount = 0;
  let doubleCommission = 0;

  let multiStake = 0;
  let multiCount = 0;
  let multiCommission = 0;

  for (const u of users) {
    for (const t of u.tickets) {
      totalTickets++;
      const linesCount = t.lines?.length || 1;

      if (t.status !== 'REVERTED') {
        totalPlayedFunds += t.stake;

        if (linesCount === 1) {
          singleStake += t.stake;
          singleCount++;
          singleCommission += t.stake * 0.03;
        } else if (linesCount === 2) {
          doubleStake += t.stake;
          doubleCount++;
          doubleCommission += t.stake * 0.05;
        } else {
          multiStake += t.stake;
          multiCount++;
          multiCommission += t.stake * 0.07;
        }
      }

      if (t.status === 'WON') {
        totalWonFunds += t.potentialPayout;
      }
      if (t.status === 'LOST') {
        totalLostFunds += t.stake;
      }
    }
  }

  const totalCommission = singleCommission + doubleCommission + multiCommission;
  const netDifference = totalPlayedFunds - totalWonFunds;

  // Cash debt obligation
  const cashDebtAmount = Math.abs(managerBalance);
  const cashDebtDirection = managerBalance >= 0 ? 'MANAGER_OWES_ADMIN' : 'ADMIN_OWES_MANAGER';
  const cashDebtStatus = managerBalance >= 0
    ? 'Menaxheri i detyrohet Adminit (Para kesh në dorë nga humbjet e lojtarëve)'
    : 'Admini i detyrohet Menaxherit (Para kesh në dorë për të paguar fituesit)';

  res.json({
    managerBalance,
    totalPlayers,
    totalPlayerBalance,
    totalPlayedFunds,
    totalWonFunds,
    totalLostFunds,
    netDifference,
    isPlus: netDifference >= 0,
    totalTickets,
    commission: {
      single: {
        stake: singleStake,
        count: singleCount,
        commission: singleCommission,
        rate: 3
      },
      double: {
        stake: doubleStake,
        count: doubleCount,
        commission: doubleCommission,
        rate: 5
      },
      multi: {
        stake: multiStake,
        count: multiCount,
        commission: multiCommission,
        rate: 7
      },
      totalCommission
    },
    cashDebt: {
      amount: cashDebtAmount,
      direction: cashDebtDirection,
      status: cashDebtStatus
    }
  });
});

// Get all users managed by this manager with full stats (commission and difference per user)
router.get('/users', auth, requireManager, async (req: AuthRequest, res) => {
  const users = await prisma.user.findMany({
    where: { managerId: req.user!.userId },
    select: {
      id: true,
      username: true,
      role: true,
      status: true,
      balance: true,
      currency: true,
      createdAt: true,
      tickets: {
        select: {
          id: true,
          stake: true,
          potentialPayout: true,
          status: true,
          lines: { select: { id: true } }
        }
      },
      _count: { select: { tickets: true } }
    },
    orderBy: { createdAt: 'desc' }
  });

  const usersWithStats = users.map(u => {
    let totalPlayedFunds = 0;
    let totalWonFunds = 0;
    let totalLostFunds = 0;

    let singleStake = 0;
    let singleCommission = 0;
    let doubleStake = 0;
    let doubleCommission = 0;
    let multiStake = 0;
    let multiCommission = 0;

    for (const t of u.tickets) {
      const linesCount = t.lines?.length || 1;

      if (t.status !== 'REVERTED') {
        totalPlayedFunds += t.stake;

        if (linesCount === 1) {
          singleStake += t.stake;
          singleCommission += t.stake * 0.03;
        } else if (linesCount === 2) {
          doubleStake += t.stake;
          doubleCommission += t.stake * 0.05;
        } else {
          multiStake += t.stake;
          multiCommission += t.stake * 0.07;
        }
      }

      if (t.status === 'WON') totalWonFunds += t.potentialPayout;
      if (t.status === 'LOST') totalLostFunds += t.stake;
    }

    const netDifference = totalPlayedFunds - totalWonFunds;
    const totalCommission = singleCommission + doubleCommission + multiCommission;
    const { tickets, ...rest } = u;

    return {
      ...rest,
      totalPlayedFunds,
      totalWonFunds,
      totalLostFunds,
      netDifference,
      totalTickets: u._count.tickets,
      singleStake,
      singleCommission,
      doubleStake,
      doubleCommission,
      multiStake,
      multiCommission,
      totalCommission
    };
  });

  res.json(usersWithStats);
});

// Create a new player under this manager
// DEDUCTS from manager's balance if initialBalance > 0
router.post('/users', auth, requireManager, async (req: AuthRequest, res) => {
  const { username, password, initialBalance } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Emri i përdoruesit dhe fjalëkalimi janë të detyrueshëm' });

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) return res.status(400).json({ error: 'Ky emër përdoruesi ekziston tashmë' });

  const initBal = Math.max(0, parseFloat(initialBalance) || 0);

  const manager = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  if (!manager) return res.status(404).json({ error: 'Menaxheri nuk u gjet' });

  // If initial balance requested, verify manager has enough funds!
  if (initBal > 0 && manager.balance < initBal) {
    return res.status(400).json({
      error: `Fondet e pamjaftueshme në llogarinë tuaj të menaxherit. Keni vetëm ${manager.balance.toFixed(2)} Lek, ndërsa kërkuat të transferoni ${initBal.toFixed(2)} Lek.`
    });
  }

  const hash = await bcrypt.hash(password, 10);

  const result = await prisma.$transaction(async (tx) => {
    let updatedManagerBalance = manager.balance;

    if (initBal > 0) {
      const updatedMgr = await tx.user.update({
        where: { id: manager.id },
        data: { balance: { decrement: initBal } }
      });
      updatedManagerBalance = updatedMgr.balance;

      await tx.transaction.create({
        data: {
          userId: manager.id,
          amount: -initBal,
          type: 'MANAGER_TRANSFER_OUT',
          balanceAfter: updatedMgr.balance,
          description: `Financim fillestar për lojtarin e ri ${username}`
        }
      });
    }

    const newUser = await tx.user.create({
      data: {
        username,
        passwordHash: hash,
        role: 'PLAYER',
        balance: initBal,
        currency: 'LEK',
        managerId: manager.id
      }
    });

    if (initBal > 0) {
      await tx.transaction.create({
        data: {
          userId: newUser.id,
          amount: initBal,
          type: 'DEPOSIT',
          balanceAfter: initBal,
          description: `Financim fillestar nga menaxheri ${manager.username}`
        }
      });
    }

    return { user: newUser, managerBalance: updatedManagerBalance };
  });

  res.json(result);
});

// Update user (username, password, role)
router.patch('/users/:id', auth, requireManager, async (req: AuthRequest, res) => {
  const { username, password, role } = req.body;
  const userId = req.params.id;

  const target = await prisma.user.findFirst({
    where: { id: userId, managerId: req.user!.userId }
  });
  if (!target) return res.status(404).json({ error: 'Lojtari nuk u gjet ose nuk menaxhohet nga ju' });

  const data: any = {};
  if (username) {
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing && existing.id !== userId) return res.status(400).json({ error: 'Ky emër përdoruesi ekziston tashmë' });
    data.username = username;
  }
  if (password) data.passwordHash = await bcrypt.hash(password, 10);
  if (role && ['PLAYER', 'MANAGER'].includes(role)) data.role = role;

  const user = await prisma.user.update({ where: { id: userId }, data });
  res.json(user);
});

// Delete a user (only players, not managers)
router.delete('/users/:id', auth, requireManager, async (req: AuthRequest, res) => {
  const userId = req.params.id;

  const target = await prisma.user.findFirst({
    where: { id: userId, managerId: req.user!.userId }
  });
  if (!target) return res.status(404).json({ error: 'Lojtari nuk u gjet ose nuk menaxhohet nga ju' });
  if (target.role === 'MANAGER' || target.role === 'ADMIN') {
    return res.status(400).json({ error: 'Nuk mund të fshini menaxherë ose administratorë' });
  }

  // Delete related data first
  await prisma.$transaction(async (tx) => {
    await tx.ticketLine.deleteMany({ where: { ticket: { userId } } });
    await tx.ticket.deleteMany({ where: { userId } });
    await tx.transaction.deleteMany({ where: { userId } });
    await tx.user.delete({ where: { id: userId } });
  });

  res.json({ success: true });
});

// Change user status (ban/freeze/activate)
router.patch('/users/:id/status', auth, requireManager, async (req: AuthRequest, res) => {
  const userId = req.params.id;
  const { status } = req.body;

  const target = await prisma.user.findFirst({
    where: { id: userId, managerId: req.user!.userId }
  });
  if (!target) return res.status(404).json({ error: 'Lojtari nuk u gjet ose nuk menaxhohet nga ju' });

  const user = await prisma.user.update({
    where: { id: userId },
    data: { status }
  });
  res.json(user);
});

// Deposit to a managed user (DEDUCTS from Manager Balance!)
router.post('/users/:id/deposit', auth, requireManager, async (req: AuthRequest, res) => {
  const userId = req.params.id;
  const amount = parseFloat(req.body.amount) || 0;
  if (amount <= 0) return res.status(400).json({ error: 'Shuma duhet të jetë më e madhe se 0 Lek' });

  const manager = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  if (!manager) return res.status(404).json({ error: 'Menaxheri nuk u gjet' });

  if (manager.balance < amount) {
    return res.status(400).json({
      error: `Fondet e pamjaftueshme në llogarinë tuaj të menaxherit. Keni vetëm ${manager.balance.toFixed(2)} Lek, ndërsa kërkuat të depozitoni ${amount.toFixed(2)} Lek.`
    });
  }

  const target = await prisma.user.findFirst({
    where: { id: userId, managerId: req.user!.userId }
  });
  if (!target) return res.status(404).json({ error: 'Lojtari nuk u gjet ose nuk menaxhohet nga ju' });

  const result = await prisma.$transaction(async (tx) => {
    // Decrement from manager
    const updatedMgr = await tx.user.update({
      where: { id: manager.id },
      data: { balance: { decrement: amount } }
    });
    await tx.transaction.create({
      data: {
        userId: manager.id,
        amount: -amount,
        type: 'MANAGER_TRANSFER_OUT',
        balanceAfter: updatedMgr.balance,
        description: `Depozitim te lojtari ${target.username}`
      }
    });

    // Increment player
    const updatedPlayer = await tx.user.update({
      where: { id: userId },
      data: { balance: { increment: amount } }
    });
    await tx.transaction.create({
      data: {
        userId: target.id,
        amount,
        type: 'DEPOSIT',
        balanceAfter: updatedPlayer.balance,
        description: `Depozitë nga menaxheri ${manager.username}`
      }
    });

    return { user: updatedPlayer, managerBalance: updatedMgr.balance };
  });

  res.json(result);
});

// Withdraw from a managed user (ADDS back to Manager Balance!)
router.post('/users/:id/withdraw', auth, requireManager, async (req: AuthRequest, res) => {
  const userId = req.params.id;
  const amount = parseFloat(req.body.amount) || 0;
  if (amount <= 0) return res.status(400).json({ error: 'Shuma duhet të jetë më e madhe se 0 Lek' });

  const target = await prisma.user.findFirst({
    where: { id: userId, managerId: req.user!.userId }
  });
  if (!target) return res.status(404).json({ error: 'Lojtari nuk u gjet ose nuk menaxhohet nga ju' });
  if (target.balance < amount) {
    return res.status(400).json({
      error: `Lojtari ka vetëm ${target.balance.toFixed(2)} Lek. Nuk mund të tërhiqni më shumë.`
    });
  }

  const manager = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  if (!manager) return res.status(404).json({ error: 'Menaxheri nuk u gjet' });

  const result = await prisma.$transaction(async (tx) => {
    // Decrement from player
    const updatedPlayer = await tx.user.update({
      where: { id: userId },
      data: { balance: { decrement: amount } }
    });
    await tx.transaction.create({
      data: {
        userId: target.id,
        amount: -amount,
        type: 'WITHDRAWAL',
        balanceAfter: updatedPlayer.balance,
        description: `Tërheqje nga menaxheri ${manager.username}`
      }
    });

    // Increment to manager
    const updatedMgr = await tx.user.update({
      where: { id: manager.id },
      data: { balance: { increment: amount } }
    });
    await tx.transaction.create({
      data: {
        userId: manager.id,
        amount,
        type: 'MANAGER_TRANSFER_IN',
        balanceAfter: updatedMgr.balance,
        description: `Tërheqje fondesh nga lojtari ${target.username}`
      }
    });

    return { user: updatedPlayer, managerBalance: updatedMgr.balance };
  });

  res.json(result);
});

// Get tickets of managed users
router.get('/tickets', auth, requireManager, async (req: AuthRequest, res) => {
  const { userId, status } = req.query;
  const whereClause: any = {
    user: { managerId: req.user!.userId }
  };

  if (userId) {
    whereClause.userId = String(userId);
  }
  if (status && status !== 'ALL') {
    whereClause.status = String(status);
  }

  const tickets = await prisma.ticket.findMany({
    where: whereClause,
    include: {
      user: { select: { id: true, username: true } },
      lines: {
        include: {
          match: {
            select: {
              homeTeam: true,
              awayTeam: true,
              homeScore: true,
              awayScore: true,
              status: true,
              currentMinute: true,
              startTime: true
            }
          }
        }
      }
    },
    take: 100,
    orderBy: { placedAt: 'desc' }
  });
  res.json(tickets);
});

// Revert a ticket (refund stake, mark as REVERTED)
router.post('/tickets/:id/revert', auth, requireManager, async (req: AuthRequest, res) => {
  const ticketId = req.params.id;

  const ticket = await prisma.ticket.findFirst({
    where: {
      id: ticketId,
      user: { managerId: req.user!.userId }
    },
    include: { user: true }
  });

  if (!ticket) return res.status(404).json({ error: 'Skedina nuk u gjet ose nuk menaxhohet nga ju' });
  if (ticket.status !== 'PENDING') return res.status(400).json({ error: 'Vetëm skedinat në pritje mund të kthehen' });
  if (!ticket.userId) return res.status(400).json({ error: 'Nuk mund të kthehen skedinat e vizitorëve' });

  await prisma.$transaction(async (tx) => {
    // Refund the stake to the user
    const updatedUser = await tx.user.update({
      where: { id: ticket.userId! },
      data: { balance: { increment: ticket.stake } }
    });

    // Mark ticket as REVERTED
    await tx.ticket.update({
      where: { id: ticketId },
      data: { status: 'REVERTED', settledAt: new Date() }
    });

    // Update all lines to VOID
    await tx.ticketLine.updateMany({
      where: { ticketId },
      data: { status: 'VOID' }
    });

    // Create transaction record
    await tx.transaction.create({
      data: {
        userId: ticket.userId!,
        amount: ticket.stake,
        type: 'TICKET_REVERT',
        referenceId: ticketId,
        balanceAfter: updatedUser.balance,
        description: `Skedinë e kthyer nga menaxheri ${req.user!.username}`
      }
    });
  });

  res.json({ success: true, refunded: ticket.stake });
});

export default router;