import React, { useState, useEffect, Suspense } from 'react';
import type { GameState, Theme } from '../types';
import { LanClaimSeatStage } from './LanClaimSeatStage';

const ServerPortalStage = React.lazy(() =>
  import('./ServerPortalStage').then(m => ({ default: m.ServerPortalStage }))
);

const ServerClaimSeatStage = React.lazy(() =>
  import('./ServerClaimSeatStage').then(m => ({ default: m.ServerClaimSeatStage }))
);

interface LobbyState {
  roomId?: string;
  locked?: boolean;
  started?: boolean;
  confirmedSeatIds?: number[];
  members?: { seatId: number | null; isHost: boolean }[];
  allConfirmed?: boolean;
}

interface StageResolverProps {
  gameState: GameState;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  onConfirm: (playerId: number, name: string) => void;
  currentRoomId?: string | null;
  onRoomSelect?: (roomId: string) => void;
  onBackToPortal?: () => void;
  onOpenSettings?: () => void;
  onOpenShare?: () => void;
  isHost?: boolean;
  onDisbandRoom?: () => void;
  lobby?: LobbyState | null;
  onStartGame?: (playerName: string, seatId?: number) => void;
  onMoveMember?: (fromSeat: number, toSeat: number) => void;
  onKickPlayer?: (playerId: number) => void;
  onSwapSeats?: (seatA: number, seatB: number) => void;
  onReleaseSeat?: () => void;
  deviceToken?: string;
}

export function getInitialRoomId(): string | null {
  if (typeof window === 'undefined') return null;
  // Lobby / Root paths never carry a roomId
  if (window.location.pathname === '/home' || window.location.pathname === '/home/' || window.location.pathname === '/') return null;
  if ((window as any).__ROOM_ID__) return (window as any).__ROOM_ID__;
  // 1. Path match: e.g. /12345
  const pathMatch = window.location.pathname.match(/^\/(\d{5})\/?$/);
  if (pathMatch) return pathMatch[1];

  return null;
}

export function checkIsServerMode(): boolean {
  if (typeof window === 'undefined') return false;
  // Authoritative server runtime signal: explicit 'lan' disables server mode completely
  if ((window as any).__TARGET_ENV__ === 'lan') return false;
  if ((window as any).__TARGET_ENV__ === 'server') return true;
  if ((import.meta as any).env?.VITE_APP_TARGET === 'server') return true;
  if (window.location.pathname === '/home' || window.location.pathname === '/home/') return true;
  if (/^\/\d{5}\/?$/.test(window.location.pathname)) return true;
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('mode') === 'server') return true;
  return false;
}

/**
 * Stage Resolver (可插拔多阶段生命周期解析器)
 * 
 * Strict URL & Permission Boundaries:
 * - LAN Mode (未挂载):
 *   URL strictly hard-locked to domain.com/
 *   Any non-root path is normalized via replaceState('/')
 *   Directly enters ClaimSeatStage
 * - Server Mode (挂载):
 *   Lobby / Portal: domain.com/home (RoomPortalStage)
 *   Room Stage: domain.com/12345 (ServerClaimSeatStage)
 *   Back to Portal navigates to /home
 */
export const StageResolver: React.FC<StageResolverProps> = (props) => {
  const isServer = checkIsServerMode();

  const [internalRoomId, setInternalRoomId] = useState<string | null>(getInitialRoomId);
  const activeRoomId = props.currentRoomId !== undefined ? props.currentRoomId : internalRoomId;

  const isHomeRoute = typeof window !== 'undefined' && (window.location.pathname === '/home' || window.location.pathname === '/home/');

  // Sync state with browser navigation (Back / Forward)
  useEffect(() => {
    const handlePopState = () => {
      setInternalRoomId(getInitialRoomId());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // URL Normalization Guard: Lock routes based on mode
  useEffect(() => {
    if (!isServer && !isHomeRoute) {
      // Pure LAN Mode: Hard-lock URL strictly to '/'
      if (window.location.pathname !== '/') {
        window.history.replaceState(null, '', '/');
      }
    } else if (isServer) {
      // Server Mode: If accessed at root '/', sync URL to '/home'
      if (window.location.pathname === '/' && !activeRoomId) {
        window.history.replaceState(null, '', '/home');
      }
    }
  }, [isServer, activeRoomId, isHomeRoute]);

  // 1. Explicit /home route or server lobby: strictly points to ServerPortalStage (对局大厅)
  if (isHomeRoute || (isServer && !activeRoomId)) {
    return (
      <Suspense fallback={null}>
        <ServerPortalStage
          theme={props.theme}
          onThemeChange={props.onThemeChange}
          onOpenSettings={props.onOpenSettings}
          onOpenShare={props.onOpenShare}
          deviceToken={props.deviceToken}
          onRoomSelect={(roomId) => {
            if (props.onRoomSelect) {
              props.onRoomSelect(roomId);
            } else {
              window.history.pushState(null, '', `/${roomId}`);
              setInternalRoomId(roomId);
            }
          }}
        />
      </Suspense>
    );
  }

  // 2. Room selected in Server Mode: enter ServerClaimSeatStage (首次加入界面 /:roomId)
  if (isServer && activeRoomId) {
    return (
      <Suspense fallback={null}>
        <ServerClaimSeatStage
          {...props}
          roomId={activeRoomId}
          onBackToPortal={() => {
            if (props.onBackToPortal) {
              props.onBackToPortal();
            } else {
              window.history.pushState(null, '', '/home');
              setInternalRoomId(null);
            }
          }}
        />
      </Suspense>
    );
  }
  // 3. Pure LAN Mode: directly mount LanClaimSeatStage
  return <LanClaimSeatStage {...props} />;
};
