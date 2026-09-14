import { IFeedProvider, MatchEvent, PitchState, OddsDelta } from './IFeedProvider';

export class ExternalFeedAdapter implements IFeedProvider {
  // TODO: Implement BetsAPI / Sportradar credentials integration here
  
  start() {}
  stop() {}
  onMatchEvent(callback: (event: MatchEvent) => void) {}
  onPitchUpdate(callback: (state: PitchState) => void) {}
  onOddsUpdate(callback: (delta: OddsDelta) => void) {}
  onMatchStatusChange(callback: (matchId: string, status: string, minute: number, homeScore: number, awayScore: number) => void) {}
}
