import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const adminPasswordHash = await bcrypt.hash('admin123', 10);
  
  await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      passwordHash: adminPasswordHash,
      role: 'ADMIN',
      balance: 999999,
      currency: 'LEK'
    }
  });

  const managerPasswordHash = await bcrypt.hash('manager123', 10);
  await prisma.user.upsert({
    where: { username: 'manager' },
    update: {},
    create: {
      username: 'manager',
      passwordHash: managerPasswordHash,
      role: 'MANAGER',
      balance: 500000,
      currency: 'LEK'
    }
  });

  const sports = [
    { id: 1, name: 'Football', slug: 'football', iconName: 'soccer', sortOrder: 1 },
    { id: 2, name: 'Basketball', slug: 'basketball', iconName: 'basketball', sortOrder: 2 },
    { id: 3, name: 'Tennis', slug: 'tennis', iconName: 'tennis', sortOrder: 3 },
    { id: 4, name: 'Ice Hockey', slug: 'ice-hockey', iconName: 'hockey', sortOrder: 4 },
    { id: 5, name: 'Volleyball', slug: 'volleyball', iconName: 'volleyball', sortOrder: 5 }
  ];

  for (const s of sports) {
    await prisma.sport.upsert({
      where: { slug: s.slug },
      update: {},
      create: s
    });
  }

  const categories = [
    { id: 1, sportId: 1, name: 'England', slug: 'england', countryCode: 'GB', sortOrder: 1 },
    { id: 2, sportId: 1, name: 'Spain', slug: 'spain', countryCode: 'ES', sortOrder: 2 },
    { id: 3, sportId: 1, name: 'Germany', slug: 'germany', countryCode: 'DE', sortOrder: 3 },
    { id: 4, sportId: 1, name: 'Italy', slug: 'italy', countryCode: 'IT', sortOrder: 4 },
    { id: 5, sportId: 1, name: 'France', slug: 'france', countryCode: 'FR', sortOrder: 5 },
    { id: 6, sportId: 1, name: 'Champions League', slug: 'champions-league', countryCode: 'EU', sortOrder: 6 },
    { id: 7, sportId: 2, name: 'NBA', slug: 'nba', countryCode: 'US', sortOrder: 1 },
    { id: 8, sportId: 2, name: 'Euroleague', slug: 'euroleague', countryCode: 'EU', sortOrder: 2 },
    { id: 9, sportId: 3, name: 'ATP', slug: 'atp', countryCode: 'INT', sortOrder: 1 },
    { id: 10, sportId: 3, name: 'WTA', slug: 'wta', countryCode: 'INT', sortOrder: 2 }
  ];

  for (const c of categories) {
    await prisma.category.upsert({
      where: { id: c.id },
      update: {},
      create: c
    });
  }

  const tournaments = [
    { id: 1, categoryId: 1, name: 'Premier League', slug: 'premier-league', sortOrder: 1 },
    { id: 2, categoryId: 2, name: 'La Liga', slug: 'la-liga', sortOrder: 1 },
    { id: 3, categoryId: 3, name: 'Bundesliga', slug: 'bundesliga', sortOrder: 1 },
    { id: 4, categoryId: 4, name: 'Serie A', slug: 'serie-a', sortOrder: 1 },
    { id: 5, categoryId: 5, name: 'Ligue 1', slug: 'ligue-1', sortOrder: 1 },
    { id: 6, categoryId: 6, name: 'Champions League', slug: 'champions-league', sortOrder: 1 },
    { id: 7, categoryId: 7, name: 'NBA', slug: 'nba', sortOrder: 1 },
    { id: 8, categoryId: 8, name: 'Euroleague', slug: 'euroleague', sortOrder: 1 },
    { id: 9, categoryId: 9, name: 'ATP Tour', slug: 'atp-tour', sortOrder: 1 },
    { id: 10, categoryId: 10, name: 'WTA Tour', slug: 'wta-tour', sortOrder: 1 }
  ];

  for (const t of tournaments) {
    await prisma.tournament.upsert({
      where: { id: t.id },
      update: {},
      create: t
    });
  }

  const matchData = [
    { tId: 1, home: 'Arsenal', away: 'Chelsea' },
    { tId: 1, home: 'Man City', away: 'Liverpool' },
    { tId: 1, home: 'Man United', away: 'Tottenham' },
    { tId: 2, home: 'Real Madrid', away: 'Barcelona' },
    { tId: 2, home: 'Atletico Madrid', away: 'Sevilla' },
    { tId: 3, home: 'Bayern Munich', away: 'Dortmund' },
    { tId: 4, home: 'Juventus', away: 'AC Milan' },
    { tId: 4, home: 'Inter', away: 'Roma' },
    { tId: 5, home: 'PSG', away: 'Marseille' },
    { tId: 6, home: 'Man City', away: 'Real Madrid' },
    { tId: 7, home: 'Lakers', away: 'Warriors' },
    { tId: 7, home: 'Celtics', away: 'Heat' },
    { tId: 8, home: 'Real Madrid', away: 'Olympiacos' },
    { tId: 9, home: 'Djokovic N.', away: 'Alcaraz C.' },
    { tId: 10, home: 'Swiatek I.', away: 'Sabalenka A.' }
  ];

  for (let i = 0; i < matchData.length; i++) {
    const md = matchData[i];
    const isLive = i < 4; // First 4 matches are LIVE immediately!
    const match = await prisma.match.create({
      data: {
        tournamentId: md.tId,
        homeTeam: md.home,
        awayTeam: md.away,
        startTime: isLive ? new Date(Date.now() - (i * 900000 + 600000)) : new Date(Date.now() + (i * 7200000) + 3600000),
        status: isLive ? 'LIVE' : 'PREMATCH',
        currentMinute: isLive ? 15 + (i * 18) : 0,
        homeScore: isLive ? Math.floor(Math.random() * 2) : 0,
        awayScore: isLive ? Math.floor(Math.random() * 2) : 0,
        markets: {
          create: [
            {
              marketType: '1X2',
              name: 'Match Winner',
              status: 'ACTIVE',
              sortOrder: 1,
              outcomes: {
                create: [
                  { name: '1', odds: 1.5 + Math.random(), status: 'ACTIVE' },
                  { name: 'X', odds: 3.0 + Math.random(), status: 'ACTIVE' },
                  { name: '2', odds: 4.0 + Math.random(), status: 'ACTIVE' }
                ]
              }
            },
            {
              marketType: 'OVER_UNDER',
              name: 'Over/Under 2.5',
              specifier: '2.5',
              status: 'ACTIVE',
              sortOrder: 2,
              outcomes: {
                create: [
                  { name: 'Over', odds: 1.8 + Math.random() * 0.4, status: 'ACTIVE' },
                  { name: 'Under', odds: 1.8 + Math.random() * 0.4, status: 'ACTIVE' }
                ]
              }
            },
            {
              marketType: 'BOTH_TEAMS_SCORE',
              name: 'Both Teams to Score',
              status: 'ACTIVE',
              sortOrder: 3,
              outcomes: {
                create: [
                  { name: 'Yes', odds: 1.7 + Math.random() * 0.5, status: 'ACTIVE' },
                  { name: 'No', odds: 1.7 + Math.random() * 0.5, status: 'ACTIVE' }
                ]
              }
            },
            {
              marketType: 'DOUBLE_CHANCE',
              name: 'Double Chance',
              status: 'ACTIVE',
              sortOrder: 4,
              outcomes: {
                create: [
                  { name: '1X', odds: 1.1 + Math.random() * 0.3, status: 'ACTIVE' },
                  { name: '12', odds: 1.2 + Math.random() * 0.3, status: 'ACTIVE' },
                  { name: 'X2', odds: 1.8 + Math.random() * 0.5, status: 'ACTIVE' }
                ]
              }
            }
          ]
        }
      }
    });
  }

  console.log('Database seeded successfully');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
