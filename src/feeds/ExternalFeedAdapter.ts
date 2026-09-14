import { IFeedProvider, MatchEvent, PitchState, OddsDelta } from './IFeedProvider';
import { PrismaClient } from '@prisma/client';
import https from 'https';

const prisma = new PrismaClient();

const BZZ_API_BASE = process.env.BZZOIRO_API_BASE || 'https://sports.bzzoiro.com';
const FIXTURE_WINDOW_MS = 72 * 60 * 60 * 1000; // look ahead for upcoming fixtures (72h)

function fetchJson(url: string, headers: Record<string, string> = {}): Promise<{ status: number; data: any; raw: string }> {
  return new Promise((resolve) => {
    https.get(url, { headers }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode || 200, data: JSON.parse(body), raw: body });
        } catch {
          resolve({ status: res.statusCode || 200, data: null, raw: body });
        }
      });
    }).on('error', (err) => resolve({ status: 500, data: null, raw: err.message }));
  });
}

function slugify(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function mapStatus(status: string): { status: string; minute: number } {
  switch (String(status || '').toLowerCase()) {
    case 'inprogress':
    case 'penalties':
      return { status: 'LIVE', minute: 0 };
    case 'finished':
      return { status: 'ENDED', minute: 90 };
    case 'notstarted':
    case 'delayed':
    default:
      return { status: 'PREMATCH', minute: 0 };
  }
}

function guessCategory(title: string): string {
  const t = (title || '').toLowerCase();
  if (t.includes('premier') || t.includes('england') || t.includes('fa cup') || t.includes('championship') || t.includes('league one') || t.includes('league two')) return 'England';
  if (t.includes('la liga') || t.includes('span') || t.includes('copa del rey') || t.includes('segunda')) return 'Spain';
  if (t.includes('serie a') || t.includes('italy') || t.includes('coppa italia') || t.includes('serie b')) return 'Italy';
  if (t.includes('bundesliga') || t.includes('german') || t.includes('dfb')) return 'Germany';
  if (t.includes('ligue') || t.includes('france') || t.includes('french')) return 'France';
  if (t.includes('champions') || t.includes('europa') || t.includes('uefa') || t.includes('conference')) return 'International';
  if (t.includes('veikkausliiga') || t.includes('finland') || t.includes('finnish')) return 'Finland';
  if (t.includes('eredivisie') || t.includes('netherlands') || t.includes('holland')) return 'Netherlands';
  if (t.includes('liga portugal') || t.includes('ligue portugal') || t.includes('portugal') || t.includes('primeira')) return 'Portugal';
  if (t.includes('brasileir') || t.includes('brazil')) return 'Brazil';
  if (t.includes('super lig') || t.includes('turk')) return 'Turkey';
  if (t.includes('superliga') || t.includes('romania') || t.includes('romanian')) return 'Romania';
  if (t.includes('ekstraklasa') || t.includes('poland') || t.includes('polish')) return 'Poland';
  if (t.includes('eliteserien') || t.includes('norway') || t.includes('norwegian')) return 'Norway';
  if (t.includes('allsvenskan') || t.includes('sweden') || t.includes('swedish')) return 'Sweden';
  if (t.includes('j1 league') || t.includes('japan') || t.includes('japanese')) return 'Japan';
  if (t.includes('mls') || t.includes('usa') || t.includes('american')) return 'USA';
  if (t.includes('serie b') || t.includes('scottish') || t.includes('scotland')) return 'Scotland';
  return 'International';
}
export class ExternalFeedAdapter implements IFeedProvider {
  private apiKey: string;
  private pollInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private lastSyncTime: Date | null = null;
  private lastError: string | null = null;
  private importedCount = 0;
  private leaguesMap = new Map<number, { name: string; country: string }>();
  private lastLeaguesSync = 0;
  private leagueProbeCount = 0;
  private oddsProbeCount = 0;

  private matchEventCallbacks: ((event: MatchEvent) => void)[] = [];
  private pitchUpdateCallbacks: ((state: PitchState) => void)[] = [];
  private oddsUpdateCallbacks: ((delta: OddsDelta) => void)[] = [];
  private matchStatusCallbacks: ((matchId: string, status: string, minute: number, homeScore: number, awayScore: number) => void)[] = [];

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.BZZOIRO_API_KEY || process.env.SPORTS_API_KEY || process.env.THE_ODDS_API_KEY || '';
  }

  setApiKey(key: string) { this.apiKey = key.trim(); }
  getApiKey(): string { return this.apiKey; }
  getLastSyncTime(): string | null { return this.lastSyncTime ? this.lastSyncTime.toISOString() : null; }
  getLastError(): string | null { return this.lastError; }
  getImportedCount(): number { return this.importedCount; }

  onMatchEvent(callback: (event: MatchEvent) => void) { this.matchEventCallbacks.push(callback); }
  onPitchUpdate(callback: (state: PitchState) => void) { this.pitchUpdateCallbacks.push(callback); }
  onOddsUpdate(callback: (delta: OddsDelta) => void) { this.oddsUpdateCallbacks.push(callback); }
  onMatchStatusChange(callback: (matchId: string, status: string, minute: number, homeScore: number, awayScore: number) => void) { this.matchStatusCallbacks.push(callback); }

  start() {
    if (!this.apiKey) {
      console.warn('[ExternalFeedAdapter] No BZZOIRO_API_KEY / SPORTS_API_KEY provided. Real feed disabled, using simulation only.');
      return;
    }
    this.isRunning = true;
    console.log('[ExternalFeedAdapter] Starting real sports feed (Bzzoiro Sports Data)...');
    this.syncRealMatches().catch((err) => console.error('[ExternalFeedAdapter] Initial sync failed:', err));
    this.pollInterval = setInterval(() => {
      if (this.isRunning && this.apiKey) this.syncRealMatches().catch(console.error);
    }, 3 * 60 * 1000); // keep scores/odds fresh every ~3 minutes (free-API friendly)
  }

  stop() {
    this.isRunning = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    console.log('[ExternalFeedAdapter] Stopped.');
  }

  private async request(path: string): Promise<{ status: number; data: any; raw: string }> {
    return fetchJson(`${BZZ_API_BASE}${path}`, {
      Authorization: `Token ${this.apiKey}`,
      Accept: 'application/json'
    });
  }

  private extractList(data: any): any[] {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.events)) return data.events;
    if (data && Array.isArray(data.results)) return data.results;
    if (data && Array.isArray(data.data)) return data.data;
    return [];
  }

  private async ensureLeagues(): Promise<void> {
    if (Date.now() - this.lastLeaguesSync < 6 * 60 * 60 * 1000 && this.leaguesMap.size > 0) return;
    const res = await this.request('/api/v2/leagues/?limit=200');
    const leagues = this.extractList(res.data);
    if (res.status === 200 && leagues.length) {
      this.leaguesMap = new Map();
      for (const l of leagues) {
        this.leaguesMap.set(Number(l.id), { name: String(l.name || ''), country: String(l.country || '') });
      }
      this.lastLeaguesSync = Date.now();
      console.log(`[ExternalFeedAdapter] Loaded ${this.leaguesMap.size} leagues.`);
    } else {
      console.warn(`[ExternalFeedAdapter] Leagues fetch status=${res.status}, items=${leagues.length}; sample=${res.raw.substring(0, 160)}`);
    }
  }
