import { IFeedProvider, MatchEvent, PitchState, OddsDelta } from './IFeedProvider';
import { PrismaClient } from '@prisma/client';
import https from 'https';

const prisma = new PrismaClient();

export class ExternalFeedAdapter implements IFeedProvider {
  private apiKey: string;
  private provider: 'THE_ODDS_API' | 'BETSAPI' | 'GENERIC';
  private pollInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

  private matchEventCallbacks: ((event: MatchEvent) => void)[] = [];
  private pitchUpdateCallbacks: ((state: PitchState) => void)[] = [];
  private oddsUpdateCallbacks: ((delta: OddsDelta) => void)[] = [];
  private matchStatusCallbacks: ((matchId: string, status: string, minute: number, homeScore: number, awayScore: number) => void)[] = [];

  constructor(apiKey?: string, provider: 'THE_ODDS_API' | 'BETSAPI' | 'GENERIC' = 'THE_ODDS_API') {
    this.apiKey = apiKey || process.env.SPORTS_API_KEY || process.env.THE_ODDS_API_KEY || '';
    this.provider = provider;
  }

  start() {
    if (!this.apiKey) {
      console.warn('[ExternalFeedAdapter] No SPORTS_API_KEY provided. Live external feed disabled.');
      return;
    }
    this.isRunning = true;
    console.log(`[ExternalFeedAdapter] Started live feed provider: ${this.provider}`);

    // Initial fetch and then poll every 60 seconds (respecting API rate limits)
    this.fetchLiveOdds();
    this.pollInterval = setInterval(() => {
      if (this.isRunning) this.fetchLiveOdds();
    }, 60000);
  }

  stop() {
    this.isRunning = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    console.log('[ExternalFeedAdapter] Stopped.');
  }

  onMatchEvent(callback: (event: MatchEvent) => void) {
    this.matchEventCallbacks.push(callback);
  }

  onPitchUpdate(callback: (state: PitchState) => void) {
    this.pitchUpdateCallbacks.push(callback);
  }

  onOddsUpdate(callback: (delta: OddsDelta) => void) {
    this.oddsUpdateCallbacks.push(callback);
  }

  onMatchStatusChange(callback: (matchId: string, status: string, minute: number, homeScore: number, awayScore: number) => void) {
    this.matchStatusCallbacks.push(callback);
  }

  private async fetchLiveOdds() {
    try {
      if (this.provider === 'THE_ODDS_API') {
        await this.fetchFromTheOddsApi();
      }
    } catch (err) {
      console.error('[ExternalFeedAdapter] Error fetching live odds:', err);
    }
  }

  /**
   * The Odds API integration (https://the-odds-api.com)
   * Free tier: 500 requests/month with live Premier League, La Liga, Champions League, etc.
   */
  private fetchFromTheOddsApi(): Promise<void> {
    return new Promise((resolve) => {
      const url = `https://api.the-odds-api.com/v4/sports/soccer_epl/odds/?apiKey=${this.apiKey}&regions=eu&markets=h2h`;
      
      https.get(url, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', async () => {
          if (res.statusCode !== 200) {
            console.error(`[ExternalFeedAdapter] API responded with status ${res.statusCode}: ${body}`);
            return resolve();
          }

          try {
            const games = JSON.parse(body);
            if (!Array.isArray(games)) return resolve();

            for (const game of games.slice(0, 10)) {
              await this.syncGameOdds(game);
            }
          } catch (e) {
            console.error('[ExternalFeedAdapter] Failed to parse games JSON:', e);
          }
          resolve();
        });
      }).on('error', (err) => {
        console.error('[ExternalFeedAdapter] HTTP error:', err);
        resolve();
      });
    });
  }

  private async syncGameOdds(game: any) {
    try {
      const homeTeam = game.home_team;
      const awayTeam = game.away_team;
      const bookmaker = game.bookmakers?.[0];
      const marketH2H = bookmaker?.markets?.find((m: any) => m.key === 'h2h');
      if (!marketH2H || !marketH2H.outcomes) return;

      // Find match in our database
      const match = await prisma.match.findFirst({
        where: {
          homeTeam: { contains: homeTeam.split(' ')[0] },
          awayTeam: { contains: awayTeam.split(' ')[0] },
        },
        include: {
          markets: {
            where: { marketType: '1X2' },
            include: { outcomes: true }
          }
        }
      });

      if (!match || !match.markets[0]) return;

      const deltaOutcomes: { outcomeId: string; oldOdds: number; newOdds: number }[] = [];

      for (const out of marketH2H.outcomes) {
        let outcomeName = '1';
        if (out.name === awayTeam) outcomeName = '2';
        else if (out.name.toLowerCase().includes('draw')) outcomeName = 'X';

        const dbOutcome = match.markets[0].outcomes.find(o => o.name === outcomeName);
        if (dbOutcome && Math.abs(dbOutcome.odds - out.price) > 0.01) {
          deltaOutcomes.push({
            outcomeId: dbOutcome.id,
            oldOdds: dbOutcome.odds,
            newOdds: out.price
          });

          await prisma.outcome.update({
            where: { id: dbOutcome.id },
            data: { odds: out.price }
          });
        }
      }

      if (deltaOutcomes.length > 0) {
        const delta: OddsDelta = {
          matchId: match.id,
          outcomes: deltaOutcomes
        };
        for (const cb of this.oddsUpdateCallbacks) {
          cb(delta);
        }
      }
    } catch (e) {
      console.error('[ExternalFeedAdapter] Error syncing match odds:', e);
    }
  }
}
