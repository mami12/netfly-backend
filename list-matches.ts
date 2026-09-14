import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const matches = await prisma.match.findMany({
    include: { markets: { include: { outcomes: true } } }
  });
  console.log(JSON.stringify(matches, null, 2));
  await prisma.$disconnect();
}

main().catch(console.error);