async syncRealMatches(): Promise<{ success: boolean; count: number; message: string }> {
    if (!this.apiKey) {
      this.lastError = 'Nuk është vendosur asnjë API Key';
      throw new Error(this.lastError);
    }

    try {
      await this.ensureLeagues();

      const from = new Date().toISOString().slice(0, 10);
      const to = new Date(Date.now() + FIXTURE_WINDOW_MS).toISOString().slice(0, 10);

      const [liveRes, fixturesRes, odds1x2, oddsOU, oddsBTTS, oddsDC] = await Promise.all([
        this.request('/api/v2/events/live/'),
        this.request(`/api/v2/events/?date_from=${from}&date_to=${to}&limit=200`),
        this.request('/api/v2/odds/?limit=200&market=1x2'),
        this.request('/api/v2/odds/?limit=200&market=over_under_25'),
        this.request('/api/v2/odds/?limit=200&market=btts'),
        this.request('/api/v2/odds/?limit=200&market=double_chance')
      ]);

      if (liveRes.status === 401 || liveRes.status === 403 || fixturesRes.status === 401 || fixturesRes.status === 403) {
        this.lastError = 'Çelësi API (Bzzoiro) është i pasaktë ose ka skaduar kuota';
        throw new Error(this.lastError);
      }

      const liveEvents = this.extractList(liveRes.data);
      const fixtureEvents = this.extractList(fixturesRes.data);

      const eventToMatch = new Map<number, string>();
      let total = 0;

      for (const ev of liveEvents) {
        const matchId = await this.upsertEvent(ev);
        if (matchId) {
          eventToMatch.set(Number(ev.id), matchId);
          total++;
        }
      }
      for (const ev of fixtureEvents) {
        const matchId = await this.upsertEvent(ev);
        if (matchId) {
          eventToMatch.set(Number(ev.id), matchId);
          total++;
        }
      }

      const allOddsItems = [
        ...this.extractList(odds1x2.data),
        ...this.extractList(oddsOU.data),
        ...this.extractList(oddsBTTS.data),
        ...this.extractList(oddsDC.data)
      ];
      if (allOddsItems.length === 0) {
        console.warn('[ExternalFeedAdapter] No odds items parsed. sample responses =>', {
          '1x2': odds1x2.raw.substring(0, 220),
        OU25: oddsOU.raw.substring(0, 140)
        });
      } else {
        console.log(`[ExternalFeedAdapter] Odds items parsed: ${allOddsItems.length}`);
      }
      const oddsApplied = await this.applyOdds(allOddsItems, eventToMatch);

      // Notify live status changes (scores/minute) to any connected dashboard
      for (const ev of liveEvents) {
        const matchId = eventToMatch.get(Number(ev.id));
        if (!matchId || mapStatus(ev.status).status === 'ENDED') continue;
        for (const cb of this.matchStatusCallbacks) {
          cb(matchId, mapStatus(ev.status).status, Number(ev.current_minute) || 0, Number(ev.home_score) || 0, Number(ev.away_score) || 0);
        }
      }

      this.lastSyncTime = new Date();
      this.lastError = null;
      this.importedCount = total;

      console.log(`[ExternalFeedAdapter] Synced ${total} real matches (${oddsApplied} odds updated).`);
      return {
        success: true,
        count: total,
        message: `U importuan ${total} ndeshje reale me kuota nga Bzzoiro.`
      };
    } catch (err: any) {
      this.lastError = err.message || 'Dështoi sinkronizimi me API';
      console.error('[ExternalFeedAdapter] syncRealMatches error:', this.lastError);
      throw err;
    }
  }
