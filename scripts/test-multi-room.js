/**
 * Multi-Room Isolation, Lobby Flow & Governance Test Suite
 *
 * Verifies (against `node server.js --target=server --multi-room`):
 *   1. Room binding: join-room payload is authoritative; first joiner's device token becomes host.
 *   2. Strict stage management:
 *      - pre-start: in-game requests (update-state etc.) are rejected; claim = 准备 (no game entry)
 *      - start-game: host-only, requires every member prepared; host auto-seated (no preparation)
 *      - post-start: claim/release (前置阶段) rejected; whitelisted rebind via join-room (gameStarted)
 *   3. Isolation: state-updated broadcasts are room-scoped (other rooms receive nothing).
 *   4. Governance: host-only seat swap & kick (token revoked) & disband.
 *   5. APIs: /api/rooms lists live rooms; /api/health reports multiRoom.roomCount.
 *   6. TTL sweep: idle un-started rooms are auto-destroyed (env-tunable for the test).
 *   7. Single-room regression: legacy payload shape still works without --multi-room.
 *
 * Run: node scripts/test-multi-room.js
 */

const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const rootDir = path.resolve(__dirname, '..');
const io = require(path.join(rootDir, 'frontend', 'node_modules', 'socket.io-client'));

const PORT_MULTI = 31995;
const PORT_SINGLE = 31996;
const BASE_MULTI = `http://localhost:${PORT_MULTI}`;

let passed = 0;
let failed = 0;
const ok = (cond, label) => {
  if (cond) { passed++; console.log(`  [PASS] ${label}`); }
  else { failed++; console.log(`  [FAIL] ${label}`); }
};

