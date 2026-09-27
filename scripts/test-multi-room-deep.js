/**
 * Multi-Room Deep Test Suite (边界 / 恶意载荷 / 重连 / 满员 / 三麻 / 压力)
 *
 * Covers what test-multi-room.js does not:
 *   D1  Sanma (3-seat) full lobby flow; out-of-bounds playerId must not crash the server
 *   D2  Duplicate confirm idempotency; confirming another member's confirmed seat is rejected
 *   D3  Host reconnect mid-lobby: host role + confirmed seat restored via device token
 *   D4  Member reconnect after confirm: seat restored (token whitelist)
 *   D5  Yonma 4-member full flow; post-start governance (swap any pair, kick, seat release)
 *   D6  Garbage roomId / malformed payloads: server must survive every case (health stays 200)
 *   D7  Rapid update-state burst: final state consistent, server alive
 *   D8  start-game gating: non-host / unconfirmed member blocks; member exit unblocks
 *   D9  Whitelist member release + re-claim while locked (voluntary exit keeps token)
 *
 * Run: node scripts/test-multi-room-deep.js
 */

const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const rootDir = path.resolve(__dirname, '..');
const io = require(path.join(rootDir, 'frontend', 'node_modules', 'socket.io-client'));

const PORT = 31997;
const BASE = `http://localhost:${PORT}`;

let passed = 0;
let failed = 0;
const ok = (cond, label) => {
  if (cond) { passed++; console.log(`  [PASS] ${label}`); }
  else { failed++; console.log(`  [FAIL] ${label}`); }
};

function waitFor(socket, event, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const t = setTimeout(() => { socket.off(event, h); resolve(null); }, timeoutMs);
    const h = (data) => { clearTimeout(t); socket.off(event, h); resolve(data); };
    socket.on(event, h);
  });
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = io(url, { transports: ['websocket'], reconnection: false, timeout: 5000 });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(body) }); } catch (e) { resolve({ status: res.statusCode, json: null }); } });
    }).on('error', reject);
  });
}