private async upsertEvent(ev: any): Promise<string | null> {
    const home = String(ev.home_team || '').trim();
    const away = String(ev.away_team || '').trim();
    const eventId = Number(ev.id);
    if (!home || !away || !eventId) return null;

    const startTime = ev.event_date ? new Date(ev.event_date) : new Date();
    if (isNaN(startTime.getTime())) return null;

    const st = mapStatus(ev.status);
    if (st.status !== 'PREMATCH' && st.status !== 'LIVE') return null; // skip finished/cancelled

    // Resolve league from flat fields (league_id / league_name) OR nested objects (league/competition)
    const nestedLeague: any =
      (ev.league && typeof ev.league === 'object' ? ev.league : null) ||
      (ev.competition && typeof ev.competition === 'object' ? ev.competition : null);
    const leagueId = Number(ev.league_id ?? nestedLeague?.id ?? 0);
    const flatLeagueName = String(ev.league_name || ev.league?.name || ev.competition?.name || ev.tournament?.name || '').trim();

    let league = leagueId ? this.leaguesMap.get(leagueId) : undefined;
    if (!league && flatLeagueName) {
      league = [...this.leaguesMap.values()].find((l) => l.name.toLowerCase() === flatLeagueName.toLowerCase());
    }

    const leagueName = flatLeagueName || league?.name || 'League';
    const categoryName = league?.country ? league.country : guessCategory(leagueName);

    if (this.leagueProbeCount < 3) {
      this.leagueProbeCount++;
      console.log(`[ExternalFeedAdapter] league probe id=${eventId} leagueId=${leagueId} name='${flatLeagueName}' => '${leagueName}' / '${categoryName}'`);
    }

    // Sport: Football
    let dbSport = await prisma.sport.findUnique({ where: { slug: 'football' } });
    if (!dbSport) {
      dbSport = await prisma.sport.create({ data: { name: 'Football', slug: 'football', iconName: 'soccer', sortOrder: 1, isActive: true } });
    }

    let dbCategory = await prisma.category.findFirst({ where: { sportId: dbSport.id, name: categoryName } });
    if (!dbCategory) {
      dbCategory = await prisma.category.create({ data: { sportId: dbSport.id, name: categoryName, slug: slugify(categoryName), countryCode: null, sortOrder: 1 } });
    }

    const tournamentSlug = slugify(leagueName);
    let dbTournament = await prisma.tournament.findFirst({ where: { categoryId: dbCategory.id, slug: tournamentSlug } });
    if (!dbTournament) {
      dbTournament = await prisma.tournament.create({ data: { categoryId: dbCategory.id, name: leagueName, slug: tournamentSlug, sortOrder: 1 } });
    }

    const windowMin = 48 * 60 * 60 * 1000;
    let match = await prisma.match.findFirst({
      where: {
        homeTeam: home,
        awayTeam: away,
        startTime: { gte: new Date(startTime.getTime() - windowMin), lte: new Date(startTime.getTime() + windowMin) },
        status: { in: ['PREMATCH', 'LIVE'] }
      }
    });

    const status = match?.status === 'LIVE' && st.status === 'PREMATCH' ? 'LIVE' : st.status;

    const data: any = {
      tournamentId: dbTournament.id,
      homeTeam: home,
      awayTeam: away,
      startTime,
      status,
      isSimulated: false,
      homeScore: typeof ev.home_score === 'number' ? ev.home_score : 0,
      awayScore: typeof ev.away_score === 'number' ? ev.away_score : 0,
      currentMinute: typeof ev.current_minute === 'number' ? ev.current_minute : (status === 'LIVE' ? st.minute : 0)
    };

    if (match) {
      await prisma.match.update({ where: { id: match.id }, data });
      return match.id;
    }
    const created = await prisma.match.create({ data });
    return created.id;
  }
