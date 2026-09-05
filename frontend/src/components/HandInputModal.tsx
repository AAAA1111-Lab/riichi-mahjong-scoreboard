import React, { useState, useEffect } from 'react';
import type { GameState, Player } from '../types';

// Helper function to check and resolve Japanese Mahjong game-over status
const checkGameOver = (gameState: GameState, nextState: GameState, _isDealerWinner: boolean) => {
    const hasNegativeScore = nextState.players.some(p => p.score < 0);
  
  // 1. Dobon (击飞完场) check: finish game on negative score UNLESS dobon continuation is enabled
  const dobonContinuation = gameState.settings?.dobonEnabled ?? false;
  if (!dobonContinuation && hasNegativeScore) {
    const negativePlayers = nextState.players
      .filter(p => p.score < 0)
      .map(p => p.name)
      .join(', ');
    return { isOver: true, msg: ` [被飞] 玩家 ${negativePlayers} 点数低于 0 触发击飞完场` };
  }

  const westRoundEnabled = gameState.settings?.westRoundEnabled ?? false;
  const okaPoints = gameState.settings?.okaPoints ?? 30000;
  
  const isSouth4End = gameState.wind === 'south' && gameState.round === 4 && nextState.dealerIndex === 0;
  const isWest4End = gameState.wind === 'west' && gameState.round === 4 && nextState.dealerIndex === 0;

  // 2. South 4 ending
  if (isSouth4End) {
    if (westRoundEnabled) {
      const maxScore = Math.max(...nextState.players.map(p => p.score));
      if (maxScore < okaPoints) {
        nextState.wind = 'west';
        nextState.round = 1;
        nextState.honba = 0;
        return { isOver: false, msg: ' [南场完场，返点未达标，进入西入对局]' };
      }
    }
    return { isOver: true, msg: ' [半庄对局完场]' };
  }

  // 3. West 4 ending
  if (isWest4End) {
    return { isOver: true, msg: ' [西入完场]' };
  }

  // 4. Sudden death during West round
  if (gameState.wind === 'west') {
    const maxScore = Math.max(...nextState.players.map(p => p.score));
    if (maxScore >= okaPoints) {
      return { isOver: true, msg: ` [西入避飞/标达完场 (最高得分: ${maxScore})]` };
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

  const { players, dealerIndex, honba, riichiSticks } = gameState;
  const kiriageManganEnabled = gameState.settings?.kiriageManganEnabled ?? true;

  // REXX 专用 LED 闪烁状态：每 1000ms (1s) 切换一次
  const [isBlinkOn, setIsBlinkOn] = useState<boolean>(true);

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

  const winner = initialWinnerId !== null ? players[initialWinnerId] : null;
  const isDealerWinner = initialWinnerId === dealerIndex;

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
      const desc = cleaned.substring(parenIndex).trim();
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

  const handleChomboToggle = () => {
    const nextChombo = !isChombo;
    setIsChombo(nextChombo);
    if (nextChombo) {
      setIsMidGameDraw(false);
    }
  };

  const handleMidGameDrawToggle = () => {
    const nextMid = !isMidGameDraw;
    setIsMidGameDraw(nextMid);
    if (nextMid) {
      setIsChombo(false);
      setTenpaiStates(players.map(() => true));
    } else {
      setTenpaiStates(players.map(() => false));
    }
  };

  // Dry-run calculation to get the next state, log message, and score changes
  const calculateNextState = (): { nextState: GameState; logMsg: string; scoreDiffs: number[] } | null => {
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

        const baseStr = isDealerWinner ? `${tsumoKoPay}all` : `${tsumoKoPay}/${tsumoOyaPay}`;
        logMsg = `${getPlayerDisplayName(players[initialWinnerId!])} 自摸和牌 (${baseStr}, ${honba}本场), 赢取 ${totalWin}点`;
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
          if (honbaPts > 0) extraStr += `+${honba}本场${honbaPts}`;
          if (riichiPts > 0) extraStr += `+供托${riichiPts}`;
          winnerSummaryList.push(`${getPlayerDisplayName(players[wId])}(${basePts}点${extraStr})`);
        }

        nextState.players[loserId!].score -= totalLoss;
        scoreDiffs[loserId!] = -totalLoss;

        if (currentWinners.length > 1) {
          const multiText = currentWinners.length === 2 ? '一炮双响' : '一炮三响';
          logMsg = `${getPlayerDisplayName(players[loserId!])} 放铳 ${winnerSummaryList.join(' 与 ')}, 支出 ${totalLoss}点 [${multiText}]`;
        } else {
          const wId = currentWinners[0];
          const basePts = winnerScores[wId]?.basePoints || 0;
          const totalWin = scoreDiffs[wId];
          logMsg = `${getPlayerDisplayName(players[wId])} 荣和 ${getPlayerDisplayName(players[loserId!])} (${basePts}点, ${honba}本场), 赢取 ${totalWin}点`;
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

        const isLastDealerRound = (gameState.wind === 'south' || gameState.wind === 'west') && 
                                   gameState.round === maxRound && 
                                   gameState.dealerIndex === lastDealerIdx;

        if (agariYameEnabled && isLastDealerRound) {
          const dealerScore = nextState.players[lastDealerIdx].score;
          const maxScore = Math.max(...nextState.players.map(p => p.score));
          if (dealerScore === maxScore && dealerScore >= okaPoints) {
            nextState.isOver = true;
            logMsg += ' [尾亲一位完场]';
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
      nextState.isOver = overCheck.isOver;
      logMsg += overCheck.msg;

      // Check Dobon (击飞完场) rule: finish game on negative score UNLESS dobon continuation is enabled
      const dobonContinuation = nextState.settings?.dobonEnabled ?? false;
      if (!dobonContinuation) {
        const hasNegativeScore = nextState.players.some(p => p.score < 0);
        if (hasNegativeScore) {
          nextState.isOver = true;
          const negativePlayers = nextState.players
            .filter(p => p.score < 0)
            .map(p => p.name)
            .join('、');
          logMsg += ` [被飞] 玩家 ${negativePlayers} 点数低于 0 触发击飞完场！`;
        }
      }

      
      
      if (!nextState.scoreHistory) {
        nextState.scoreHistory = [];
      }
      nextState.scoreHistory.push(nextState.players.map(p => p.score));
      
      if (!nextState.roundHistory) {
        nextState.roundHistory = ['起点'];
      }
      const windChar = gameState.wind === 'east' ? '东' : (gameState.wind === 'south' ? '南' : '西');
      const roundName = `${windChar}${gameState.round}`;
      nextState.roundHistory.push(roundName);

      return { nextState, logMsg, scoreDiffs };
    } else if (mode === 'draw') {
      const nextState = JSON.parse(JSON.stringify(gameState)) as GameState;
      const isSanma = gameState.gameMode === 'sanma' || players.length === 3;
      const scoreDiffs = isSanma ? [0, 0, 0] : [0, 0, 0, 0];

      if (isChombo) {
        // 诈和 (Chombo) 模式：至少勾选 1 名犯规玩家
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

        const chomboNames = chomboIndices.map(idx => players[idx].name).join('、');
        let logMsg = chomboCount === 1
          ? `[流局/诈和] 玩家 ${chomboNames} 诈和罚符，支付其余 ${innocentCount} 人各 3000 点 (总计 -${penaltyPerOther * innocentCount} 点)，本场数不变。`
          : `[流局/诈和] 玩家 ${chomboNames} 共 ${chomboCount} 人诈和罚符，各支付其余 ${innocentCount} 人 3000 点，本场数不变。`;

        // 检查击飞
        const overCheck = checkGameOver(gameState, nextState, false);
        nextState.isOver = overCheck.isOver;
        logMsg += overCheck.msg;

        if (!nextState.scoreHistory) {
          nextState.scoreHistory = [];
        }
        nextState.scoreHistory.push(nextState.players.map(p => p.score));

        if (!nextState.roundHistory) {
          nextState.roundHistory = ['起点'];
        }
        const windChar = gameState.wind === 'east' ? '东' : (gameState.wind === 'south' ? '南' : '西');
        const roundName = `${windChar}${gameState.round}`;
        nextState.roundHistory.push(roundName);

        return { nextState, logMsg, scoreDiffs };
      }

      const tenpaiCount = tenpaiStates.filter(t => t).length;
      let logMsg = isMidGameDraw ? '中途流局 (九种九牌/四杠散打/四人立直)：' : '流局结算：';

      if (tenpaiCount > 0 && tenpaiCount < 4) {
        const winPoints = 3000 / tenpaiCount;
        const losePoints = 3000 / (4 - tenpaiCount);

        nextState.players.forEach((p, idx) => {
          if (tenpaiStates[idx]) {
            p.score += winPoints;
            scoreDiffs[idx] = winPoints;
          } else {
            p.score -= losePoints;
            scoreDiffs[idx] = -losePoints;
          }
        });
        const tenpaiNames = players.filter((_, idx) => tenpaiStates[idx]).map(p => p.name).join('、');
        logMsg += `听牌玩家 [${tenpaiNames}]，进行荒牌罚符转移 (+${winPoints}/-${losePoints})。`;
      } else if (tenpaiCount === 4) {
        const tenpaiNames = players.map(p => p.name).join('、');
        logMsg += `全部听牌 [${tenpaiNames}]，无罚符转移。`;
      } else {
        logMsg += `无人听牌，无罚符转移。`;
      }

      nextState.players.forEach(p => p.riichi = false);

      const isDealerTenpai = tenpaiStates[dealerIndex];
      if (isDealerTenpai) {
        nextState.honba += 1;
        logMsg += ` (庄家听牌连庄，本场数+1)`;

        // Check Tenpai-Yame (尾亲听牌一位完场) rule
        const isSanma = gameState.gameMode === 'sanma' || gameState.players.length === 3;
        const maxRound = isSanma ? 3 : 4;
        const lastDealerIdx = isSanma ? 2 : 3;
        const agariYameEnabled = gameState.settings?.agariYameEnabled ?? true;
        const okaPoints = gameState.settings?.okaPoints ?? (isSanma ? 40000 : 30000);

        const isLastDealerRound = (gameState.wind === 'south' || gameState.wind === 'west') && 
                                   gameState.round === maxRound && 
                                   gameState.dealerIndex === lastDealerIdx;

        if (agariYameEnabled && isLastDealerRound) {
          const dealerScore = nextState.players[lastDealerIdx].score;
          const maxScore = Math.max(...nextState.players.map(p => p.score));
          if (dealerScore === maxScore && dealerScore >= okaPoints) {
            nextState.isOver = true;
            logMsg += ' [尾亲听牌一位完场]';
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
        logMsg += ` (庄家未听牌流庄，轮庄下庄，本场数+1)`;
      }

      // Check game end conditions
      const overCheck = checkGameOver(gameState, nextState, isDealerTenpai);
      nextState.isOver = overCheck.isOver;
      logMsg += overCheck.msg;

      if (!nextState.scoreHistory) {
        nextState.scoreHistory = [];
      }
      nextState.scoreHistory.push(nextState.players.map(p => p.score));
      
      if (!nextState.roundHistory) {
        nextState.roundHistory = ['起点'];
      }
      const windChar = gameState.wind === 'east' ? '东' : (gameState.wind === 'south' ? '南' : '西');
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
        alert('请选择放铳玩家！');
        return;
      }
      if (currentWinners.length === 0) {
        alert('请至少选择一名荣和获胜玩家！');
        return;
      }
      for (const wId of currentWinners) {
        const pts = winnerScores[wId]?.basePoints || 0;
        if (pts <= 0 || pts % 100 !== 0) {
          alert(`点数必须大于 0 且为 100 的整数倍`);
          return;
        }
      }
    } else if (mode === 'tsumo') {
      if (isDealerWinner) {
        if (tsumoKoPay <= 0 || tsumoKoPay % 100 !== 0) {
          alert('点数必须大于 0 且为 100 的整数倍');
          return;
        }
      } else {
        if (tsumoKoPay <= 0 || tsumoOyaPay <= 0 || tsumoKoPay % 100 !== 0 || tsumoOyaPay % 100 !== 0) {
          alert('点数必须大于 0 且为 100 的整数倍');
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
        <div className="modal-header">
          <h3 className="modal-title">
            {mode === 'tsumo' && `自摸和牌结算 - ${winner ? getPlayerDisplayName(winner) : ''}`}
            {mode === 'ron' && (
              getActiveWinners().length > 1
                ? `一炮多响结算 (放铳: ${loserId !== null ? getPlayerDisplayName(players[loserId]) : '请选择放铳家'})`
                : `荣和点炮结算 - ${winner ? getPlayerDisplayName(winner) : ''}`
            )}
            {mode === 'draw' && `荒牌流局结算`}
          </h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        <form onSubmit={handleFormSubmit}>
          {mode === 'tsumo' || mode === 'ron' ? (
            <div className="modal-body">
              {/* 1. 放铳家选择：自动剔除默认和牌家 */}
              {mode === 'ron' && (
                <div className="form-group">
                  <label className="form-label">点炮放铳家</label>
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

              {/* 2. 追加和牌家 (一炮多响)：仅在选了放铳家后且开启多响时展示另外两名可能追加的玩家按钮 */}
              {mode === 'ron' && multiRonEnabled && loserId !== null && (
                <div className="form-group" style={{ marginTop: '8px' }}>
                  <label className="form-label">追加胡牌家</label>
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
                      {getRonPresets(activeWinnerId === dealerIndex).slice(0, normalPresetCount).map((preset, idx) => (
                        <button
                          key={idx}
                          type="button"
                          className={`btn btn-preset ${activeWinnerState.basePoints === preset.val ? 'selected' : ''}`}
                          onClick={() => handleRonPresetSelect(preset.val)}
                          style={{ minHeight: '44px', padding: '4px 2px', gridColumn: idx === 9 ? 2 : undefined }}
                        >
                          {formatPresetLabel(preset.label)}
                        </button>
                      ))}
                    </div>
                    {/* Separate Limit section */}
                    <div className="form-label-divider">
                      满贯及以上得点
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
                              return (
                                <button
                                  key={idx}
                                  type="button"
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
                            满贯及以上得点
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
                      <label className="form-label">手动输入荣和得点</label>
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
                      />
                      {isRonInvalid && (
                        <div className="validation-warning-text">
                          点数必须大于 0 且为 100 的整数倍
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
                        <label className="form-label">手动输入自摸各收</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <input
                            type="number"
                            step="100"
                            min="0"
                            className={`form-input ${isDealerTsumoInvalid ? 'form-input-invalid' : ''}`}
                            value={customKoVal}
                            onChange={handleKoChange}
                            required
                          />
                          <span style={{ fontWeight: 'bold' }}>all</span>
                        </div>
                        {isDealerTsumoInvalid && (
                          <div className="validation-warning-text">
                            点数必须大于 0 且为 100 的整数倍
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
                            <label className="form-label">手动输入闲家支付</label>
                            <input
                              type="number"
                              step="100"
                              min="0"
                              className={`form-input ${isKoInvalid ? 'form-input-invalid' : ''}`}
                              value={customKoVal}
                              onChange={handleKoChange}
                              required
                            />
                          </div>
                          <div className="form-group" style={{ flex: 1 }}>
                            <label className="form-label">手动输入庄家支付</label>
                            <input
                              type="number"
                              step="100"
                              min="0"
                              className={`form-input ${isOyaInvalid ? 'form-input-invalid' : ''}`}
                              value={customOyaVal}
                              onChange={handleOyaChange}
                              required
                            />
                          </div>
                        </div>
                        {isNonDealerTsumoInvalid && (
                          <div className="validation-warning-text">
                            点数必须大于 0 且为 100 的整数倍
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

                        const show供托Info = p.riichi;

                        // REXX Oval LED logic: Current Dealer (solid lit), Shimocha (toggles between lit/off directly), others (off)
                        const isDealer = idx === dealerIndex;
                        const isShimocha = idx === (dealerIndex + 1) % players.length;
                        let ledClass = 'off';
                        if (isDealer) {
                          ledClass = 'lit';
                        } else if (isShimocha) {
                          ledClass = isBlinkOn ? 'lit' : 'off';
                        }
                        const ledTitle = isDealer ? '当前庄位 (亮起)' : (isShimocha ? '庄位下家 (闪烁)' : '闲家 (熄灭)');

                        return (
                          <div key={p.id} className="preview-row">
                            <span className="preview-player-name" style={{ display: 'inline-flex', alignItems: 'center' }}>
                              {theme === 'rexx' && (
                                <span className={`rexx-led-oval ${ledClass}`} title={ledTitle} />
                              )}
                              {getPlayerDisplayName(p)}
                              {show供托Info && <span style={{ fontSize: '0.65rem', color: 'var(--color-accent)', marginLeft: '4px' }}>(立直-1000)</span>} :
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
                        const sticksDiff = (nextSticksOnTable - initialSticksOnTable) * 1000;

                        if (initialSticksOnTable > 0 || nextSticksOnTable > 0) {
                          return (
                            <div className="preview-row" style={{ borderTop: '1px dashed var(--border-color)', paddingTop: '6px', marginTop: '6px' }}>
                              <span className="preview-player-name" style={{ color: 'var(--text-secondary)' }}>
                                前局积存立直棒：
                              </span>
                              <span className="preview-scores">
                                {initialSticksOnTable}本({initialSticksOnTable * 1000}点) &rarr; {nextSticksOnTable}本({nextSticksOnTable * 1000}点)
                                <span className={`preview-diff ${sticksDiff > 0 ? 'positive' : (sticksDiff < 0 ? 'negative' : 'zero')}`}>
                                  {sticksDiff > 0 ? `+${sticksDiff}` : (sticksDiff < 0 ? sticksDiff.toString() : '0')}
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
                        <span style={{ color: 'var(--color-accent)', fontWeight: 'bold' }}>对局完场 (半庄结束)</span>
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
                <label className="form-label">听牌 / 流局结果选择</label>
                {(() => {
                  const isMidGameDrawActive = isMidGameDraw;
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
                              cursor: isSingleDisabled ? 'not-allowed' : 'pointer'
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

                      {/* Mid-game Draw Option (Mutually disabled with single player selection & Chombo) */}
                      {(() => {
                        const isMidDisabled = isChomboActive || (!isMidGameDrawActive && hasAnySingleChecked);
                        return (
                          <label
                            className={`checkbox-label ${isMidGameDrawActive ? 'checked' : ''}`}
                            style={{
                              opacity: isMidDisabled ? 0.45 : 1,
                              cursor: isMidDisabled ? 'not-allowed' : 'pointer'
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

                      {/* Chombo Option (Mutually disabled with Mid-game Draw) */}
                      {(() => {
                        const isChomboDisabled = isMidGameDrawActive;
                        return (
                          <label
                            className={`checkbox-label ${isChomboActive ? 'checked' : ''}`}
                            style={{
                              opacity: isChomboDisabled ? 0.45 : 1,
                              cursor: isChomboDisabled ? 'not-allowed' : 'pointer'
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
                    </div>
                  );
                })()}
              </div>

              {/* Live Preview Section or Chombo Pending Tip aligned with validation warning */}
              {mode === 'draw' && isChombo && tenpaiStates.filter(t => t).length === 0 ? (
                <div style={{ marginTop: '16px' }}>
                  <div className="validation-warning-text" style={{ padding: '8px 0' }}>
                    请至少勾选 1 名发生诈和犯规的玩家进行罚符结算
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

                        const show供托Info = p.riichi;

                        // REXX Oval LED logic: Current Dealer (solid lit), Shimocha (toggles between lit/off directly), others (off)
                        const isDealer = idx === dealerIndex;
                        const isShimocha = idx === (dealerIndex + 1) % players.length;
                        let ledClass = 'off';
                        if (isDealer) {
                          ledClass = 'lit';
                        } else if (isShimocha) {
                          ledClass = isBlinkOn ? 'lit' : 'off';
                        }
                        const ledTitle = isDealer ? '当前庄位 (亮起)' : (isShimocha ? '庄位下家 (闪烁)' : '闲家 (熄灭)');

                        return (
                          <div key={p.id} className="preview-row">
                            <span className="preview-player-name" style={{ display: 'inline-flex', alignItems: 'center' }}>
                              {theme === 'rexx' && (
                                <span className={`rexx-led-oval ${ledClass}`} title={ledTitle} />
                              )}
                              {getPlayerDisplayName(p)}
                              {show供托Info && <span style={{ fontSize: '0.65rem', color: 'var(--color-accent)', marginLeft: '4px' }}>(立直-1000)</span>} :
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
                        const sticksDiff = (nextSticksOnTable - initialSticksOnTable) * 1000;

                        if (initialSticksOnTable > 0 || nextSticksOnTable > 0) {
                          return (
                            <div className="preview-row" style={{ borderTop: '1px dashed var(--border-color)', paddingTop: '6px', marginTop: '6px' }}>
                              <span className="preview-player-name" style={{ color: 'var(--text-secondary)' }}>
                                前局积存立直棒：
                              </span>
                              <span className="preview-scores">
                                {initialSticksOnTable}本({initialSticksOnTable * 1000}点) &rarr; {nextSticksOnTable}本({nextSticksOnTable * 1000}点)
                                <span className={`preview-diff ${sticksDiff > 0 ? 'positive' : (sticksDiff < 0 ? 'negative' : 'zero')}`}>
                                  {sticksDiff > 0 ? `+${sticksDiff}` : (sticksDiff < 0 ? sticksDiff.toString() : '0')}
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
                        <span style={{ color: 'var(--color-accent)', fontWeight: 'bold' }}>对局完场 (半庄结束)</span>
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

          <div className="modal-footer">
            <button type="button" className="btn" onClick={onClose}>取消</button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={
                !preview ||
                (mode === 'ron' && (loserId === null || getActiveWinners().every(wId => (winnerScores[wId]?.basePoints || 0) <= 0))) ||
                (mode === 'tsumo' && (tsumoKoPay <= 0 || (!isDealerWinner && tsumoOyaPay <= 0))) ||
                (mode === 'draw' && isChombo && tenpaiStates.filter(t => t).length === 0)
              }
            >
              确认提交
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
