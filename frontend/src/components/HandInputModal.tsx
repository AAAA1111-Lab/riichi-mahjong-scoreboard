import React, { useState, useEffect } from 'react';
import type { GameState, Player } from '../types';
import { ConfirmModal } from './ConfirmModal';

// Helper function to check and resolve Japanese Mahjong game-over status
const checkGameOver = (gameState: GameState, nextState: GameState, _isDealerWinner: boolean) => {
  const hasNegativeScore = nextState.players.some(p => p.score < 0);
  
  // 1. Dobon (击飞) check: finish game on negative score if 击飞 is enabled
  const dobonEnabled = nextState.settings?.dobonEnabled ?? gameState.settings?.dobonEnabled ?? true;
  if (dobonEnabled && hasNegativeScore) {
    const negativePlayers = nextState.players
      .filter(p => p.score < 0)
      .map(p => `[${p.name}]`)
      .join('、');
    return { isOver: true, msg: `\n[击飞] ${negativePlayers} 点数低于 0，触发击飞终局` };
  }

  const isSanma = gameState.gameMode === 'sanma' || gameState.players.length === 3;
  const maxRound = isSanma ? 3 : 4;
  const isTonpuu = (nextState.settings?.gameLength ?? gameState.settings?.gameLength) === 'tonpuu';
  const westRoundEnabled = nextState.settings?.westRoundEnabled ?? gameState.settings?.westRoundEnabled ?? true;
  const okaPoints = gameState.settings?.okaPoints ?? (isSanma ? 40000 : 30000);
  
  const isEastEnd = gameState.wind === 'east' && gameState.round === maxRound && nextState.dealerIndex === 0;
  const isSouthEnd = gameState.wind === 'south' && gameState.round === maxRound && nextState.dealerIndex === 0;
  const isWestEnd = gameState.wind === 'west' && gameState.round === maxRound && nextState.dealerIndex === 0;

  if (isTonpuu) {
    // 2. East ending (东风战尾局流局/轮庄结束)
    if (isEastEnd) {
      if (westRoundEnabled) {
        const maxScore = Math.max(...nextState.players.map(p => p.score));
        if (maxScore < okaPoints) {
          nextState.wind = 'south';
          nextState.round = 1;
          return { isOver: false, msg: '\n[南入] 东场终局，未达1位必要点数' };
        }
      }
      nextState.wind = 'east';
      nextState.round = maxRound;
      return { isOver: true, msg: '\n[东风终局]' };
    }

    // 3. South ending in Tonpuu (南入打满终局)
    if (isSouthEnd) {
      nextState.wind = 'south';
      nextState.round = maxRound;
      return { isOver: true, msg: '\n[南入终局]' };
    }

    // 4. Sudden death during South round in Tonpuu (南入萨顿死)
    if (gameState.wind === 'south') {
      const maxScore = Math.max(...nextState.players.map(p => p.score));
      if (maxScore >= okaPoints) {
        return { isOver: true, msg: `\n[南入终局] 达到1位必要点数，最高点数 ${maxScore} 点` };
      }
    }
  } else {
    // 2. South ending (半庄战南场终局)
    if (isSouthEnd) {
      if (westRoundEnabled) {
        const maxScore = Math.max(...nextState.players.map(p => p.score));
        if (maxScore < okaPoints) {
          nextState.wind = 'west';
          nextState.round = 1;
          return { isOver: false, msg: '\n[西入] 南场终局，未达1位必要点数' };
        }
      }
      nextState.wind = 'south';
      nextState.round = maxRound;
      return { isOver: true, msg: '\n[半庄终局]' };
    }

    // 3. West ending
    if (isWestEnd) {
      return { isOver: true, msg: '\n[西入终局]' };
    }

    // 4. Sudden death during West round
    if (gameState.wind === 'west') {
      const maxScore = Math.max(...nextState.players.map(p => p.score));
      if (maxScore >= okaPoints) {
        return { isOver: true, msg: `\n[西入终局] 达到1位必要点数，最高点数 ${maxScore} 点` };
      }
    }
  }

  return { isOver: false, msg: '' };
};

interface HandInputModalProps {
  isOpen: boolean;
  onClose: () => void;
  gameState: GameState;
  onConfirm: (newState: GameState, logMsg: string) => void;
  mode: 'tsumo' | 'ron' | 'draw' | null;
  initialWinnerId: number | null;
  theme?: string;
}

