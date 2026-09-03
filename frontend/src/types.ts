export interface Player {
  id: number;
  name: string;
  score: number;
  riichi: boolean;
  deviceId?: string; // Unique persistent device identifier
}

export interface GameSettings {
  dobonEnabled: boolean;
  startingPoints: number;
  okaPoints: number;
  multiRonEnabled?: boolean; // Optional Multi-Ron rule (1-pao duo-xiang, default false for Head-Bump/Atama-Hane)
  westRoundEnabled?: boolean; // Optional West-round entry rule
  agariYameEnabled?: boolean; // Optional Agari-Yame rule (finish game if last dealer is 1st)
  kiriageManganEnabled?: boolean; // Optional Kiriage-Mangan rule (4 Han 30 Fu / 3 Han 60 Fu rounded up to Mangan)
}

export interface GameState {
  gameMode?: 'yonma' | 'sanma'; // 'yonma' (4-player) or 'sanma' (3-player)
  players: Player[];
  connectedPlayers: boolean[];
  dealerIndex: number;
  wind: 'east' | 'south' | 'west'; // Support West wind
  round: number;
  honba: number;
  riichiSticks: number;
  isOver: boolean;
  log: string[];
  settings?: GameSettings;
  scoreHistory?: number[][];
  roundHistory?: string[];
  lanUrl?: string;
  roomId?: string; // [PROVISION] 预留多房间 ID 字段 (默认 'default')
}

export interface HistoryInfo {
  canUndo: boolean;
}

// [PROVISION] 预留多房间与公网对局配置接口 (暂时未启用)
export interface RoomInfo {
  roomId: string;
  roomName?: string;
  playerCount: number;
  maxPlayers: number;
  gameMode: 'yonma' | 'sanma';
  isOver: boolean;
  createdAt: number;
}

export interface MultiRoomConfig {
  enabled: boolean;
  serverPublicUrl?: string;
  currentRoomId?: string;
}

export type Theme = 'light' | 'dark' | 'rexx' | 'electronic' | 'majsoul';