function waitFor(socket, event, timeoutMs = 1500) {
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

async function main() {
  console.log('==============================================================');
  console.log('  TEST SUITE: Multi-Room Isolation, Lobby Flow & Governance');
  console.log('==============================================================');

  const multi = spawn('node', ['server.js', '--target=server', '--multi-room'], {
    cwd: rootDir,
    env: {
      ...process.env,
      PORT: String(PORT_MULTI),
      MULTI_ROOM_SWEEP_INTERVAL_SECONDS: '1',
      MULTI_ROOM_IDLE_DESTROY_MINUTES: '0.05', // ~3s, for TTL test
      MULTI_ROOM_FINISHED_DESTROY_MINUTES: '0.06', // ~3.6s
      MULTI_ROOM_GAME_DESTROY_MINUTES: '0.12', // ~7.2s
      MULTI_ROOM_GAME_WARNING_MINUTES: '0.07' // ~4.2s
    },
    stdio: 'ignore'
  });
  const single = spawn('node', ['server.js', '--target=server'], {
    cwd: rootDir,
    env: { ...process.env, PORT: String(PORT_SINGLE) },
    stdio: 'ignore'
  });

  try {
    // wait for boot
    let booted = false;
    for (let i = 0; i < 40 && !booted; i++) {
      await sleep(250);
      try { const h = await httpGetJson(`${BASE_MULTI}/api/health`); booted = h.status === 200; } catch (e) { /* retry */ }
    }
    ok(booted, 'Multi-room server boots and /api/health responds');

    // ---- 1. Binding & host election ----
    const A = await connect(BASE_MULTI);
    const lobbyWait1 = waitFor(A, 'lobby-updated');
    A.emit('join-room', { roomId: '10001', deviceId: 'devA' });
    const roleA = await waitFor(A, 'room-role');
    ok(roleA && roleA.isHost === true, 'First joiner (devA) is elected host via room-role');
    const stA = await waitFor(A, 'state-updated');
    ok(stA && Array.isArray(stA.players), 'Joining room delivers room-scoped initial state');
    const lobbyA1 = await lobbyWait1;
    ok(lobbyA1 && lobbyA1.allConfirmed === false, 'lobby-updated: fresh room has no prepared members');

    const B = await connect(BASE_MULTI);
    B.emit('join-room', { roomId: '10001', deviceId: 'devB' });
    const roleB = await waitFor(B, 'room-role');
    ok(roleB && roleB.isHost === false, 'Second joiner (devB) is NOT host');

    const C = await connect(BASE_MULTI);
    C.emit('join-room', { roomId: '10002', deviceId: 'devC' });
    await waitFor(C, 'room-role');

    // ---- 2. Strict stage management (pre-start): in-game requests rejected ----
    await sleep(300); // drain
    A.emit('update-state', stA, '[越权] 开局前记分');
    const preErrA = await waitFor(A, 'action-error');
    ok(preErrA && /尚未开始/.test(preErrA.message || ''), 'Pre-start update-state is rejected (strict stage gate)');

    // ---- 3. Lobby flow: member prepares (claim = 准备, no game entry) ----
    const lobbyB = waitFor(B, 'lobby-updated');
    B.emit('claim-seat', { roomId: '10001', playerId: 1, playerName: '成员B', deviceId: 'devB' });
    const claimB = await waitFor(B, 'claim-seat-result');
    ok(claimB && claimB.success === true && claimB.gameStarted === false, `Member B prepares seat 1 (got ${claimB ? JSON.stringify(claimB) : 'NULL'})`);
    const lobbyBData = await lobbyB;
    ok(lobbyBData && lobbyBData.allConfirmed === true, 'lobby-updated: all members prepared after B');

    // ---- 4. Host starts: lock + synchronous entry + host auto-seat ----
    const D = await connect(BASE_MULTI);
    D.emit('join-room', { roomId: '10001', deviceId: 'devD' });
    await waitFor(D, 'room-role');
    D.emit('claim-seat', { roomId: '10001', playerId: 2, playerName: '成员D', deviceId: 'devD' });
    const claimD = await waitFor(D, 'claim-seat-result');
    ok(claimD && claimD.success === true, 'Pre-start joiner D prepares seat 2');
    D.emit('leave-room', { roomId: '10001' }); // full exit: membership removed
    await sleep(300);

    const hostResult = waitFor(A, 'claim-seat-result');
    const gsB = waitFor(B, 'game-started');
    const gsC = waitFor(C, 'game-started', 700); // should NOT arrive
    A.emit('start-game', { roomId: '10001', deviceId: 'devA', playerName: '房主A' });
    const hostSeat = await hostResult;
    ok(hostSeat && hostSeat.success === true && hostSeat.playerId === 0 && hostSeat.gameStarted === true,
       'Host auto-seated at first free seat (0) with gameStarted=true');
    const gsBData = await gsB;
    ok(gsBData !== null, 'game-started broadcast reaches all members simultaneously');
    const gsCData = await gsC;
    ok(gsCData === null, 'game-started does not leak to other rooms');

    // ---- 5. Strict stage management (post-start): pre-stage requests rejected ----
    A.emit('claim-seat', { roomId: '10001', playerId: 1, playerName: '房主A', deviceId: 'devA' });
    const postClaim = await waitFor(A, 'claim-seat-result');
    ok(postClaim && postClaim.success === false && /对局已开始/.test(postClaim.reason || ''), 'Post-start claim-seat (前置阶段) is rejected');
    A.emit('release-seat', { roomId: '10001' });
    const postRelease = await waitFor(A, 'action-error');
    ok(postRelease && /对局已开始/.test(postRelease.message || ''), 'Post-start release-seat (前置阶段) is rejected');

    // ---- 5.1 URL access to a started room: no claim stage, existing popup flow ----
    const EJ = await connect(BASE_MULTI);
    const gasWait = waitFor(EJ, 'game-already-started');
    EJ.emit('join-room', { roomId: '10001', deviceId: 'devEJ' });
    const gasData = await gasWait;
    ok(gasData !== null && /已开始/.test(gasData.message || ''), 'URL join of started room returns game-already-started (no claim stage)');
    EJ.disconnect();

    // ---- 6. Room-scoped broadcast isolation (in-game) ----
    await sleep(400); // drain in-flight broadcasts
    const stBPromise = waitFor(B, 'state-updated');
    const stCPromise = waitFor(C, 'state-updated', 700); // should NOT arrive
    await sleep(200);
    const nextState = JSON.parse(JSON.stringify(stA));
    nextState.players[0].score = 39000;
    A.emit('update-state', nextState, '[东1局|0本场][荣和][房主A] 3900点');
    const stB = await stBPromise;
    ok(stB && stB.players && stB.players[0].score === 39000, 'Same-room client B receives in-game state-updated');
    const stCData = await stCPromise;
    ok(stCData === null, 'Other-room client C does NOT receive room 10001 broadcast (isolation)');

    // ---- 7. Page-refresh simulation: join-room rebind ----
    A.disconnect(true);
    await sleep(300);
    const A2 = await connect(BASE_MULTI);
    const rebindResult = waitFor(A2, 'claim-seat-result');
    A2.emit('join-room', { roomId: '10001', deviceId: 'devA' });
    const rebindData = await rebindResult;
    ok(rebindData && rebindData.success === true && rebindData.playerId === 0 && rebindData.gameStarted === true,
       'Post-start refresh: join-room rebinds whitelisted token (gameStarted=true, seat 0)');

    // ---- 8. Governance: swap & kick (host token required) ----
    E_LOOP: {
      const E = await connect(BASE_MULTI);
      E.emit('join-room', { roomId: '10001', deviceId: 'devE' });
      await waitFor(E, 'room-role');
      E.emit('swap-seats', { roomId: '10001', seatA: 0, seatB: 1, deviceId: 'devE' });
      const swapErrE = await waitFor(E, 'action-error');
      ok(swapErrE && /房主/.test(swapErrE.message || ''), 'Non-host swap attempt is rejected');
      E.disconnect();
      break E_LOOP;
    }
    await sleep(400); // drain
    const stSwapA = waitFor(A2, 'state-updated');
    A2.emit('swap-seats', { roomId: '10001', seatA: 0, seatB: 1, deviceId: 'devA' });
    const stSwapped = await stSwapA;
    ok(stSwapped && stSwapped.players[0].name === '成员B' && stSwapped.players[1].name === '房主A',
       `Host swap-seats exchanges member identities (got ${stSwapped ? JSON.stringify(stSwapped.players.map(p => p.name + '/' + String(p.deviceId).slice(0, 8))) : 'NULL'})`);
    A2.emit('swap-seats', { roomId: '10001', seatA: 0, seatB: 2, deviceId: 'devA' });
    const swapErrEmpty = await waitFor(A2, 'action-error');
    ok(swapErrEmpty && /确认/.test(swapErrEmpty.message || ''), 'Swap with unprepared seat is rejected');

    D.emit('kick-player', { roomId: '10001', playerId: 1, deviceId: 'devD' });
    const kickErrD = await waitFor(D, 'action-error');
    ok(kickErrD && /房主/.test(kickErrD.message || ''), 'Non-host kick attempt is rejected');
    const kickedPromise = waitFor(B, 'kicked');
    // After the 0<->1 swap, member B sits on seat 0 — host kicks seat 0 (his own token is now on seat 1)
    A2.emit('kick-player', { roomId: '10001', playerId: 0, deviceId: 'devA' });
    const kickedData = await kickedPromise;
    ok(kickedData !== null, `Kicked member receives kicked event (got ${JSON.stringify(kickedData)})`);
    B.emit('claim-seat', { roomId: '10001', playerId: 0, playerName: '成员B', deviceId: 'devB' });
    const reclaimB = await waitFor(B, 'claim-seat-result');
    ok(reclaimB && reclaimB.success === false, 'Kicked token is revoked and can no longer claim');

    // ---- 9. Disband (host token required) ----
    D.emit('disband-room', { roomId: '10001', deviceId: 'devD' });
    const disbandErrD = await waitFor(D, 'action-error');
    ok(disbandErrD && /房主/.test(disbandErrD.message || ''), 'Non-host disband attempt is rejected');
    const disbandA = waitFor(A2, 'room-disbanded');
    A2.emit('disband-room', { roomId: '10001', deviceId: 'devA' });
    const disbandData = await disbandA;
    ok(disbandData !== null, 'Host disband delivers room-disbanded to members');
    const roomsAfterDisband = await httpGetJson(`${BASE_MULTI}/api/rooms`);
    ok(roomsAfterDisband.json && roomsAfterDisband.json.enabled === true &&
       !roomsAfterDisband.json.rooms.some(r => r.roomId === '10001'), 'Disbanded room removed from /api/rooms');

    // ---- 10. APIs ----
    const roomsNow = await httpGetJson(`${BASE_MULTI}/api/rooms`);
    ok(roomsNow.json && roomsNow.json.enabled === true && Array.isArray(roomsNow.json.rooms), '/api/rooms lists live rooms (multi-room on)');
    const health = await httpGetJson(`${BASE_MULTI}/api/health`);
    ok(health.json && health.json.multiRoomEnabled === true && health.json.multiRoom && typeof health.json.multiRoom.roomCount === 'number', '/api/health reports multiRoom.roomCount');
    const created = await httpPostJson(`${BASE_MULTI}/api/rooms/create`, { gameMode: 'yonma' });
    ok(created.json && created.json.success === true && /^\d{5}$/.test(created.json.roomId || ''), 'POST /api/rooms/create pre-creates a 5-digit room');

    // ---- 10.1 Creator-token host binding at creation time (anti both-host / anti host steal) ----
    const created2 = await httpPostJson(`${BASE_MULTI}/api/rooms/create`, { gameMode: 'yonma', token: 'devCreator' });
    ok(created2.json && created2.json.success === true, 'create API with creator token succeeds');
    const X1 = await connect(BASE_MULTI);
    X1.emit('join-room', { roomId: created2.json.roomId, deviceId: 'devOther' });
    const roleX1 = await waitFor(X1, 'room-role');
    ok(roleX1 && roleX1.isHost === false, 'Early URL joiner does NOT steal host from creator token');
    const XC = await connect(BASE_MULTI);
    XC.emit('join-room', { roomId: created2.json.roomId, deviceId: 'devCreator' });
    const roleXC = await waitFor(XC, 'room-role');
    ok(roleXC && roleXC.isHost === true, 'Creator token is host even when joining after others');
    const created3 = await httpPostJson(`${BASE_MULTI}/api/rooms/create`, { gameMode: 'yonma', token: 'devC3' });
    ok(created3.json && created3.json.success === true && created3.json.roomId !== created2.json.roomId, 'Sequential creates return unique room ids (no collision)');
    X1.disconnect(); XC.disconnect();

    // ---- 11. Room switch releases old seat + membership ----
    const F = await connect(BASE_MULTI);
    F.emit('join-room', { roomId: '30001', deviceId: 'devF' });
    await waitFor(F, 'room-role');
    F.emit('claim-seat', { roomId: '30001', playerId: 0, playerName: 'F', deviceId: 'devF' });
    await waitFor(F, 'claim-seat-result');
    const roomsMid = await httpGetJson(`${BASE_MULTI}/api/rooms`);
    const room30001Mid = roomsMid.json.rooms.find(r => r.roomId === '30001');
    ok(room30001Mid && room30001Mid.connectedSeats === 1, 'Room 30001 has 1 connected seat before switch');
    F.emit('join-room', { roomId: '30002', deviceId: 'devF' });
    await waitFor(F, 'room-role');
    await sleep(300);
    const roomsAfterSwitch = await httpGetJson(`${BASE_MULTI}/api/rooms`);
    const room30001After = roomsAfterSwitch.json.rooms.find(r => r.roomId === '30001');
    ok(room30001After && room30001After.connectedSeats === 0, 'Switching rooms releases the seat in the old container');

    // ---- 12. TTL sweep: idle un-started room auto-destroyed (~3s idle, 1s sweep) ----
    const G = await connect(BASE_MULTI);
    G.emit('join-room', { roomId: '40001', deviceId: 'devG' });
    await waitFor(G, 'room-role');
    await sleep(4500);
    const roomsAfterTtl = await httpGetJson(`${BASE_MULTI}/api/rooms`);
    ok(roomsAfterTtl.json && !roomsAfterTtl.json.rooms.some(r => r.roomId === '40001'), 'Idle un-started room is auto-destroyed by sweep');
    G.disconnect();

    // ---- 12b. TTL sweep: finished room auto-destroyed (~3.6s, 1s sweep) ----
    const F1 = await connect(BASE_MULTI);
    F1.emit('join-room', { roomId: '40002', deviceId: 'devF1' });
    await waitFor(F1, 'room-role');
    F1.emit('start-game', { roomId: '40002', deviceId: 'devF1', playerName: 'F1Host' });
    await waitFor(F1, 'game-started');
    const stF = await waitFor(F1, 'state-updated');
    stF.isOver = true;
    F1.emit('update-state-no-history', stF, '终局结算');
    await sleep(4800);
    const roomsAfterFinished = await httpGetJson(`${BASE_MULTI}/api/rooms`);
    ok(roomsAfterFinished.json && !roomsAfterFinished.json.rooms.some(r => r.roomId === '40002'), 'Finished room is auto-destroyed by sweep after finishedDestroyMinutes');
    F1.disconnect();

    // ---- 12c. In-game room: warning when remaining time <= threshold and auto-destroyed at max duration ----
    const W1 = await connect(BASE_MULTI);
    W1.emit('join-room', { roomId: '40003', deviceId: 'devW1' });
    await waitFor(W1, 'room-role');
    const warnPromise = waitFor(W1, 'game-time-warning', 6000);
    const disbandPromise = waitFor(W1, 'room-disbanded', 10000);
    W1.emit('start-game', { roomId: '40003', deviceId: 'devW1', playerName: 'W1Host' });
    await waitFor(W1, 'game-started');
    const warnData = await warnPromise;
    ok(warnData && typeof warnData.remainingMinutes === 'number', 'In-game room emits game-time-warning when remaining time <= threshold');
    const timeoutDisbandData = await disbandPromise;
    ok(timeoutDisbandData && /5 小时|上限/.test(timeoutDisbandData.message || ''), 'In-game room auto-disbanded upon reaching game duration limit');
    W1.disconnect();

    // ---- 13. Single-room regression (no --multi-room) ----
    const S1 = await connect(`http://localhost:${PORT_SINGLE}`);
    S1.emit('claim-seat', { playerId: 0, playerName: '单房选手', deviceId: 'devS1' });
    const sClaim = await waitFor(S1, 'claim-seat-result');
    ok(sClaim && sClaim.success === true, 'Single-room mode: legacy claim-seat payload works');
    const sRole = await waitFor(S1, 'room-role', 500);
    ok(sRole === null, 'Single-room mode: no room-role events emitted (legacy behavior intact)');
    const S2 = await connect(`http://localhost:${PORT_SINGLE}`);
    const s2State = waitFor(S2, 'state-updated');
    S1.emit('update-state-no-history', (await waitFor(S1, 'state-updated')), null);
    const s2Data = await s2State;
    ok(s2Data !== null, 'Single-room mode: global broadcast semantics preserved');
    S1.disconnect(); S2.disconnect();

    A2.disconnect(); B.disconnect(); C.disconnect(); D.disconnect();
  } finally {
    multi.kill();
    single.kill();
    await Promise.all([waitForExit(multi), waitForExit(single)]);
  }

  console.log('==============================================================');
  console.log(`  TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('==============================================================');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('[FATAL]', e); process.exit(1); });