export const HandInputModal: React.FC<HandInputModalProps> = ({
  isOpen,
  onClose,
  gameState,
  onConfirm,
  mode,
  initialWinnerId,
  theme
}) => {
  // Loser selection state (only for Ron)
  const [loserId, setLoserId] = useState<number | null>(null);

  // Multi-Ron states
  const multiRonEnabled = gameState.settings?.multiRonEnabled ?? false;
  const [activeWinnerId, setActiveWinnerId] = useState<number | null>(null);

  // State map for individual winner scores in Ron mode
  interface WinnerScoreState {
    basePoints: number;
    customPointsVal: string;
  }
  const [winnerScores, setWinnerScores] = useState<{ [id: number]: WinnerScoreState }>({});

  // Tsumo individual payments
  const [tsumoKoPay, setTsumoKoPay] = useState<number>(0);
  const [tsumoOyaPay, setTsumoOyaPay] = useState<number>(0);
  const [customKoVal, setCustomKoVal] = useState<string>('');
  const [customOyaVal, setCustomOyaVal] = useState<string>('');

  // Draw state
  const [tenpaiStates, setTenpaiStates] = useState<boolean[]>([false, false, false, false]);
  const [isMidGameDraw, setIsMidGameDraw] = useState<boolean>(false);
  const [isChombo, setIsChombo] = useState<boolean>(false);
  const [isNagashiMangan, setIsNagashiMangan] = useState<boolean>(false);
  const [dealerRenchanOnNagashi, setDealerRenchanOnNagashi] = useState<boolean>(false);

  const { players, dealerIndex, honba, riichiSticks } = gameState;
  const kiriageManganEnabled = gameState.settings?.kiriageManganEnabled ?? true;

  // REXX 专用 LED 闪烁状态：每 1000ms (1s) 切换一次
  const [isBlinkOn, setIsBlinkOn] = useState<boolean>(true);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || theme !== 'rexx') return;
    const interval = setInterval(() => {
      setIsBlinkOn(prev => !prev);
    }, 1000);
    return () => clearInterval(interval);
  }, [isOpen, theme]);

  const defaultWinnerId = initialWinnerId ?? 0;

  // Reset inputs when modal opens or mode changes
  useEffect(() => {
    if (isOpen) {
      setLoserId(null);
      const initW = initialWinnerId !== null ? initialWinnerId : 0;
      setActiveWinnerId(initW);

      const initialMap: { [id: number]: WinnerScoreState } = {};
      players.forEach(p => {
        initialMap[p.id] = {
          basePoints: 0,
          customPointsVal: '',
        };
      });
      setWinnerScores(initialMap);

      setTsumoKoPay(0);
      setTsumoOyaPay(0);
      setCustomKoVal('');
      setCustomOyaVal('');
      setTenpaiStates([false, false, false, false]);
      setIsMidGameDraw(false);
      setIsChombo(false);
      setIsNagashiMangan(false);
      setDealerRenchanOnNagashi(false);
    }
  }, [isOpen, mode, initialWinnerId]);

  const isSanma = gameState.gameMode === 'sanma' || players.length === 3;
  const playerCount = isSanma ? 3 : 4;

  const getPlayerWindName = (idx: number) => {
    const winds = ['东', '南', '西', '北'];
    const relativeIdx = (idx - dealerIndex + playerCount) % playerCount;
    return winds[relativeIdx];
  };

  const getPlayerDisplayName = (p: Player) => {
    const windName = getPlayerWindName(p.id);
    return `${p.name} (${windName})`;
  };

  const getLogPlayerDisplayName = (p: Player) => {
    const windName = getPlayerWindName(p.id);
    return `[${p.name}] (${windName})`;
  };

  const winner = initialWinnerId !== null ? players[initialWinnerId] : null;
  const isDealerWinner = initialWinnerId === dealerIndex;
  const isWinnerRiichi = !!winner?.riichi;

  // Helper to update active winner score
  const updateWinnerScore = (wId: number, partial: Partial<WinnerScoreState>) => {
    setWinnerScores(prev => ({
      ...prev,
      [wId]: {
        ...(prev[wId] || {
          basePoints: 0,
          customPointsVal: '',
        }),
        ...partial
      }
    }));
  };

  const activeWinnerState = (activeWinnerId !== null && winnerScores[activeWinnerId]) ? winnerScores[activeWinnerId] : {
    basePoints: 0,
    customPointsVal: '',
  };
  const isActiveWinnerRiichi = activeWinnerId !== null ? !!players[activeWinnerId]?.riichi : false;

  // 获取当前所有有效的和牌玩家 ID 列表（分数 > 0 且非放铳家的玩家）
  const getActiveWinners = () => {
    if (mode !== 'ron') return initialWinnerId !== null ? [initialWinnerId] : [];
    if (loserId === null) return [defaultWinnerId];
    if (multiRonEnabled) {
      const winners = players
        .map(p => p.id)
        .filter(id => id !== loserId && (winnerScores[id]?.basePoints || 0) > 0);
      return winners.length > 0 ? winners : [defaultWinnerId];
    } else {
      return [defaultWinnerId];
    }
  };

  // 选择放铳家：若选中的放铳家正好是当前录入目标，切回默认玩家
  const handleSelectLoser = (pId: number) => {
    setLoserId(pId);
    if (activeWinnerId === pId) {
      setActiveWinnerId(defaultWinnerId);
    }
    // 放铳家分值清 0
    updateWinnerScore(pId, { basePoints: 0, customPointsVal: '' });
  };

  // 极简追加和牌家逻辑：另外两个玩家的框只负责指定玩家，都不选就是默认玩家；取消录分应该再点分值取消
  const handleToggleAdditionalWinner = (pId: number) => {
    if (activeWinnerId === pId) {
      // 再次点击当前指定的玩家 -> 取消指定，恢复为默认玩家
      setActiveWinnerId(defaultWinnerId);
    } else {
      // 指定该玩家为当前录分目标（保留其已有分数，不修改任何人的分数）
      setActiveWinnerId(pId);
    }
  };

  // Preset button selection handlers (再点一下撤销)
  const handleRonPresetSelect = (val: number) => {
    if (activeWinnerId === null) return;
    const curPts = activeWinnerState.basePoints;
    if (curPts === val) {
      // 再点一下分值撤销归 0
      updateWinnerScore(activeWinnerId, {
        basePoints: 0,
        customPointsVal: ''
      });
    } else {
      updateWinnerScore(activeWinnerId, {
        basePoints: val,
        customPointsVal: val.toString()
      });
    }
  };

  const handleTsumoPresetSelect = (ko: number, oya: number) => {
    if (tsumoKoPay === ko && tsumoOyaPay === oya) {
      // 再点一下撤销
      setTsumoKoPay(0);
      setTsumoOyaPay(0);
      setCustomKoVal('');
      setCustomOyaVal('');
    } else {
      setTsumoKoPay(ko);
      setTsumoOyaPay(oya);
      setCustomKoVal(ko.toString());
      setCustomOyaVal(oya.toString());
    }
  };

  // Custom Tsumo payments input handler
  const handleKoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setCustomKoVal(val);
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed)) {
      setTsumoKoPay(parsed);
      if (initialWinnerId !== dealerIndex) {
        setTsumoOyaPay(parsed * 2);
        setCustomOyaVal((parsed * 2).toString());
      } else {
        setTsumoOyaPay(parsed);
        setCustomOyaVal(parsed.toString());
      }
    } else {
      setTsumoKoPay(0);
    }
  };

  const handleOyaChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setCustomOyaVal(val);
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed)) {
      setTsumoOyaPay(parsed);
    } else {
      setTsumoOyaPay(0);
    }
  };

  // Format preset label text (Force Line Break & Rename Mangan)
  const formatPresetLabel = (label: string) => {
    const cleaned = label
      .replace('子双倍役满', '双倍役满')
      .replace('庄双倍役满', '双倍役满')
      .replace('子满贯', '满贯')
      .replace('庄满贯', '满贯')
      .replace('子跳满', '跳满')
      .replace('庄跳满', '跳满')
      .replace('子倍满', '倍满')
      .replace('庄倍满', '倍满')
      .replace('子三倍满', '三倍满')
      .replace('庄三倍满', '三倍满')
      .replace('子役满', '役满')
      .replace('庄役满', '役满');

    const parenIndex = cleaned.indexOf('(');
    if (parenIndex !== -1) {
      const score = cleaned.substring(0, parenIndex).trim();
      const desc = cleaned.substring(parenIndex).replace(/[()（）]/g, '').trim();
      return (
        <>
          <span className="preset-score" style={{ fontSize: '0.85rem', display: 'block', fontWeight: 800 }}>{score}</span>
          <span className="preset-desc" style={{ fontSize: '0.62rem', display: 'block', marginTop: '2px' }}>{desc}</span>
        </>
      );
    }
    return label;
  };

  // Preset point lists (dynamically include 4 Han 30 Fu if Kiriage Mangan is disabled)
  const normalPresetCount = kiriageManganEnabled ? 9 : 10;

  const getRonPresets = (isDealer: boolean = isDealerWinner) => {
    if (isDealer) {
      const presets = [
        { label: '1500 (1番30符)', val: 1500 },
        { label: '2000 (1番40符)', val: 2000 },
        { label: '2400 (2番25符/1番50符)', val: 2400 },
        { label: '2900 (2番30符)', val: 2900 },
        { label: '3900 (2番40符)', val: 3900 },
        { label: '4800 (3番25符/2番50符)', val: 4800 },
        { label: '5800 (3番30符)', val: 5800 },
        { label: '7700 (3番40符)', val: 7700 },
        { label: '9600 (4番25符/3番50符)', val: 9600 },
      ];
      if (!kiriageManganEnabled) {
        presets.push({ label: '11600 (4番30符)', val: 11600 });
      }
      presets.push(
        { label: '12000 (庄满贯)', val: 12000 },
        { label: '18000 (庄跳满)', val: 18000 },
        { label: '24000 (庄倍满)', val: 24000 },
        { label: '36000 (庄三倍满)', val: 36000 },
        { label: '48000 (庄役满)', val: 48000 },
        { label: '96000 (庄双倍役满)', val: 96000 }
      );
      return presets;
    } else {
      const presets = [
        { label: '1000 (1番30符)', val: 1000 },
        { label: '1300 (1番40符)', val: 1300 },
        { label: '1600 (2番25符/1番50符)', val: 1600 },
        { label: '2000 (2番30符)', val: 2000 },
        { label: '2600 (2番40符)', val: 2600 },
        { label: '3200 (3番25符/2番50符)', val: 3200 },
        { label: '3900 (3番30符)', val: 3900 },
        { label: '5200 (3番40符)', val: 5200 },
        { label: '6400 (4番25符/3番50符)', val: 6400 },
      ];
      if (!kiriageManganEnabled) {
        presets.push({ label: '7700 (4番30符)', val: 7700 });
      }
      presets.push(
        { label: '8000 (子满贯)', val: 8000 },
        { label: '12000 (子跳满)', val: 12000 },
        { label: '16000 (子倍满)', val: 16000 },
        { label: '24000 (子三倍满)', val: 24000 },
        { label: '32000 (子役满)', val: 32000 },
        { label: '64000 (子双倍役满)', val: 64000 }
      );
      return presets;
    }
  };

  const getDealerTsumoPresets = () => {
    const presets = [
      { label: '500 all (1番30符)', ko: 500, oya: 500 },
      { label: '700 all (1番40符)', ko: 700, oya: 700 },
      { label: '800 all (2番25符/1番50符)', ko: 800, oya: 800 },
      { label: '1000 all (2番30符)', ko: 1000, oya: 1000 },
      { label: '1300 all (2番40符/3番20符)', ko: 1300, oya: 1300 },
      { label: '1600 all (3番25符/2番50符)', ko: 1600, oya: 1600 },
      { label: '2000 all (3番30符)', ko: 2000, oya: 2000 },
      { label: '2600 all (3番40符/4番20符)', ko: 2600, oya: 2600 },
      { label: '3200 all (4番25符/3番50符)', ko: 3200, oya: 3200 },
    ];
    if (!kiriageManganEnabled) {
      presets.push({ label: '3900 all (4番30符)', ko: 3900, oya: 3900 });
    }
    presets.push(
      { label: '4000 all (庄满贯)', ko: 4000, oya: 4000 },
      { label: '6000 all (庄跳满)', ko: 6000, oya: 6000 },
      { label: '8000 all (庄倍满)', ko: 8000, oya: 8000 },
      { label: '12000 all (庄三倍满)', ko: 12000, oya: 12000 },
      { label: '16000 all (庄役满)', ko: 16000, oya: 16000 },
      { label: '32000 all (庄双倍役满)', ko: 32000, oya: 32000 }
    );
    return presets;
  };

  const getNonDealerTsumoPresets = () => {
    const presets = [
      { label: '300/500 (1番30符)', ko: 300, oya: 500 },
      { label: '400/700 (1番40符/2番20符)', ko: 400, oya: 700 },
      { label: '400/800 (2番25符/1番50符)', ko: 400, oya: 800 },
      { label: '500/1000 (2番30符)', ko: 500, oya: 1000 },
      { label: '700/1300 (2番40符/3番20符)', ko: 700, oya: 1300 },
      { label: '800/1600 (3番25符/2番50符)', ko: 800, oya: 1600 },
      { label: '1000/2000 (3番30符)', ko: 1000, oya: 2000 },
      { label: '1300/2600 (3番40符/4番20符)', ko: 1300, oya: 2600 },
      { label: '1600/3200 (4番25符/3番50符)', ko: 1600, oya: 3200 },
    ];
    if (!kiriageManganEnabled) {
      presets.push({ label: '2000/3900 (4番30符)', ko: 2000, oya: 3900 });
    }
    presets.push(
      { label: '2000/4000 (子满贯)', ko: 2000, oya: 4000 },
      { label: '3000/6000 (子跳满)', ko: 3000, oya: 6000 },
      { label: '4000/8000 (子倍满)', ko: 4000, oya: 8000 },
      { label: '6000/12000 (子三倍满)', ko: 6000, oya: 12000 },
      { label: '8000/16000 (子役满)', ko: 8000, oya: 16000 },
      { label: '16000/32000 (子双倍役满)', ko: 16000, oya: 32000 }
    );
    return presets;
  };

  const handleTenpaiToggle = (index: number) => {
    const nextStates = [...tenpaiStates];
    nextStates[index] = !nextStates[index];
    setTenpaiStates(nextStates);
  };

  const handleNagashiToggle = () => {
    const nextNagashi = !isNagashiMangan;
    setIsNagashiMangan(nextNagashi);
    if (nextNagashi) {
      setIsMidGameDraw(false);
      setIsChombo(false);
      setDealerRenchanOnNagashi(false);
    }
  };

  const handleChomboToggle = () => {
    const nextChombo = !isChombo;
    setIsChombo(nextChombo);
    if (nextChombo) {
      setIsMidGameDraw(false);
      setIsNagashiMangan(false);
    }
  };

  const handleMidGameDrawToggle = () => {
    const nextMid = !isMidGameDraw;
    setIsMidGameDraw(nextMid);
    if (nextMid) {
      setIsChombo(false);
      setIsNagashiMangan(false);
      setTenpaiStates(players.map(() => true));
    } else {
      setTenpaiStates(players.map(() => false));
    }
  };

  // Dry-run calculation to get the next state, log message, and score changes
  const calculateNextState = (): { nextState: GameState; logMsg: string; scoreDiffs: number[] } | null => {
    const windChar = gameState.wind === 'east' ? '东' : (gameState.wind === 'south' ? '南' : '西');
    const roundPrefix = `[${windChar}${gameState.round}局|${honba}本场]`;

    if (mode === 'tsumo' || mode === 'ron') {
      const isSanma = gameState.gameMode === 'sanma' || players.length === 3;
      const playerCount = isSanma ? 3 : 4;
      const scoreDiffs = isSanma ? [0, 0, 0] : [0, 0, 0, 0];

      if (mode === 'tsumo') {
        if (initialWinnerId === null) return null;
        if (isDealerWinner) {
          if (!tsumoKoPay || tsumoKoPay <= 0 || tsumoKoPay % 100 !== 0) return null;
        } else {
          if (!tsumoKoPay || !tsumoOyaPay || tsumoKoPay <= 0 || tsumoOyaPay <= 0 || tsumoKoPay % 100 !== 0 || tsumoOyaPay % 100 !== 0) return null;
        }
      } else {
        // Ron mode validation
        if (loserId === null) return null;

        let currentWinners: number[] = [];
        if (multiRonEnabled) {
          currentWinners = players
            .map(p => p.id)
            .filter(id => id !== loserId && (winnerScores[id]?.basePoints || 0) > 0);
        } else {
          const defaultPts = winnerScores[defaultWinnerId]?.basePoints || 0;
          if (defaultPts > 0) {
            currentWinners = [defaultWinnerId];
          }
        }

        if (currentWinners.length === 0) return null;
        for (const wId of currentWinners) {
          const pts = winnerScores[wId]?.basePoints || 0;
          if (!pts || pts <= 0 || pts % 100 !== 0) return null;
        }
      }

      const nextState = JSON.parse(JSON.stringify(gameState)) as GameState;
      const tableRiichiPoints = riichiSticks * 1000;
      nextState.riichiSticks = 0;
      nextState.players.forEach(p => p.riichi = false);

      let logMsg = '';
      let isAnyDealerWinner = false;

      if (mode === 'tsumo') {
        isAnyDealerWinner = isDealerWinner;
        const honbaPayment = honba * 100;
        let totalCollected = 0;

        nextState.players.forEach((p) => {
          if (p.id === initialWinnerId) return;

          let payment = 0;
          if (isDealerWinner) {
            payment = tsumoKoPay + honbaPayment;
          } else {
            if (p.id === dealerIndex) {
              payment = tsumoOyaPay + honbaPayment;
            } else {
              payment = tsumoKoPay + honbaPayment;
            }
          }

          p.score -= payment;
          scoreDiffs[p.id] = -payment;
          totalCollected += payment;
        });

        const totalWin = totalCollected + tableRiichiPoints;
        nextState.players[initialWinnerId!].score += totalWin;
        scoreDiffs[initialWinnerId!] = totalWin;

        let baseStr = '';
        if (honba === 0) {
          baseStr = isDealerWinner ? `${tsumoKoPay}all` : `${tsumoKoPay}/${tsumoOyaPay}`;
        } else {
          const actualKoPay = tsumoKoPay + honba * 100;
          if (isDealerWinner) {
            baseStr = `${tsumoKoPay}all·${actualKoPay}all`;
          } else {
            const actualOyaPay = tsumoOyaPay + honba * 100;
            baseStr = `${tsumoKoPay}/${tsumoOyaPay}·${actualKoPay}/${actualOyaPay}`;
          }
        }
        const extraStr = tableRiichiPoints > 0 ? `+${tableRiichiPoints}` : '';
        logMsg = `${roundPrefix}[自摸]${getLogPlayerDisplayName(players[initialWinnerId!])} 自摸 ${baseStr}${extraStr} 点`;
      } else {
        // Ron (Single Ron or Multi-Ron)
        let currentWinners: number[] = [];
        if (multiRonEnabled) {
          currentWinners = players
            .map(p => p.id)
            .filter(id => id !== loserId && (winnerScores[id]?.basePoints || 0) > 0);
        } else {
          currentWinners = [defaultWinnerId];
        }
        isAnyDealerWinner = currentWinners.includes(dealerIndex);

        // 头跳判定（供托立直棒与本场棒归属）：以放铳者为原点，顺时针步数最小的获胜者独得全部立直棒与本场棒
        let headBumpWinnerId = currentWinners[0];
        let minDistance = (headBumpWinnerId - loserId! + playerCount) % playerCount;
        for (const wId of currentWinners) {
          const dist = (wId - loserId! + playerCount) % playerCount;
          if (dist < minDistance) {
            minDistance = dist;
            headBumpWinnerId = wId;
          }
        }

        let totalLoss = 0;
        const winnerSummaryList: string[] = [];

        for (const wId of currentWinners) {
          const basePts = winnerScores[wId]?.basePoints || 0;
          const isHeadBump = (wId === headBumpWinnerId);
          // 本场棒与立直棒均按照顺时针头跳只给第一位获胜者一次
          const honbaPts = isHeadBump ? honba * 300 : 0;
          const riichiPts = isHeadBump ? tableRiichiPoints : 0;
          const winGain = basePts + honbaPts + riichiPts;

          nextState.players[wId].score += winGain;
          scoreDiffs[wId] = winGain;

          const loserPay = basePts + honbaPts;
          totalLoss += loserPay;

          let extraStr = '';
          if (riichiPts > 0) extraStr += `+${riichiPts}`;
          let ptsSummary = '';
          if (honba === 0) {
            ptsSummary = `${basePts}${extraStr}`;
          } else {
            if (isHeadBump) {
              ptsSummary = `${basePts}·${loserPay}${extraStr}`;
            } else {
              ptsSummary = `${basePts}${extraStr}`;
            }
          }
          winnerSummaryList.push(`${getLogPlayerDisplayName(players[wId])} 荣和 ${getLogPlayerDisplayName(players[loserId!])} ${ptsSummary} 点`);
        }

        nextState.players[loserId!].score -= totalLoss;
        scoreDiffs[loserId!] = -totalLoss;

        if (currentWinners.length > 1) {
          logMsg = `${roundPrefix}[多家和了]\n${winnerSummaryList.join('\n')}`;
        } else {
          const wId = currentWinners[0];
          const basePts = winnerScores[wId]?.basePoints || 0;
          const riichiPts = tableRiichiPoints;
          let extraStr = '';
          if (riichiPts > 0) extraStr += `+${riichiPts}`;
          let ptsStr = '';
          if (honba === 0) {
            ptsStr = `${basePts}${extraStr}`;
          } else {
            ptsStr = `${basePts}·${basePts + honba * 300}${extraStr}`;
          }
          logMsg = `${roundPrefix}[荣和]${getLogPlayerDisplayName(players[wId])} 荣和 ${getLogPlayerDisplayName(players[loserId!])} ${ptsStr} 点`;
        }
      }

      // Dealer advancement / rotation rules
      if (isAnyDealerWinner) {
        nextState.honba += 1;

        // Check Agari-Yame (尾亲一位完场) rule
        const maxRound = isSanma ? 3 : 4;
        const lastDealerIdx = isSanma ? 2 : 3;
        const agariYameEnabled = gameState.settings?.agariYameEnabled ?? true;
        const okaPoints = gameState.settings?.okaPoints ?? (isSanma ? 40000 : 30000);
        const isTonpuu = (nextState.settings?.gameLength ?? gameState.settings?.gameLength) === 'tonpuu';

        const isLastDealerRound = isTonpuu
          ? (gameState.wind === 'east' || gameState.wind === 'south') && gameState.round === maxRound && gameState.dealerIndex === lastDealerIdx
          : (gameState.wind === 'south' || gameState.wind === 'west') && gameState.round === maxRound && gameState.dealerIndex === lastDealerIdx;

        const hasNegativeScore = nextState.players.some(p => p.score < 0);
        const dobonEnabled = nextState.settings?.dobonEnabled ?? gameState.settings?.dobonEnabled ?? true;
        const isDobon = dobonEnabled && hasNegativeScore;

        if (agariYameEnabled && isLastDealerRound && !isDobon) {
          const dealerScore = nextState.players[lastDealerIdx].score;
          const maxScore = Math.max(...nextState.players.map(p => p.score));
          if (dealerScore === maxScore && dealerScore >= okaPoints) {
            nextState.isOver = true;
            logMsg += '\n[和了即止]';
          }
        }
      } else {
        nextState.honba = 0;
        nextState.dealerIndex = (dealerIndex + 1) % playerCount;

        if (nextState.dealerIndex === 0) {
          if (nextState.wind === 'east') {
            nextState.wind = 'south';
            nextState.round = 1;
          } else if (nextState.wind === 'south') {
            nextState.wind = 'west';
            nextState.round = 1;
          } else {
            nextState.round = (nextState.round % 4) + 1;
          }
        } else {
          nextState.round = nextState.dealerIndex + 1;
        }
      }

      // Check game end conditions
      const overCheck = checkGameOver(gameState, nextState, isAnyDealerWinner);
      nextState.isOver = nextState.isOver || overCheck.isOver;
      logMsg += overCheck.msg;

      
      
      if (!nextState.scoreHistory) {
        nextState.scoreHistory = [];
      }
      nextState.scoreHistory.push(nextState.players.map(p => p.score));
      
      if (!nextState.roundHistory) {
        nextState.roundHistory = ['起点'];
      }
      const roundName = `${windChar}${gameState.round}`;
      nextState.roundHistory.push(roundName);

      return { nextState, logMsg, scoreDiffs };
    } else if (mode === 'draw') {
      const nextState = JSON.parse(JSON.stringify(gameState)) as GameState;
      const isSanma = gameState.gameMode === 'sanma' || players.length === 3;
      const scoreDiffs = isSanma ? [0, 0, 0] : [0, 0, 0, 0];

      if (isChombo) {
        // 诈和模式：至少勾选 1 名犯规玩家
        const chomboIndices = tenpaiStates
          .map((t, idx) => (t ? idx : -1))
          .filter(idx => idx !== -1);

        if (chomboIndices.length === 0) {
          return null;
        }

        const totalPlayers = players.length;
        const chomboCount = chomboIndices.length;
        const innocentCount = totalPlayers - chomboCount;
        const penaltyPerOther = 3000;

        nextState.players.forEach((p, idx) => {
          const isGuilty = chomboIndices.includes(idx);
          if (isGuilty) {
            // 每名诈和者向每名未诈和者支付 3000 点
            const payAmount = penaltyPerOther * innocentCount;
            p.score -= payAmount;
            scoreDiffs[idx] = -payAmount;
          } else {
            // 每名未诈和者从每名诈和者各收取 3000 点
            const receiveAmount = penaltyPerOther * chomboCount;
            p.score += receiveAmount;
            scoreDiffs[idx] = receiveAmount;
          }
          p.riichi = false;
        });

        // 诈和规则：局况不推进，本场数不变 (重打当前小局)
        nextState.honba = gameState.honba;
        nextState.dealerIndex = gameState.dealerIndex;
        nextState.wind = gameState.wind;
        nextState.round = gameState.round;

        const chomboNames = chomboIndices.map(idx => `[${players[idx].name}]`).join('、');
        let logMsg = chomboCount === 1
          ? `${roundPrefix}[诈和] ${chomboNames} 支付其余 ${innocentCount} 人各 3000 点，本场数不变`
          : `${roundPrefix}[诈和] ${chomboNames} 共 ${chomboCount} 人各支付其余 ${innocentCount} 人 3000 点，本场数不变`;

        // 检查击飞
        const overCheck = checkGameOver(gameState, nextState, false);
        nextState.isOver = nextState.isOver || overCheck.isOver;
        logMsg += overCheck.msg;

        if (!nextState.scoreHistory) {
          nextState.scoreHistory = [];
        }
        nextState.scoreHistory.push(nextState.players.map(p => p.score));

        if (!nextState.roundHistory) {
          nextState.roundHistory = ['起点'];
        }
        const roundName = `${windChar}${gameState.round}`;
        nextState.roundHistory.push(roundName);

        return { nextState, logMsg, scoreDiffs };
      }

      if (isNagashiMangan) {
        const nagashiWinners = players
          .map((_, idx) => (tenpaiStates[idx] ? idx : -1))
          .filter(idx => idx !== -1);

        if (nagashiWinners.length === 0) {
          return null;
        }

        // 流局满贯点数计算：
        // 庄家达成：各闲家支付 4000 点 (四麻 +12000，三麻 +8000)
        // 闲家达成：庄家支付 4000 点，其余闲家支付 2000 点 (四麻 +8000，三麻 +6000)
        // 多人达成：各家点数互抵
        nagashiWinners.forEach(wId => {
          const isWinnerDealer = wId === dealerIndex;
          players.forEach((_, pId) => {
            if (pId === wId) return;
            const pay = isWinnerDealer ? 4000 : (pId === dealerIndex ? 4000 : 2000);
            scoreDiffs[wId] += pay;
            scoreDiffs[pId] -= pay;
          });
        });

        nextState.players.forEach((p, idx) => {
          p.score += scoreDiffs[idx];
          p.riichi = false;
        });

        // 供托立直棒保留到下一局 (不被流局满贯收取)
        // 本场数增加 1 (但不加算本场符数)
        nextState.honba += 1;

        // 连庄判断：流局满贯庄家仍需听牌连庄，未听则轮庄
        const isDealerRenchan = dealerRenchanOnNagashi;

        let logMsg = '';
        const renchanStr = isDealerRenchan ? '庄家听牌，连庄' : '轮庄';
        if (nagashiWinners.length === 1) {
          const wId = nagashiWinners[0];
          const isWinnerDealer = wId === dealerIndex;
          const scoreStr = isWinnerDealer ? '4000all' : '2000/4000';
          logMsg = `${roundPrefix}[流局] ${getLogPlayerDisplayName(players[wId])} 流局满贯 ${scoreStr} 点，${renchanStr}`;
        } else {
          const winnerStrs = nagashiWinners
            .map(wId => `${getLogPlayerDisplayName(players[wId])} ${wId === dealerIndex ? '4000all' : '2000/4000'}`)
            .join('、');
          logMsg = `${roundPrefix}[流局] ${winnerStrs} 流局满贯，${renchanStr}`;
        }

        if (isDealerRenchan) {
          // Check Tenpai-Yame (尾亲听牌一位完场) rule
          const maxRound = isSanma ? 3 : 4;
          const lastDealerIdx = isSanma ? 2 : 3;
          const agariYameEnabled = gameState.settings?.agariYameEnabled ?? true;
          const okaPoints = gameState.settings?.okaPoints ?? (isSanma ? 40000 : 30000);
          const isTonpuu = (nextState.settings?.gameLength ?? gameState.settings?.gameLength) === 'tonpuu';

          const isLastDealerRound = isTonpuu
            ? (gameState.wind === 'east' || gameState.wind === 'south') && gameState.round === maxRound && gameState.dealerIndex === lastDealerIdx
            : (gameState.wind === 'south' || gameState.wind === 'west') && gameState.round === maxRound && gameState.dealerIndex === lastDealerIdx;

          const hasNegativeScore = nextState.players.some(p => p.score < 0);
          const dobonEnabled = nextState.settings?.dobonEnabled ?? gameState.settings?.dobonEnabled ?? true;
          const isDobon = dobonEnabled && hasNegativeScore;

          if (agariYameEnabled && isLastDealerRound && !isDobon) {
            const dealerScore = nextState.players[lastDealerIdx].score;
            const maxScore = Math.max(...nextState.players.map(p => p.score));
            if (dealerScore === maxScore && dealerScore >= okaPoints) {
              nextState.isOver = true;
              logMsg += '\n[听牌即止]';
            }
          }
        } else {
          nextState.dealerIndex = (dealerIndex + 1) % (isSanma ? 3 : 4);
          if (nextState.dealerIndex === 0) {
            if (nextState.wind === 'east') {
              nextState.wind = 'south';
              nextState.round = 1;
            } else if (nextState.wind === 'south') {
              nextState.wind = 'west';
              nextState.round = 1;
            } else {
              nextState.round = (nextState.round % 4) + 1;
            }
          } else {
            nextState.round = nextState.dealerIndex + 1;
          }
        }

        // Check game end conditions
        const overCheck = checkGameOver(gameState, nextState, isDealerRenchan);
        nextState.isOver = nextState.isOver || overCheck.isOver;
        logMsg += overCheck.msg;

        if (!nextState.scoreHistory) {
          nextState.scoreHistory = [];
        }
        nextState.scoreHistory.push(nextState.players.map(p => p.score));

        if (!nextState.roundHistory) {
          nextState.roundHistory = ['起点'];
        }
        const roundName = `${windChar}${gameState.round}`;
        nextState.roundHistory.push(roundName);

        return { nextState, logMsg, scoreDiffs };
      }

      const totalPlayers = isSanma ? 3 : 4;
      const tenpaiCount = tenpaiStates.filter(t => t).length;
      const isDealerTenpai = tenpaiStates[dealerIndex];

      let winPoints = 0;
      let losePoints = 0;
      if (tenpaiCount > 0 && tenpaiCount < totalPlayers) {
        if (isSanma) {
          // 三麻荒牌流局罚符 (场况总额 2000 点):
          // 1人听牌: 听牌者 +2000，2位未听者各 -1000
          // 2人听牌: 2位听牌者各 +1000，1位未听者 -2000
          winPoints = tenpaiCount === 1 ? 2000 : 1000;
          losePoints = tenpaiCount === 1 ? 1000 : 2000;
        } else {
          // 四麻荒牌流局罚符 (场况总额 3000 点):
          // 1人听牌: 听牌者 +3000，3位未听者各 -1000
          // 2人听牌: 2位听牌者各 +1500，2位未听者各 -1500
          // 3人听牌: 3位听牌者各 +1000，1位未听者 -3000
          winPoints = 3000 / tenpaiCount;
          losePoints = 3000 / (4 - tenpaiCount);
        }

        nextState.players.forEach((p, idx) => {
          if (tenpaiStates[idx]) {
            p.score += winPoints;
            scoreDiffs[idx] = winPoints;
          } else {
            p.score -= losePoints;
            scoreDiffs[idx] = -losePoints;
          }
        });
      }

      let logMsg = '';
      if (isMidGameDraw) {
        logMsg = `${roundPrefix}[荒牌流局] 中途流局，连庄`;
      } else {
        if (tenpaiCount === totalPlayers) {
          logMsg = `${roundPrefix}[荒牌流局] 全员听牌，连庄`;
        } else if (tenpaiCount === 0) {
          logMsg = `${roundPrefix}[荒牌流局] 全员不听，轮庄`;
        } else {
          const tenpaiPlayersStr = players
            .filter((_, idx) => tenpaiStates[idx])
            .map(p => getLogPlayerDisplayName(p))
            .join(' ');
          logMsg = `${roundPrefix}[荒牌流局] ${tenpaiPlayersStr} 听牌，( +${winPoints}/-${losePoints} 点)，${isDealerTenpai ? '连庄' : '轮庄'}`;
        }
      }

      nextState.players.forEach(p => p.riichi = false);

      if (isDealerTenpai) {
        nextState.honba += 1;

        // Check Tenpai-Yame (尾亲听牌一位完场) rule
        const isSanma = gameState.gameMode === 'sanma' || gameState.players.length === 3;
        const maxRound = isSanma ? 3 : 4;
        const lastDealerIdx = isSanma ? 2 : 3;
        const agariYameEnabled = gameState.settings?.agariYameEnabled ?? true;
        const okaPoints = gameState.settings?.okaPoints ?? (isSanma ? 40000 : 30000);
        const isTonpuu = (nextState.settings?.gameLength ?? gameState.settings?.gameLength) === 'tonpuu';

        const isLastDealerRound = isTonpuu
          ? (gameState.wind === 'east' || gameState.wind === 'south') && gameState.round === maxRound && gameState.dealerIndex === lastDealerIdx
          : (gameState.wind === 'south' || gameState.wind === 'west') && gameState.round === maxRound && gameState.dealerIndex === lastDealerIdx;

        const hasNegativeScore = nextState.players.some(p => p.score < 0);
        const dobonEnabled = nextState.settings?.dobonEnabled ?? gameState.settings?.dobonEnabled ?? true;
        const isDobon = dobonEnabled && hasNegativeScore;

        if (agariYameEnabled && isLastDealerRound && !isDobon) {
          const dealerScore = nextState.players[lastDealerIdx].score;
          const maxScore = Math.max(...nextState.players.map(p => p.score));
          if (dealerScore === maxScore && dealerScore >= okaPoints) {
            nextState.isOver = true;
            logMsg += '\n[听牌即止]';
          }
        }
      } else {
        nextState.honba += 1;
        const isSanma = gameState.gameMode === 'sanma' || gameState.players.length === 3;
        nextState.dealerIndex = (dealerIndex + 1) % (isSanma ? 3 : 4);

        if (nextState.dealerIndex === 0) {
          if (nextState.wind === 'east') {
            nextState.wind = 'south';
            nextState.round = 1;
          } else if (nextState.wind === 'south') {
            nextState.wind = 'west';
            nextState.round = 1;
          } else {
            nextState.round = (nextState.round % 4) + 1;
          }
        } else {
          nextState.round = nextState.dealerIndex + 1;
        }
      }

      // Check game end conditions
      const overCheck = checkGameOver(gameState, nextState, isDealerTenpai);
      nextState.isOver = nextState.isOver || overCheck.isOver;
      logMsg += overCheck.msg;

      if (!nextState.scoreHistory) {
        nextState.scoreHistory = [];
      }
      nextState.scoreHistory.push(nextState.players.map(p => p.score));
      
      if (!nextState.roundHistory) {
        nextState.roundHistory = ['起点'];
      }
      const roundName = `${windChar}${gameState.round}`;
      nextState.roundHistory.push(roundName);

      return { nextState, logMsg, scoreDiffs };
    }
    return null;
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // 统一的分数合法性检查
    if (mode === 'ron') {
      const currentWinners = getActiveWinners();
      if (loserId === null) {
        setAlertMessage('请选择放铳选手');
        return;
      }
      if (currentWinners.length === 0) {
        setAlertMessage('请选择荣和获胜选手');
        return;
      }
      for (const wId of currentWinners) {
        const pts = winnerScores[wId]?.basePoints || 0;
        if (pts <= 0 || pts % 100 !== 0) {
          setAlertMessage('点数须为100的整数倍且不低于100');
          return;
        }
      }
    } else if (mode === 'tsumo') {
      if (isDealerWinner) {
        if (tsumoKoPay <= 0 || tsumoKoPay % 100 !== 0) {
          setAlertMessage('点数须为100的整数倍且不低于100');
          return;
        }
      } else {
        if (tsumoKoPay <= 0 || tsumoOyaPay <= 0 || tsumoKoPay % 100 !== 0 || tsumoOyaPay % 100 !== 0) {
          setAlertMessage('点数须为100的整数倍且不低于100');
          return;
        }
      }
    }

    const result = calculateNextState();
    if (result) {
      onConfirm(result.nextState, result.logMsg);
      onClose();
    }
  };

  // Generate live preview differences based on pre-round scores
  const getPreviewInfo = () => {
    const result = calculateNextState();
    if (!result) return null;

    const preRoundScores = gameState.players.map(p => p.score + (p.riichi ? 1000 : 0));
    const scoreDiffs = result.nextState.players.map((p, idx) => p.score - preRoundScores[idx]);

    return {
      nextState: result.nextState,
      scoreDiffs,
      preRoundScores
    };
  };

  const preview = getPreviewInfo();

  if (!isOpen || !mode) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div
          className="modal-header app-header"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto 1fr',
            alignItems: 'center',
            width: 'calc(100% - 24px)',
            margin: '0 12px',
            height: '60px',
            minHeight: '60px',
            maxHeight: '60px',
            padding: '12px 12px 0 12px',
            boxSizing: 'border-box',
            borderBottom: '1px solid var(--border-color)'
          }}
        >
          {theme === 'electronic' ? (
            <>
              <div style={{ gridColumn: 1, justifySelf: 'start', display: 'flex', alignItems: 'center', height: '30px' }}>
                <h1
                  className="app-title"
                  style={{
                    margin: 0,
                    fontSize: '1.25rem',
                    fontWeight: 800,
                    height: '30px',
                    lineHeight: '30px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'flex-start',
                    color: 'var(--color-accent)',
                    letterSpacing: '0.5px',
                    whiteSpace: 'nowrap',
                    maxWidth: 'calc(100vw - 120px)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}
                >
                  {mode === 'tsumo' && (winner ? `自摸结算 - ${getPlayerDisplayName(winner)}` : '自摸结算')}
                  {mode === 'ron' && (
                    getActiveWinners().length > 1
                      ? `多家和了结算 - 放铳: ${loserId !== null ? getPlayerDisplayName(players[loserId]) : '请选择放铳家'}`
                      : (winner ? `荣和结算 - ${getPlayerDisplayName(winner)}` : '荣和结算')
                  )}
                  {mode === 'draw' && (isNagashiMangan ? '流局满贯结算' : isChombo ? '诈和犯规结算' : isMidGameDraw ? '中途流局结算' : '荒牌流局结算')}
                </h1>
              </div>
              <div style={{ gridColumn: 2 }} aria-hidden="true" />
            </>
          ) : (
            <>
              <div style={{ gridColumn: 1, justifySelf: 'start', display: 'flex', alignItems: 'center', height: '30px' }} aria-hidden="true" />
              <h1
                className="app-title"
                style={{
                  gridColumn: 2,
                  justifySelf: 'center',
                  margin: 0,
                  fontSize: '1.25rem',
                  fontWeight: 800,
                  height: '30px',
                  lineHeight: '30px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  whiteSpace: 'nowrap',
                  maxWidth: 'calc(100vw - 120px)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}
              >
                  {mode === 'tsumo' && (winner ? `自摸结算 - ${getPlayerDisplayName(winner)}` : '自摸结算')}
                  {mode === 'ron' && (
                    getActiveWinners().length > 1
                      ? `多家和了结算 - 放铳: ${loserId !== null ? getPlayerDisplayName(players[loserId]) : '请选择放铳家'}`
                      : (winner ? `荣和结算 - ${getPlayerDisplayName(winner)}` : '荣和结算')
                  )}
                  {mode === 'draw' && (isNagashiMangan ? '流局满贯结算' : isChombo ? '诈和犯规结算' : isMidGameDraw ? '中途流局结算' : '荒牌流局结算')}
              </h1>
            </>
          )}
          <div style={{ gridColumn: 3, justifySelf: 'end', display: 'flex', alignItems: 'center', height: '30px' }}>
            <button
              type="button"
              className="modal-close"
              onClick={onClose}
              style={{
                width: '28px',
                height: '28px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
                margin: 0,
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                color: 'var(--text-secondary)'
              }}
              aria-label="关闭"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <form onSubmit={handleFormSubmit}>
          {mode === 'tsumo' || mode === 'ron' ? (
            <div className="modal-body">
              {/* 1. 放铳家选择：自动剔除默认和牌家 */}
              {mode === 'ron' && (
                <div className="form-group">
                  <label className="form-label">放铳家</label>
                  {(() => {
                    const loserCandidates = players.filter(p => p.id !== (initialWinnerId ?? 0));
                    return (
                      <div className="player-selector-grid" style={{ gridTemplateColumns: `repeat(${loserCandidates.length}, 1fr)` }}>
                        {loserCandidates.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            className={`player-select-btn ${loserId === p.id ? 'selected' : ''}`}
                            onClick={() => handleSelectLoser(p.id)}
                          >
                            {getPlayerDisplayName(p)}
                          </button>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* 2. 追加和牌家 (多家和了)：仅在选了放铳家后且开启多响时展示另外两名可能追加的玩家按钮 */}
              {mode === 'ron' && multiRonEnabled && loserId !== null && (
                <div className="form-group" style={{ marginTop: '8px' }}>
                  <label className="form-label">追加和牌家</label>
                  {(() => {
                    const additionalCandidates = players.filter(p => p.id !== defaultWinnerId && p.id !== loserId);
                    if (additionalCandidates.length === 0) return null;

                    return (
                      <div className="player-selector-grid" style={{ gridTemplateColumns: `repeat(${additionalCandidates.length}, 1fr)` }}>
                        {additionalCandidates.map((p) => {
                          const isEditing = activeWinnerId === p.id;
                          const pts = winnerScores[p.id]?.basePoints || 0;

                          return (
                            <button
                              key={p.id}
                              type="button"
                              className={`player-select-btn ${isEditing ? 'selected' : ''}`}
                              style={{
                                minHeight: '38px',
                                fontSize: '0.85rem'
                              }}
                              onClick={() => handleToggleAdditionalWinner(p.id)}
                            >
                              {getPlayerDisplayName(p)}
                              {pts > 0 ? ` (${pts}点)` : ''}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* 3. 快捷录入点数 (3列布局，点击再次撤销) */}
              <div className="form-group" style={{ marginTop: '10px' }}>
                <label className="form-label">快捷录入点数</label>
                {mode === 'ron' ? (
                  <>
                    {/* Normal hands */}
                    <div className="quick-scores-list-3col">
                      {getRonPresets(activeWinnerId === dealerIndex).slice(0, normalPresetCount).map((preset, idx) => {
                        const isPresetDisabled = isActiveWinnerRiichi && idx === 0;
                        return (
                          <button
                            key={idx}
                            type="button"
                            disabled={isPresetDisabled}
                            className={`btn btn-preset ${activeWinnerState.basePoints === preset.val ? 'selected' : ''}`}
                            onClick={() => handleRonPresetSelect(preset.val)}
                            style={{ minHeight: '44px', padding: '4px 2px', gridColumn: idx === 9 ? 2 : undefined }}
                          >
                            {formatPresetLabel(preset.label)}
                          </button>
                        );
                      })}
                    </div>
                    {/* Separate Limit section */}
                    <div className="form-label-divider">
                      满贯及以上点数
                    </div>
                    <div className="quick-scores-list-3col">
                      {getRonPresets(activeWinnerId === dealerIndex).slice(normalPresetCount).map((preset, idx) => (
                        <button
                          key={idx}
                          type="button"
                          className={`btn btn-preset ${activeWinnerState.basePoints === preset.val ? 'selected' : ''}`}
                          onClick={() => handleRonPresetSelect(preset.val)}
                          style={{ minHeight: '44px', padding: '4px 2px' }}
                        >
                          {formatPresetLabel(preset.label)}
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    {/* Normal Tsumo */}
                    {(() => {
                      const tsumoPresets = isDealerWinner ? getDealerTsumoPresets() : getNonDealerTsumoPresets();
                      return (
                        <>
                          <div className="quick-scores-list-3col">
                            {tsumoPresets.slice(0, normalPresetCount).map((preset, idx) => {
                              const isActive = tsumoKoPay === preset.ko && tsumoOyaPay === preset.oya;
                              const isPresetDisabled = isWinnerRiichi && idx < 3;
                              return (
                                <button
                                  key={idx}
                                  type="button"
                                  disabled={isPresetDisabled}
                                  className={`btn btn-preset ${isActive ? 'selected' : ''}`}
                                  onClick={() => handleTsumoPresetSelect(preset.ko, preset.oya)}
                                  style={{ minHeight: '44px', padding: '4px 2px', gridColumn: idx === 9 ? 2 : undefined }}
                                >
                                  {formatPresetLabel(preset.label)}
                                </button>
                              );
                            })}
                          </div>
                          {/* Separate Limit section */}
                          <div className="form-label-divider">
                            满贯及以上点数
                          </div>
                          <div className="quick-scores-list-3col">
                            {tsumoPresets.slice(normalPresetCount).map((preset, idx) => {
                              const isActive = tsumoKoPay === preset.ko && tsumoOyaPay === preset.oya;
                              return (
                                <button
                                  key={idx}
                                  type="button"
                                  className={`btn btn-preset ${isActive ? 'selected' : ''}`}
                                  onClick={() => handleTsumoPresetSelect(preset.ko, preset.oya)}
                                  style={{ minHeight: '44px', padding: '4px 2px' }}
                                >
                                  {formatPresetLabel(preset.label)}
                                </button>
                              );
                            })}
                          </div>
                        </>
                      );
                    })()}
                  </>
                )}
              </div>

              {/* Point Values Manual Input Fields (Without placeholder tips) */}
              {mode === 'ron' ? (
                (() => {
                  const isRonEmpty = activeWinnerState.customPointsVal.trim() === '';
                  const isRonInvalid = !isRonEmpty && (activeWinnerState.basePoints <= 0 || activeWinnerState.basePoints % 100 !== 0);

                  return (
                    <div className="form-group" style={{ borderTop: "1px dashed var(--border-color)", paddingTop: "10px", marginTop: "10px" }}>
                      <label className="form-label">手动输入荣和点数</label>
                      <input
                        type="number"
                        step="100"
                        min="0"
                        className={`form-input ${isRonInvalid ? 'form-input-invalid' : ''}`}
                        value={activeWinnerState.customPointsVal}
                        onChange={(e) => {
                          if (activeWinnerId === null) return;
                          const val = e.target.value;
                          const parsed = parseInt(val, 10) || 0;
                          updateWinnerScore(activeWinnerId, {
                            customPointsVal: val,
                            basePoints: parsed
                          });
                        }}
                        required
                        style={{ height: '38px', minHeight: '38px', fontSize: '0.85rem', boxSizing: 'border-box', width: '100%' }}
                      />
                      {isRonInvalid && (
                        <div className="validation-warning-text">
                          输入的最小单位为100且最小值为100
                        </div>
                      )}
                    </div>
                  );
                })()
              ) : (
                isDealerWinner ? (
                  (() => {
                    const isKoEmpty = customKoVal.trim() === '';
                    const isDealerTsumoInvalid = !isKoEmpty && (tsumoKoPay <= 0 || tsumoKoPay % 100 !== 0);

                    return (
                      <div className="form-group" style={{ borderTop: "1px dashed var(--border-color)", paddingTop: "10px", marginTop: "10px" }}>
                        <label className="form-label">手动输入自摸点数</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <input
                            type="number"
                            step="100"
                            min="0"
                            className={`form-input ${isDealerTsumoInvalid ? 'form-input-invalid' : ''}`}
                            value={customKoVal}
                            onChange={handleKoChange}
                            required
                            style={{ height: '38px', minHeight: '38px', fontSize: '0.85rem', boxSizing: 'border-box' }}
                          />
                          <span style={{ fontWeight: 'bold' }}>all</span>
                        </div>
                        {isDealerTsumoInvalid && (
                          <div className="validation-warning-text">
                            输入的最小单位为100且最小值为100
                          </div>
                        )}
                      </div>
                    );
                  })()
                ) : (
                  (() => {
                    const isKoEmpty = customKoVal.trim() === '';
                    const isOyaEmpty = customOyaVal.trim() === '';
                    const isKoInvalid = !isKoEmpty && (tsumoKoPay <= 0 || tsumoKoPay % 100 !== 0);
                    const isOyaInvalid = !isOyaEmpty && (tsumoOyaPay <= 0 || tsumoOyaPay % 100 !== 0);
                    const isNonDealerTsumoInvalid = isKoInvalid || isOyaInvalid;

                    return (
                      <div style={{ borderTop: '1px dashed var(--border-color)', paddingTop: '10px', marginTop: '10px' }}>
                        <div style={{ display: 'flex', gap: '16px' }}>
                          <div className="form-group" style={{ flex: 1 }}>
                            <label className="form-label">手动输入子家支付点数</label>
                            <input
                              type="number"
                              step="100"
                              min="0"
                              className={`form-input ${isKoInvalid ? 'form-input-invalid' : ''}`}
                              value={customKoVal}
                              onChange={handleKoChange}
                              required
                              style={{ height: '38px', minHeight: '38px', fontSize: '0.85rem', boxSizing: 'border-box' }}
                            />
                          </div>
                          <div className="form-group" style={{ flex: 1 }}>
                            <label className="form-label">手动输入庄家支付点数</label>
                            <input
                              type="number"
                              step="100"
                              min="0"
                              className={`form-input ${isOyaInvalid ? 'form-input-invalid' : ''}`}
                              value={customOyaVal}
                              onChange={handleOyaChange}
                              required
                              style={{ height: '38px', minHeight: '38px', fontSize: '0.85rem', boxSizing: 'border-box' }}
                            />
                          </div>
                        </div>
                        {isNonDealerTsumoInvalid && (
                          <div className="validation-warning-text">
                            输入的最小单位为100且最小值为100
                          </div>
                        )}
                      </div>
                    );
                  })()
                )
              )}

              {/* Live Preview Section */}
              {preview && (
                <div style={{ marginTop: '16px' }}>
                  <div className="preview-box">
                    <div className="preview-title">结算变更预览</div>
                    <div className="preview-grid">
                      {players.map((p, idx) => {
                        const diff = preview.scoreDiffs[idx];
                        const preScore = preview.preRoundScores[idx];
                        const nextScore = preview.nextState.players[idx].score;

                        let diffClass = 'zero';
                        let diffText = '0';
                        if (diff > 0) {
                          diffClass = 'positive';
                          diffText = `+${diff}`;
                        } else if (diff < 0) {
                          diffClass = 'negative';
                          diffText = diff.toString();
                        }

                        // REXX Oval LED logic: Current Dealer (solid lit), Shimocha (toggles between lit/off directly), others (off)
                        const isDealer = idx === dealerIndex;
                        const isShimocha = idx === (dealerIndex + 1) % players.length;
                        let ledClass = 'off';
                        if (isDealer) {
                          ledClass = 'lit';
                        } else if (isShimocha) {
                          ledClass = isBlinkOn ? 'lit' : 'off';
                        }
                        const ledTitle = isDealer ? '庄家' : (isShimocha ? '下家' : '子家');

                        return (
                          <div key={p.id} className="preview-row">
                            <span className="preview-player-name" style={{ display: 'inline-flex', alignItems: 'center' }}>
                              {theme === 'rexx' && (
                                <span className={`rexx-led-oval ${ledClass}`} title={ledTitle} />
                              )}
                              {getPlayerDisplayName(p)} :
                            </span>
                            <span className="preview-scores">
                              {preScore} &rarr; {nextScore}
                              <span className={`preview-diff ${diffClass}`}>{diffText}</span>
                            </span>
                          </div>
                        );
                      })}

                      {/* Render Old Riichi Sticks Change on table */}
                      {(() => {
                        const initialSticksOnTable = gameState.riichiSticks - gameState.players.filter(p => p.riichi).length;
                        const nextSticksOnTable = preview.nextState.riichiSticks;
                        const sticksDiff = nextSticksOnTable - initialSticksOnTable;

                        if (initialSticksOnTable > 0 || nextSticksOnTable > 0) {
                          return (
                            <div className="preview-row preview-row-dashed" style={{ paddingTop: '6px', marginTop: '6px' }}>
                              <span className="preview-player-name" style={{ color: 'var(--text-secondary)' }}>
                                场上供托立直棒：
                              </span>
                              <span className="preview-scores">
                                {initialSticksOnTable} 根 &rarr; {nextSticksOnTable} 根
                                <span className={`preview-diff ${sticksDiff > 0 ? 'positive' : (sticksDiff < 0 ? 'negative' : 'zero')}`}>
                                  {sticksDiff > 0 ? `+${sticksDiff * 1000}` : (sticksDiff < 0 ? `${sticksDiff * 1000}` : '0')}
                                </span>
                              </span>
                            </div>
                          );
                        }
                        return null;
                      })()}
                    </div>

                    <div className="preview-footer">
                      局况变更: {gameState.wind === 'east' ? '东' : (gameState.wind === 'south' ? '南' : '西')}{gameState.round}局 {gameState.honba}本场 &rarr;{' '}
                      {preview.nextState.isOver ? (
                        <span style={{ color: 'var(--color-accent)', fontWeight: 'bold' }}>
                          {preview.nextState.settings?.gameLength === 'tonpuu' ? '东风终局' : '半庄终局'}
                        </span>
                      ) : (
                        <span>{preview.nextState.wind === 'east' ? '东' : (preview.nextState.wind === 'south' ? '南' : '西')}{preview.nextState.round}局 {preview.nextState.honba}本场</span>
                      )}
                      <br />
                      下局庄家: {preview.nextState.isOver ? '无' : getPlayerDisplayName(preview.nextState.players[preview.nextState.dealerIndex])}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* 3. Draw Settlement View */
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">
                  {isChombo ? '诈和犯规选手选择' : isNagashiMangan ? '流局满贯达成选手选择' : '听牌 / 流局结果选择'}
                </label>
                {(() => {
                  const isMidGameDrawActive = isMidGameDraw;
                  const isNagashiManganActive = isNagashiMangan;
                  const isChomboActive = isChombo;
                  const hasAnySingleChecked = tenpaiStates.some(t => t);

                  return (
                    <div className="checkbox-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                      {/* Individual Player Checkboxes */}
                      {players.map((p, idx) => {
                        const isSingleDisabled = isMidGameDrawActive;
                        const isChecked = !isMidGameDrawActive && tenpaiStates[idx];

                        return (
                          <label
                            key={p.id}
                            className={`checkbox-label ${isChecked ? 'checked' : ''}`}
                            style={{
                              opacity: isSingleDisabled ? 0.45 : 1,
                              cursor: isSingleDisabled ? 'not-allowed' : 'pointer',
                              whiteSpace: 'nowrap',
                              ...(players.length === 3 && idx === 2 ? { gridColumn: '1 / -1' } : {})
                            }}
                          >
                            <input
                              type="checkbox"
                              disabled={isSingleDisabled}
                              checked={isChecked}
                              onChange={() => {
                                if (isSingleDisabled) return;
                                handleTenpaiToggle(idx);
                              }}
                            />
                            {getPlayerDisplayName(p)}
                          </label>
                        );
                      })}

                      {/* Chombo Option */}
                      {(() => {
                        const isChomboDisabled = isMidGameDrawActive || isNagashiManganActive;
                        return (
                          <label
                            className={`checkbox-label ${isChomboActive ? 'checked' : ''}`}
                            style={{
                              gridColumnStart: 1,
                              opacity: isChomboDisabled ? 0.45 : 1,
                              cursor: isChomboDisabled ? 'not-allowed' : 'pointer',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            <input
                              type="checkbox"
                              disabled={isChomboDisabled}
                              checked={isChomboActive}
                              onChange={() => {
                                if (isChomboDisabled) return;
                                handleChomboToggle();
                              }}
                            />
                            诈和
                          </label>
                        );
                      })()}

                      {/* Nagashi Mangan Option */}
                      {(() => {
                        const isNagashiDisabled = isMidGameDrawActive || isChomboActive;
                        return (
                          <label
                            className={`checkbox-label ${isNagashiManganActive ? 'checked' : ''}`}
                            style={{
                              opacity: isNagashiDisabled ? 0.45 : 1,
                              cursor: isNagashiDisabled ? 'not-allowed' : 'pointer',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            <input
                              type="checkbox"
                              disabled={isNagashiDisabled}
                              checked={isNagashiManganActive}
                              onChange={() => {
                                if (isNagashiDisabled) return;
                                handleNagashiToggle();
                              }}
                            />
                            流局满贯
                          </label>
                        );
                      })()}

                      {/* Mid-game Draw Option (最后一行全宽) */}
                      {(() => {
                        const isMidDisabled = isChomboActive || isNagashiManganActive || (!isMidGameDrawActive && hasAnySingleChecked);
                        return (
                          <label
                            className={`checkbox-label ${isMidGameDrawActive ? 'checked' : ''}`}
                            style={{
                              gridColumn: '1 / -1',
                              opacity: isMidDisabled ? 0.45 : 1,
                              cursor: isMidDisabled ? 'not-allowed' : 'pointer',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            <input
                              type="checkbox"
                              disabled={isMidDisabled}
                              checked={isMidGameDrawActive}
                              onChange={() => {
                                if (isMidDisabled) return;
                                handleMidGameDrawToggle();
                              }}
                            />
                            中途流局
                          </label>
                        );
                      })()}
                    </div>
                  );
                })()}

                {/* 流局满贯时：始终允许标记庄家是否听牌连庄 */}
                {isNagashiMangan && (
                  <div style={{ marginTop: '8px' }}>
                    <label
                      className={`checkbox-label ${dealerRenchanOnNagashi ? 'checked' : ''}`}
                      style={{ cursor: 'pointer', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center' }}
                    >
                      <input
                        type="checkbox"
                        checked={dealerRenchanOnNagashi}
                        onChange={() => setDealerRenchanOnNagashi(!dealerRenchanOnNagashi)}
                      />
                      庄家听牌 (连庄)
                    </label>
                  </div>
                )}
              </div>

              {mode === 'draw' && (isChombo || isNagashiMangan) && tenpaiStates.filter(t => t).length === 0 ? (
                <div style={{ marginTop: '16px' }}>
                  <div className="validation-warning-text" style={{ padding: '8px 0' }}>
                    {isChombo ? '至少选择 1 名发生诈和犯规的选手进行罚符结算' : '请至少选择 1 名达成流局满贯的选手'}
                  </div>
                </div>
              ) : preview && (
                <div style={{ marginTop: '16px' }}>
                  <div className="preview-box">
                    <div className="preview-title">结算变更预览</div>
                    <div className="preview-grid">
                      {players.map((p, idx) => {
                        const diff = preview.scoreDiffs[idx];
                        const preScore = preview.preRoundScores[idx];
                        const nextScore = preview.nextState.players[idx].score;

                        let diffClass = 'zero';
                        let diffText = '0';
                        if (diff > 0) {
                          diffClass = 'positive';
                          diffText = `+${diff}`;
                        } else if (diff < 0) {
                          diffClass = 'negative';
                          diffText = diff.toString();
                        }

                        // REXX Oval LED logic: Current Dealer (solid lit), Shimocha (toggles between lit/off directly), others (off)
                        const isDealer = idx === dealerIndex;
                        const isShimocha = idx === (dealerIndex + 1) % players.length;
                        let ledClass = 'off';
                        if (isDealer) {
                          ledClass = 'lit';
                        } else if (isShimocha) {
                          ledClass = isBlinkOn ? 'lit' : 'off';
                        }
                        const ledTitle = isDealer ? '庄家' : (isShimocha ? '下家' : '子家');

                        return (
                          <div key={p.id} className="preview-row">
                            <span className="preview-player-name" style={{ display: 'inline-flex', alignItems: 'center' }}>
                              {theme === 'rexx' && (
                                <span className={`rexx-led-oval ${ledClass}`} title={ledTitle} />
                              )}
                              {getPlayerDisplayName(p)} :
                            </span>
                            <span className="preview-scores">
                              {preScore} &rarr; {nextScore}
                              <span className={`preview-diff ${diffClass}`}>{diffText}</span>
                            </span>
                          </div>
                        );
                      })}

                      {/* Render Old Riichi Sticks Change on table */}
                      {(() => {
                        const initialSticksOnTable = gameState.riichiSticks - gameState.players.filter(p => p.riichi).length;
                        const nextSticksOnTable = preview.nextState.riichiSticks;
                        const sticksDiff = nextSticksOnTable - initialSticksOnTable;

                        if (initialSticksOnTable > 0 || nextSticksOnTable > 0) {
                          return (
                            <div className="preview-row preview-row-dashed" style={{ paddingTop: '6px', marginTop: '6px' }}>
                              <span className="preview-player-name" style={{ color: 'var(--text-secondary)' }}>
                                场上供托立直棒：
                              </span>
                              <span className="preview-scores">
                                {initialSticksOnTable} 根 &rarr; {nextSticksOnTable} 根
                                <span className={`preview-diff ${sticksDiff > 0 ? 'positive' : (sticksDiff < 0 ? 'negative' : 'zero')}`}>
                                  {sticksDiff > 0 ? `+${sticksDiff * 1000}` : (sticksDiff < 0 ? `${sticksDiff * 1000}` : '0')}
                                </span>
                              </span>
                            </div>
                          );
                        }
                        return null;
                      })()}
                    </div>

                    <div className="preview-footer">
                      局况变更: {gameState.wind === 'east' ? '东' : (gameState.wind === 'south' ? '南' : '西')}{gameState.round}局 {gameState.honba}本场 &rarr;{' '}
                      {preview.nextState.isOver ? (
                        <span style={{ color: 'var(--color-accent)', fontWeight: 'bold' }}>
                          {preview.nextState.settings?.gameLength === 'tonpuu' ? '东风终局' : '半庄终局'}
                        </span>
                      ) : (
                        <span>
                          {preview.nextState.wind === 'east' ? '东' : (preview.nextState.wind === 'south' ? '南' : '西')}{preview.nextState.round}局 {preview.nextState.honba}本场
                        </span>
                      )}
                      <br />
                      下局庄家: {preview.nextState.isOver ? '无' : getPlayerDisplayName(preview.nextState.players[preview.nextState.dealerIndex])}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="modal-footer" style={{ padding: '14px 12px 28px', display: 'flex', gap: '12px' }}>
            <button type="button" className="btn btn-secondary dialog-btn" onClick={onClose} style={{ flex: 1, height: '38px', fontSize: '0.88rem', fontWeight: 700 }}>取消</button>
            <button
              type="submit"
              className="btn btn-primary dialog-btn"
              style={{ flex: 1, height: '38px', fontSize: '0.88rem', fontWeight: 700 }}
              disabled={
                !preview ||
                (mode === 'ron' && (loserId === null || getActiveWinners().every(wId => (winnerScores[wId]?.basePoints || 0) <= 0))) ||
                (mode === 'tsumo' && (tsumoKoPay <= 0 || (!isDealerWinner && tsumoOyaPay <= 0))) ||
                (mode === 'draw' && (isChombo || isNagashiMangan) && tenpaiStates.filter(t => t).length === 0)
              }
            >
              确认提交
            </button>
          </div>
        </form>
      </div>

      <ConfirmModal
        isOpen={alertMessage !== null}
        title="录入提示"
        message={alertMessage || ''}
        confirmText="我知道了"
        showCancel={false}
        onConfirm={() => setAlertMessage(null)}
        onCancel={() => setAlertMessage(null)}
      />
    </div>
  );
};
