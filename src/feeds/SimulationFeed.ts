import { IFeedProvider, MatchEvent, PitchState, OddsDelta } from './IFeedProvider';
import { PrismaClient } from '@prisma/client';
import { BetSettler } from '../services/betSettler';

const prisma = new PrismaClient();

const TEAMS = [
  { home: 'Arsenal', away: 'Chelsea' },
  { home: 'Man City', away: 'Liverpool' },
  { home: 'Man United', away: 'Tottenham' },
  { home: 'Real Madrid', away: 'Barcelona' },
  { home: 'Atletico Madrid', away: 'Sevilla' },
  { home: 'Bayern Munich', away: 'Dortmund' },
  { home: 'Juventus', away: 'AC Milan' },
  { home: 'Inter', away: 'Roma' },
  { home: 'PSG', away: 'Marseille' },
  { home: 'Man City', away: 'Real Madrid' },
  { home: 'Lakers', away: 'Warriors' },
  { home: 'Celtics', away: 'Heat' },
  { home: 'Real Madrid', away: 'Olympiacos' },
  { home: 'Djokovic N.', away: 'Alcaraz C.' },
  { home: 'Swiatek I.', away: 'Sabalenka A.' }
];

const TOURNAMENT_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export class SimulationFeed implements IFeedProvider {
  private interval: NodeJS.Timeout | null = null;
  private matchEventCb?: (event: MatchEvent) => void;
  private pitchUpdateCb?: (state: PitchState) => void;
  private oddsUpdateCb?: (delta: OddsDelta) => void;
  private matchStatusChangeCb?: (matchId: string, status: string, minute: number, homeScore: number, awayScore: number) => void;

  private pitchStates: Map<string, PitchState> = new Map();

  start() {
    this.interval = setInterval(async () => {
      await this.tick();
    }, 3000);
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
  }

  onMatchEvent(callback: (event: MatchEvent) => void) { this.matchEventCb = callback; }
  onPitchUpdate(callback: (state: PitchState) => void) { this.pitchUpdateCb = callback; }
  onOddsUpdate(callback: (delta: OddsDelta) => void) { this.oddsUpdateCb = callback; }
  onMatchStatusChange(callback: (matchId: string, status: string, minute: number, homeScore: number, awayScore: number) => void) { this.matchStatusChangeCb = callback; }

  private async tick() {
    const now = new Date();
    
    // Ensure we always have upcoming matches - create new ones if pool is low
    const prematchCount = await prisma.match.count({ where: { status: 'PREMATCH', isSimulated: true } });
    if (prematchCount < 5) {
      await this.createNewMatches(10);
    }
    
    // Start matches
    const prematchMatches = await prisma.match.findMany({
      where: { status: 'PREMATCH', startTime: { lte: now }, isSimulated: true }
    });

    for (const match of prematchMatches) {
      await prisma.match.update({ where: { id: match.id }, data: { status: 'LIVE', currentMinute: 0 } });
      this.initPitchState(match.id);
      if (this.matchStatusChangeCb) this.matchStatusChangeCb(match.id, 'LIVE', 0, 0, 0);
    }

    // Process live matches
    const liveMatches = await prisma.match.findMany({
      where: { status: 'LIVE', isSimulated: true },
      include: { markets: { include: { outcomes: true } } }
    });

    for (const match of liveMatches) {
      // Advance time smoothly (1 min every 4 ticks ~ 12 secs)
      let newMinute = match.currentMinute + 1;
      let newHomeScore = match.homeScore;
      let newAwayScore = match.awayScore;
      
      if (newMinute === 45) {
        if (this.matchEventCb) this.matchEventCb({ matchId: match.id, type: 'HALF_TIME', team: 'HOME', minute: newMinute });
      } else if (newMinute >= 90) {
        if (this.matchEventCb) this.matchEventCb({ matchId: match.id, type: 'FULL_TIME', team: 'HOME', minute: newMinute });
        await BetSettler.settleMatch(match.id, newHomeScore, newAwayScore);
        if (this.matchStatusChangeCb) this.matchStatusChangeCb(match.id, 'ENDED', 90, newHomeScore, newAwayScore);
        this.pitchStates.delete(match.id);

        // Auto-promote a prematch match to LIVE to keep action flowing!
        const nextPrematch = await prisma.match.findFirst({ where: { status: 'PREMATCH', isSimulated: true } });
        if (nextPrematch) {
          await prisma.match.update({
            where: { id: nextPrematch.id },
            data: { status: 'LIVE', currentMinute: 1 }
          });
        }
        continue;
      }

      // Simulate events
      const rand = Math.random();
      if (rand < 0.05) {
        // Goal
        const team = Math.random() > 0.5 ? 'HOME' : 'AWAY';
        if (team === 'HOME') newHomeScore++;
        else newAwayScore++;
        
        await prisma.match.update({
          where: { id: match.id },
          data: { homeScore: newHomeScore, awayScore: newAwayScore, currentMinute: newMinute }
        });
        
        if (this.matchEventCb) this.matchEventCb({ matchId: match.id, type: 'GOAL', team, minute: newMinute });
        if (this.matchStatusChangeCb) this.matchStatusChangeCb(match.id, 'LIVE', newMinute, newHomeScore, newAwayScore);
        
        // Fluctuate odds significantly on goal
        await this.fluctuateOdds(match, true);
      } else {
        await prisma.match.update({ where: { id: match.id }, data: { currentMinute: newMinute } });
        if (rand < 0.2) {
          await this.fluctuateOdds(match, false);
        }
      }

      this.updatePitch(match.id);
    }
  }

  private initPitchState(matchId: string) {
    this.pitchStates.set(matchId, {
      matchId,
      ballX: 50, ballY: 50,
      possession: 'HOME',
      attackState: 'NONE',
      homeStats: { possession: 50, shots: 0, shotsOnTarget: 0, corners: 0, fouls: 0, yellowCards: 0, redCards: 0 },
      awayStats: { possession: 50, shots: 0, shotsOnTarget: 0, corners: 0, fouls: 0, yellowCards: 0, redCards: 0 }
    });
  }

  private updatePitch(matchId: string) {
    const state = this.pitchStates.get(matchId);
    if (!state) return;

    if (Math.random() < 0.2) {
      state.possession = state.possession === 'HOME' ? 'AWAY' : 'HOME';
    }

    if (state.possession === 'HOME') {
      state.ballX = Math.min(100, state.ballX + Math.random() * 20);
      state.attackState = state.ballX > 80 ? 'DANGEROUS_ATTACK' : 'BUILD_UP';
    } else {
      state.ballX = Math.max(0, state.ballX - Math.random() * 20);
      state.attackState = state.ballX < 20 ? 'DANGEROUS_ATTACK' : 'BUILD_UP';
    }

    state.ballY = Math.max(0, Math.min(100, state.ballY + (Math.random() - 0.5) * 20));

    if (this.pitchUpdateCb) this.pitchUpdateCb(state);
  }

  private async fluctuateOdds(match: any, isGoal: boolean) {
    if (match.isSuspended) return;
    const delta: OddsDelta = { matchId: match.id, outcomes: [] };
    for (const market of match.markets) {
      if (market.status !== 'ACTIVE') continue;
      for (const outcome of market.outcomes) {
        if (outcome.status !== 'ACTIVE') continue;
        const change = (Math.random() - 0.5) * (isGoal ? 0.5 : 0.05);
        const newOdds = Math.max(1.01, parseFloat((outcome.odds + change).toFixed(2)));
        if (newOdds !== outcome.odds) {
          delta.outcomes.push({ outcomeId: outcome.id, oldOdds: outcome.odds, newOdds });
          await prisma.outcome.update({ where: { id: outcome.id }, data: { odds: newOdds } });
        }
      }
    }
    if (delta.outcomes.length > 0 && this.oddsUpdateCb) {
      this.oddsUpdateCb(delta);
    }
  }

  private async createNewMatches(count: number) {
    const now = new Date();
    for (let i = 0; i < count; i++) {
      const teams = TEAMS[Math.floor(Math.random() * TEAMS.length)];
      const tournamentId = TOURNAMENT_IDS[Math.floor(Math.random() * TOURNAMENT_IDS.length)];
      // Start time in 1-12 hours from now
      const startTime = new Date(now.getTime() + (Math.random() * 11 + 1) * 3600000);
      
      await prisma.match.create({
        data: {
          tournamentId,
          homeTeam: teams.home,
          awayTeam: teams.away,
          startTime,
          status: 'PREMATCH',
          currentMinute: 0,
          homeScore: 0,
          awayScore: 0,
          isSimulated: true,
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
  }
}
