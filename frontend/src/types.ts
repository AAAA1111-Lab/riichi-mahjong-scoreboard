export interface Player {
  id: number;
  name: string;
  score: number;
  riichi: boolean;
  deviceId?: string; // Unique persistent device identifier
}

export interface GameSettings {
  dobonEnabled: boolean; // 开启击飞 (点数低于0终局, 默认开启 true)
  startingPoints: number;
  okaPoints: number; // 1位必要点数 (西入/终局阈值, 如四麻30000/三麻40000)
  multiRonEnabled?: boolean; // Multi-Ron rule (多家和了, 默认开启 true)
  westRoundEnabled?: boolean; // 开启西入/南入 (默认开启 true)
  agariYameEnabled?: boolean; // 开启和了即止 (默认开启 true)
  kiriageManganEnabled?: boolean; // 开启切上满贯 (默认开启 true)
  gameLength?: 'hanchan' | 'tonpuu'; // 局数: 'hanchan' (半庄) | 'tonpuu' (东风), 默认 'hanchan'
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
  canRedo: boolean;
  historyCount?: number;
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
