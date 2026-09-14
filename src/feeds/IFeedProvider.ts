export interface MatchEvent {
  matchId: string;
  type: 'GOAL' | 'CORNER' | 'FOUL' | 'YELLOW_CARD' | 'RED_CARD' | 'FREE_KICK' | 'PENALTY' | 'SUBSTITUTION' | 'ATTACK' | 'DANGEROUS_ATTACK' | 'POSSESSION_CHANGE' | 'HALF_TIME' | 'SECOND_HALF' | 'FULL_TIME';
  team: 'HOME' | 'AWAY';
  minute: number;
  data?: any;
}

export interface PitchState {
  matchId: string;
  ballX: number; // 0-100 percentage
  ballY: number; // 0-100 percentage
  possession: 'HOME' | 'AWAY';
  attackState: 'NONE' | 'BUILD_UP' | 'ATTACK' | 'DANGEROUS_ATTACK' | 'CORNER' | 'FREE_KICK' | 'PENALTY' | 'GOAL';
  homeStats: { possession: number; shots: number; shotsOnTarget: number; corners: number; fouls: number; yellowCards: number; redCards: number; };
  awayStats: { possession: number; shots: number; shotsOnTarget: number; corners: number; fouls: number; yellowCards: number; redCards: number; };
}

export interface OddsDelta {
  matchId: string;
  outcomes: { outcomeId: string; oldOdds: number; newOdds: number; }[];
}

export interface IFeedProvider {
  start(): void;
  stop(): void;
  onMatchEvent(callback: (event: MatchEvent) => void): void;
  onPitchUpdate(callback: (state: PitchState) => void): void;
  onOddsUpdate(callback: (delta: OddsDelta) => void): void;
  onMatchStatusChange(callback: (matchId: string, status: string, minute: number, homeScore: number, awayScore: number) => void): void;
}