private async applyOdds(items: any[], eventToMatch: Map<number, string>): Promise<number> {
    let applied = 0;
    const matchCache = new Map<string, any>();

    for (const item of items || []) {
      const eventId = Number(item.event_id ?? item.event);
      const matchId = eventToMatch.get(eventId);
      if (!matchId) {
        if (this.oddsProbeCount < 3) {
          this.oddsProbeCount++;
          console.log(`[ExternalFeedAdapter] odds item skipped event_id=${eventId} item=${JSON.stringify(item).substring(0, 180)}`);
        }
        continue;
      }

      const marketCode = String(item.market || '').toLowerCase();
      const marketType =
        marketCode === '1x2' ? '1X2'
        : marketCode === 'over_under_25' ? 'OVER_UNDER'
        : marketCode === 'btts' ? 'BOTH_TEAMS_SCORE'
        : marketCode === 'double_chance' ? 'DOUBLE_CHANCE'
        : null;
      if (!marketType) continue;

      const specifier = marketCode === 'over_under_25' ? '2.5' : null;
      const outcomeName = this.mapOutcomeName(marketCode, item);
      if (!outcomeName) continue;

      const odds = Math.max(1.01, Math.round((parseFloat(item.decimal_odds) || 1.01) * 100) / 100);

      let match = matchCache.get(matchId);
      if (!match) {
        match = await prisma.match.findUnique({ where: { id: matchId }, include: { markets: true } });
        if (!match) continue;
        matchCache.set(matchId, match);
      }

      let market = (match.markets || []).find((m: any) => m.marketType === marketType && (m.specifier ?? null) === specifier);
      if (!market) {
        market = await prisma.market.create({
          data: {
            matchId,
            marketType,
            name: this.marketName(marketType, specifier),
            specifier,
            status: 'ACTIVE',
            sortOrder: this.marketSort(marketType)
          },
          include: { outcomes: true }
        });
        match.markets.push(market);
      } else if (!market.outcomes) {
        market = await prisma.market.findUnique({ where: { id: market.id }, include: { outcomes: true } });
      }

      const outcomes = market.outcomes || [];
      const outcome = outcomes.find((o: any) => o.name === outcomeName);

      if (outcome) {
        if (Math.abs(outcome.odds - odds) > 0.005) {
          await prisma.outcome.update({ where: { id: outcome.id }, data: { odds, status: 'ACTIVE' } });
          this.broadcastOddsDelta(matchId, outcome.id, outcome.odds, odds);
          applied++;
        }
      } else {
        const created = await prisma.outcome.create({ data: { marketId: market.id, name: outcomeName, odds, status: 'ACTIVE' } });
        this.broadcastOddsDelta(matchId, created.id, odds, odds);
        applied++;
      }
    }
    return applied;
  }
