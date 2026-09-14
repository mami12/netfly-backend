import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class WalletService {
  static async deposit(userId: string, amount: number, description?: string) {
    return prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: userId },
        data: { balance: { increment: amount } }
      });
      const transaction = await tx.transaction.create({
        data: {
          userId,
          amount,
          type: 'DEPOSIT',
          balanceAfter: user.balance,
          description
        }
      });
      return { user, transaction };
    });
  }

  static async withdraw(userId: string, amount: number, description?: string) {
    return prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user || user.balance < amount) {
        throw new Error('Insufficient balance');
      }
      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: { balance: { decrement: amount } }
      });
      const transaction = await tx.transaction.create({
        data: {
          userId,
          amount: -amount,
          type: 'WITHDRAWAL',
          balanceAfter: updatedUser.balance,
          description
        }
      });
      return { user: updatedUser, transaction };
    });
  }

  static async placeBet(userId: string, amount: number, ticketId: string) {
    return prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user || user.balance < amount) {
        throw new Error('Insufficient balance');
      }
      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: { balance: { decrement: amount } }
      });
      await tx.transaction.create({
        data: {
          userId,
          amount: -amount,
          type: 'BET_PLACED',
          referenceId: ticketId,
          balanceAfter: updatedUser.balance
        }
      });
      return updatedUser;
    });
  }

  static async creditWinnings(userId: string, amount: number, ticketId: string) {
    return prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: userId },
        data: { balance: { increment: amount } }
      });
      await tx.transaction.create({
        data: {
          userId,
          amount,
          type: 'BET_WON',
          referenceId: ticketId,
          balanceAfter: user.balance
        }
      });
      return user;
    });
  }

  static async refund(userId: string, amount: number, ticketId: string) {
    return prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: userId },
        data: { balance: { increment: amount } }
      });
      await tx.transaction.create({
        data: {
          userId,
          amount,
          type: 'BET_REFUND',
          referenceId: ticketId,
          balanceAfter: user.balance
        }
      });
      return user;
    });
  }
}