function httpPostJson(url, data) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = JSON.stringify(data || {});
    const req = http.request(u, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(body) }); } catch (e) { resolve({ status: res.statusCode, json: null }); } });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function waitForExit(child) {
  return new Promise(resolve => child.once('exit', resolve));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function alive() {
  try { const h = await httpGetJson(`${BASE}/api/health`); return h.status === 200; } catch (e) { return false; }
}

async function main() {
  console.log('==============================================================');
  console.log('  DEEP TEST SUITE: Multi-Room edge cases & abuse resistance');
  console.log('==============================================================');

  const srv = spawn('node', ['server.js', '--target=server'], {
    cwd: rootDir,
    env: { ...process.env, PORT: String(PORT) }, // default TTLs (no interference)
    stdio: 'ignore'
  });

  try {
    let booted = false;
    for (let i = 0; i < 40 && !booted; i++) {
      await sleep(250);
      booted = await alive();
    }
    ok(booted, 'Server boots');

    // ===== D1: Sanma 3-seat full flow (room pre-created via create API with gameMode=sanma) =====
    const created = await httpPostJson(`${BASE}/api/rooms/create`, { gameMode: 'sanma' });
    ok(created.json && created.json.success === true, 'D1 sanma room pre-created via create API');
    const SANMA_ROOM = created.json.roomId;
    const H = await connect(BASE);
    await sleep(200); // drain the connect-time initial state (default room) before listening
    const stHWait = waitFor(H, 'state-updated');
    H.emit('join-room', { roomId: SANMA_ROOM, deviceId: 'devH' });
    await waitFor(H, 'room-role');
    const stH = await stHWait;
    ok(stH && stH.players.length === 3 && stH.gameMode === 'sanma', `D1 sanma: container created as 3-player sanma (got ${stH ? 'len=' + stH.players.length + ' mode=' + stH.gameMode : 'NULL'})`);
    // 房主无需准备：不调用 claim-seat（前置阶段动作），开始对局时由服务端自动入座
    const M1 = await connect(BASE);
    M1.emit('join-room', { roomId: SANMA_ROOM, deviceId: 'devM1' });
    await waitFor(M1, 'room-role');
    M1.emit('claim-seat', { roomId: SANMA_ROOM, playerId: 1, playerName: 'M1', deviceId: 'devM1' });
    const m1Claim = await waitFor(M1, 'claim-seat-result');
    ok(m1Claim && m1Claim.success === true, 'D1 sanma: member M1 prepares seat 1');

    const M2 = await connect(BASE);
    M2.emit('join-room', { roomId: SANMA_ROOM, deviceId: 'devM2' });
    await waitFor(M2, 'room-role');
    M2.emit('claim-seat', { roomId: SANMA_ROOM, playerId: 2, playerName: 'M2', deviceId: 'devM2' });
    const m2Claim = await waitFor(M2, 'claim-seat-result');
    ok(m2Claim && m2Claim.success === true, 'D1 sanma: member M2 prepares seat 2');

    // Out-of-bounds playerId (3 does not exist in sanma) must be ignored without crashing
    await sleep(300); // drain in-flight broadcasts
    M2.emit('claim-seat', { roomId: SANMA_ROOM, playerId: 3, playerName: '越界', deviceId: 'devM2' });
    const oob = await waitFor(M2, 'claim-seat-result', 400);
    ok(oob === null, `D1 sanma: out-of-bounds playerId silently ignored (got ${oob ? JSON.stringify(oob) : 'no result'})`);
    ok(await alive(), 'D1 sanma: health still 200 after out-of-bounds attempt');

    // ===== D2: duplicate prepare / occupied prepare (pre-start) =====
    M1.emit('claim-seat', { roomId: SANMA_ROOM, playerId: 1, playerName: 'M1', deviceId: 'devM1' });
    const dupClaim = await waitFor(M1, 'claim-seat-result');
    ok(dupClaim && dupClaim.success === true, 'D2 duplicate prepare is idempotent (same token, same seat)');
    M2.emit('claim-seat', { roomId: SANMA_ROOM, playerId: 1, playerName: 'M2', deviceId: 'devM2' });
    const stealClaim = await waitFor(M2, 'claim-seat-result');
    ok(stealClaim && stealClaim.success === false, 'D2 preparing another member\'s prepared seat is rejected');

    // Host starts: members all prepared -> host auto-seated at first free seat (0)
    M1.emit('start-game', { roomId: SANMA_ROOM, deviceId: 'devM1' });
    const startErrM1 = await waitFor(M1, 'action-error');
    ok(startErrM1 && /房主/.test(startErrM1.message || ''), 'D1 sanma: non-host start rejected');
    const hostSeatResult = waitFor(H, 'claim-seat-result');
    const gsM1 = waitFor(M1, 'game-started');
    const gsM2 = waitFor(M2, 'game-started');
    H.emit('start-game', { roomId: SANMA_ROOM, deviceId: 'devH' });
    const hostSeat = await hostSeatResult;
    const gsH = await waitFor(H, 'game-started');
    const gsM1d = await gsM1;
    const gsM2d = await gsM2;
    ok(hostSeat && hostSeat.success === true && hostSeat.playerId === 0 && hostSeat.gameStarted === true,
       'D1 sanma: start-game auto-seats host at seat 0 (gameStarted=true)');
    ok(gsH !== null && gsM1d !== null && gsM2d !== null, 'D1 sanma: game-started reaches all 3 members');

    // ===== D3/D4: reconnect restores role and seat (strict stage: rebind via join-room) =====
    H.disconnect(true);
    await sleep(300);
    const H2 = await connect(BASE);
    const rebindWait = waitFor(H2, 'claim-seat-result');
    H2.emit('join-room', { roomId: SANMA_ROOM, deviceId: 'devH' });
    const roleH2 = await waitFor(H2, 'room-role');
    const rebindH2 = await rebindWait;
    ok(roleH2 && roleH2.isHost === true, 'D3 host reconnect: host role restored by device token');
    ok(rebindH2 && rebindH2.success === true && rebindH2.playerId === 0 && rebindH2.gameStarted === true,
       'D3 host reconnect: join-room auto-rebinds seat 0 (gameStarted=true)');

    M1.disconnect(true);
    await sleep(300);
    const M1b = await connect(BASE);
    const lobbyRestore = waitFor(M1b, 'lobby-updated');
    M1b.emit('join-room', { roomId: SANMA_ROOM, deviceId: 'devM1' });
    const roleM1b = await waitFor(M1b, 'room-role');
    const restoredLobby = await lobbyRestore;
    ok(roleM1b && roleM1b.isHost === false && restoredLobby && restoredLobby.confirmedSeatIds.includes(1),
       `D4 member reconnect: confirmed seat restored via token (got ${restoredLobby ? JSON.stringify({ c: restoredLobby.confirmedSeatIds, m: restoredLobby.members }) : 'NULL'})`);

    // ===== D5: yonma 4-member full flow + post-start governance =====
    const YH = await connect(BASE);
    YH.emit('join-room', { roomId: '50002', deviceId: 'devYH' });
    await waitFor(YH, 'room-role');
    const Ys = [];
    for (let i = 0; i < 3; i++) {
      const s = await connect(BASE);
      s.emit('join-room', { roomId: '50002', deviceId: 'devY' + i });
      await waitFor(s, 'room-role');
      s.emit('claim-seat', { roomId: '50002', playerId: i + 1, playerName: 'Y' + i, deviceId: 'devY' + i });
      await waitFor(s, 'claim-seat-result');
      Ys.push(s);
    }
    // 选座阶段：房主将已准备成员 Y0 从席位 1 移至自己选中的席位 0（与其交换座位）
    await sleep(200);
    const mvState = waitFor(YH, 'state-updated');
    YH.emit('move-member', { roomId: '50002', deviceId: 'devYH', fromSeat: 1, toSeat: 0 });
    const mvData = await mvState;
    ok(mvData && mvData.players[0].name === 'Y0' && mvData.players[1].name === '选手 2', 'D5 pre-start host move-member relocates member to host-selected seat');

    // 房主无需准备：YH 不调用 claim-seat，开始对局时自动入座首个空闲席位
    YH.on('action-error', e => console.log('  [D5-YH-ERR]', e && e.message));
    YH.emit('start-game', { roomId: '50002', deviceId: 'devYH', playerName: 'YH' });
    const gsYH = await waitFor(YH, 'game-started');
    ok(gsYH !== null, `D5 yonma: 4-member start-game succeeds (gsYH=${gsYH ? 'ok' : 'null'})`);
    await sleep(500); // flush action-error + game-started state broadcast before next listener

    Ys[0].emit('swap-seats', { roomId: '50002', seatA: 0, seatB: 3, deviceId: 'devY0' });
    const swapErrY = await waitFor(Ys[0], 'action-error');
    ok(swapErrY && /房主/.test(swapErrY.message || ''), 'D5 yonma: non-host swap rejected');
    const stY = waitFor(YH, 'state-updated');
    YH.emit('swap-seats', { roomId: '50002', seatA: 0, seatB: 3, deviceId: 'devYH' });
    const stYs = await stY;
    ok(stYs && stYs.players[0].name === 'Y2' && stYs.players[3].name === 'Y0', `D5 yonma: host swaps seats (got ${stYs ? JSON.stringify(stYs.players.map(p => p.name)) : 'NULL'})`);    await sleep(300); // drain swap broadcast
    // After the 0<->3 swap, member Y2 sits on seat 0 — host kicks seat 0 (not his own new seat 3)
    const kickSt = waitFor(YH, 'state-updated');
    YH.emit('kick-player', { roomId: '50002', playerId: 0, deviceId: 'devYH' });
    const stKick = await kickSt;
    ok(stKick && stKick.connectedPlayers[0] === false, 'D5 yonma: kick releases member seat 0');
    Ys[2].emit('claim-seat', { roomId: '50002', playerId: 0, playerName: 'Y2', deviceId: 'devY2' });
    const reclaimY2 = await waitFor(Ys[2], 'claim-seat-result');
    ok(reclaimY2 && reclaimY2.success === false, 'D5 yonma: kicked token cannot re-claim');

    // ===== D6: garbage roomId / malformed payloads =====
    const G1 = await connect(BASE);
    G1.emit('join-room', { roomId: 'abcdef' });
    const g1Joined = await waitFor(G1, 'room-joined');
    ok(g1Joined && g1Joined.roomId === 'default', 'D6 garbage roomId normalizes to default');
    G1.emit('join-room');                                   // no payload
    G1.emit('claim-seat');                                  // no payload
    G1.emit('claim-seat', { roomId: '10001', playerId: 'x' });   // non-number playerId
    G1.emit('claim-seat', { roomId: '10001', playerId: -5, deviceId: 'devG' }); // negative
    G1.emit('swap-seats', { roomId: '50002', seatA: 'x', seatB: 1, deviceId: 'devYH' }); // garbage seatA
    G1.emit('kick-player', { roomId: '50002', playerId: null, deviceId: 'devYH' });      // null playerId
    G1.emit('start-game');                                  // no payload
    await sleep(400);
    ok(await alive(), 'D6 malformed payloads: server survives all of them');
    const hAfter = await httpGetJson(`${BASE}/api/health`);
    ok(hAfter.status === 200 && hAfter.json.multiRoomEnabled === true, 'D6 health stays healthy with multi-room enabled');

    // ===== D7: rapid update-state burst =====
    await sleep(300); // drain in-flight broadcasts
    const BURST = 20;
    let lastBurst = null;
    YH.on('state-updated', s => { lastBurst = s; });
    for (let i = 1; i <= BURST; i++) {
      const snap = JSON.parse(JSON.stringify(stYs));
      snap.players[0].score = 25000 + i * 100;
      YH.emit('update-state', snap, `[burst ${i}]`);
      if (i % 5 === 0) await sleep(10);
    }
    await sleep(400);
    ok(lastBurst && lastBurst.players[0].score === 25000 + BURST * 100, `D7 update-state burst: final broadcast matches burst ${BURST} (got ${lastBurst ? lastBurst.players[0].score : 'null'})`);
    ok(await alive(), 'D7 update-state burst: server survives and keeps broadcasting');

    // ===== D8: unprepared members don't block start; they get the popup and are moved to lobby =====
    const UH = await connect(BASE);
    UH.emit('join-room', { roomId: '50003', deviceId: 'devUH' });
    await waitFor(UH, 'room-role');
    const UM = await connect(BASE);
    UM.emit('join-room', { roomId: '50003', deviceId: 'devUM' });
    await waitFor(UM, 'room-role');
    await sleep(300); // drain
    const umPopup = waitFor(UM, 'game-already-started');
    const hostSeatU = waitFor(UH, 'claim-seat-result');
    const gsUWait = waitFor(UH, 'game-started');
    UH.emit('start-game', { roomId: '50003', deviceId: 'devUH', seatId: 1, playerName: 'UH' }); // 房主选座偏好
    const gsU = await gsUWait;
    const seatU = await hostSeatU;
    const umPopupData = await umPopup;
    ok(gsU !== null, 'D8 start-game succeeds despite unprepared member');
    ok(umPopupData !== null && /已开始/.test(umPopupData.message || ''), 'D8 unprepared member receives game-already-started popup');
    ok(seatU && seatU.playerId === 1 && seatU.gameStarted === true, 'D8 host seatId preference honored (seat 1)');

    // ===== D9: post-start pre-stage rejection + whitelist rebind =====
    const W = await connect(BASE);
    W.emit('join-room', { roomId: '50004', deviceId: 'devW' });
    await waitFor(W, 'room-role');
    const WH = await connect(BASE);
    WH.emit('join-room', { roomId: '50004', deviceId: 'devWH' });
    await waitFor(WH, 'room-role');
    WH.emit('claim-seat', { roomId: '50004', playerId: 1, playerName: 'WH', deviceId: 'devWH' });
    await waitFor(WH, 'claim-seat-result');
    const hostSeatW = waitFor(W, 'claim-seat-result');
    W.emit('start-game', { roomId: '50004', deviceId: 'devW' });
    const gsW = await waitFor(W, 'game-started');
    const seatW = await hostSeatW;
    ok(gsW !== null && seatW && seatW.playerId === 0, 'D9 yonma: host auto-seated at seat 0 on start');
    // Post-start pre-stage rejection: release-seat refused for whitelisted member too
    WH.emit('release-seat', { roomId: '50004' });
    const wReleaseErr = await waitFor(WH, 'action-error');
    ok(wReleaseErr && /对局已开始/.test(wReleaseErr.message || ''), 'D9 post-start release-seat rejected (strict stage)');
    // Whitelist rebind: member refreshes -> join-room auto-rebinds (gameStarted=true)
    WH.disconnect(true);
    await sleep(300);
    const WH2 = await connect(BASE);
    const wRebind = waitFor(WH2, 'claim-seat-result');
    WH2.emit('join-room', { roomId: '50004', deviceId: 'devWH' });
    const wRebindData = await wRebind;
    ok(wRebindData && wRebindData.success === true && wRebindData.playerId === 1 && wRebindData.gameStarted === true,
       'D9 whitelisted member refresh: join-room rebinds seat 1 (gameStarted=true)');
    // URL 访问已开始的对局：不返回选座阶段，下发 game-already-started
    const FJ = await connect(BASE);
    const fjWait = waitFor(FJ, 'game-already-started');
    FJ.emit('join-room', { roomId: '50004', deviceId: 'devFJ' });
    const fjData = await fjWait;
    ok(fjData !== null && /已开始/.test(fjData.message || ''), 'D9 URL join of started room returns game-already-started');
    FJ.disconnect();

    H2.disconnect(); M1b.disconnect(); M2.disconnect(); YH.disconnect(); Ys.forEach(s => s.disconnect());
    G1.disconnect(); UH.disconnect(); UM.disconnect(); W.disconnect(); WH.disconnect();
  } finally {
    srv.kill();
    await waitForExit(srv);
  }

  console.log('==============================================================');
  console.log(`  DEEP TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('==============================================================');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('[FATAL]', e); process.exit(1); });