private mapOutcomeName(marketCode: string, item: any): string | null {
    const code = String(item.outcome ?? item.outcome_code ?? '').toUpperCase();
    const name = String(item.outcome_name ?? '').toUpperCase();

    if (marketCode === '1x2') {
      if (code === 'HOME') return '1';
      if (code === 'DRAW') return 'X';
      if (code === 'AWAY') return '2';
      if (name === '1' || name === 'X' || name === '2') return name;
      return null;
    }
    if (marketCode === 'over_under_25') {
      if (code === 'OVER' || name.startsWith('OVER')) return 'Over';
      if (code === 'UNDER' || name.startsWith('UNDER')) return 'Under';
      return null;
    }
    if (marketCode === 'btts') {
      if (code === 'YES' || name.startsWith('YES')) return 'Yes';
      if (code === 'NO' || name.startsWith('NO')) return 'No';
      return null;
    }
    if (marketCode === 'double_chance') {
      for (const c of ['1X', '12', 'X2']) {
        if (code === c || name === c) return c;
      }
      return null;
    }
    return null;
  }

  private marketName(marketType: string, specifier: string | null): string {
    if (marketType === '1X2') return 'Match Winner';
    if (marketType === 'OVER_UNDER') return `Over/Under ${specifier || '2.5'}`;
    if (marketType === 'BOTH_TEAMS_SCORE') return 'Both Teams to Score';
    if (marketType === 'DOUBLE_CHANCE') return 'Double Chance';
    return marketType;
  }

  private marketSort(marketType: string): number {
    if (marketType === '1X2') return 1;
    if (marketType === 'OVER_UNDER') return 2;
    if (marketType === 'BOTH_TEAMS_SCORE') return 3;
    if (marketType === 'DOUBLE_CHANCE') return 4;
    return 5;
  }

  private broadcastOddsDelta(matchId: string, outcomeId: string, oldOdds: number, newOdds: number) {
    const delta: OddsDelta = {
      matchId,
      outcomes: [{ outcomeId, oldOdds, newOdds }]
    };
    for (const cb of this.oddsUpdateCallbacks) {
      cb(delta);
    }
  }
}

export const externalFeedInstance = new ExternalFeedAdapter();