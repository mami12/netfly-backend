import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const matches = await prisma.match.findMany({
    select: { id: true, homeTeam: true, awayTeam: true, status: true, startTime: true }
  });
  console.log(JSON.stringify(matches, null, 2));
  await prisma.$disconnect();
}

main().catch(console.error);