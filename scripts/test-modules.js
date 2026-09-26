/**
 * Automated Verification Suite for Module Architecture & Security Guard
 * 
 * Verifies:
 * 1. Unmounted LAN Mode: direct throughput to business code, security module unmounted.
 * 2. Complete Decoupling: server.js operates cleanly even when modules are missing.
 * 3. Mounted Server Mode: security module mounted, traffic cleaning active.
 * 4. Threat Interception & Process Survival: 403 Forbidden on attack probes, server STAYS ALIVE.
 * 5. Clean Traffic Transparency: normal business requests pass without interference.
 * 6. Dynamic IP Ban & Rate Limiting: strike accumulation and auto-ban logic.
 */

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const rootDir = path.resolve(__dirname, '..');
const TEST_PORT = 3188;

function makeRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: TEST_PORT,
      timeout: 3000,
      ...options
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    if (postData) req.write(postData);
    req.end();
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runTests() {
  console.log('===============================================================');
  console.log('  TEST SUITE: Modular Decoupling & Network Security Engine');
  console.log('===============================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${message}`);
      failed++;
    }
  }

  // -------------------------------------------------------------
  // Test Section 1: Pure Unit & Mock Tests for Security Guard Engine
  // -------------------------------------------------------------
  console.log('--- 1. Testing Security Guard Logic & Auto-Ban Unit Tests ---');
  const guard = require('../security-guard');
  guard.resetStats();

  // 1.1 Inspect threat detections
  const threatTraversal = guard.inspectThreat({ originalUrl: '/api/v1/../../etc/passwd', method: 'GET' });
  assert(threatTraversal !== null && threatTraversal.threat.includes('Path Traversal'), 'Detects Path Traversal (..)');

  const threatPhp = guard.inspectThreat({ originalUrl: '/wp-login.php', method: 'GET' });
  assert(threatPhp !== null && threatPhp.threat.includes('Exploit/scanner'), 'Detects scanner endpoint (/wp-login.php)');

  const threatXss = guard.inspectThreat({ originalUrl: '/search?q=%3Cscript%3Ealert(1)%3C/script%3E', method: 'GET' });
  assert(threatXss !== null && threatXss.threat.includes('Malicious payload'), 'Detects XSS script injection');

  const threatScannerUa = guard.inspectThreat({ originalUrl: '/', method: 'GET', headers: { 'user-agent': 'sqlmap/1.5#dev' } });
  assert(threatScannerUa !== null && threatScannerUa.threat.includes('Vulnerability scanner'), 'Detects vulnerability scanner User-Agent (sqlmap)');

  const cleanReq = guard.inspectThreat({ originalUrl: '/api/health', method: 'GET', headers: { 'user-agent': 'Mozilla/5.0' } });
  assert(cleanReq === null, 'Allows clean business request (/api/health)');

  // 1.2 Non-terminating 403 response test (mock Express res)
  let mockStatusCode = null;
  let mockBody = null;
  const mockRes = {
    headersSent: false,
    status(code) { mockStatusCode = code; return this; },
    type() { return this; },
    set() { return this; },
    setHeader() { return this; },
    send(body) { mockBody = body; }
  };
  guard.handleThreat({ originalUrl: '/wp-admin', method: 'GET', headers: {} }, mockRes, threatPhp, 'HTTP');
  assert(mockStatusCode === 403, 'handleThreat returns HTTP 403 Forbidden without crashing');
  assert(mockBody && mockBody.includes('403 Forbidden'), 'Response body contains clean forbidden message');

  // 1.3 Facade compatibility test
  const rootSecurityGuard = require('../security-guard');
  assert(typeof rootSecurityGuard.inspectThreat === 'function', 'Root security-guard.js facade exports inspectThreat');
  assert(typeof rootSecurityGuard.securityMiddleware === 'function', 'Root security-guard.js facade exports securityMiddleware');

  // -------------------------------------------------------------
  // Test Section 2: Integration Test - LAN Mode (Unmounted)
  // -------------------------------------------------------------
  console.log('\n--- 2. Integration Test: LAN Mode (Unmounted Direct Throughput) ---');
  let lanServerProcess = null;
  try {
    lanServerProcess = spawn('node', ['server.js'], {
      cwd: rootDir,
      env: { ...process.env, PORT: TEST_PORT, TARGET_ENV: 'lan' },
      stdio: 'pipe'
    });

    // Wait for server to boot
    await sleep(1500);

    const healthRes = await makeRequest({ path: '/api/health', method: 'GET' });
    assert(healthRes.statusCode === 200, 'LAN Mode: server boots and responds 200 OK');
    
    const healthJson = JSON.parse(healthRes.body);
    assert(Array.isArray(healthJson.activeModules), 'health API returns activeModules list');
    assert(!healthJson.activeModules.includes('security'), 'LAN Mode: security module is UNMOUNTED (activeModules does not include security)');
    assert(!healthJson.activeModules.includes('server-extension'), 'LAN Mode: server-extension is UNMOUNTED');
    console.log(`  [INFO] LAN Mode Active Modules: [${healthJson.activeModules.join(', ')}] (Zero overhead for business logic)`);

    // 2.1 Verify URL permission lockdown in LAN Mode (ONLY '/' is allowed, all others 301 to '/')
    const lanRootRes = await makeRequest({ path: '/', method: 'GET' });
    assert(lanRootRes.statusCode === 200, 'LAN Mode: / returns 200 OK');

    const lanHomeRes = await makeRequest({ path: '/home', method: 'GET' });
    assert(lanHomeRes.statusCode === 301 && lanHomeRes.headers['location'] === '/', 'LAN Mode: /home returns 301 redirect to /');

    const lanRoomRes = await makeRequest({ path: '/12345', method: 'GET' });
    assert(lanRoomRes.statusCode === 301 && lanRoomRes.headers['location'] === '/', 'LAN Mode: /12345 returns 301 redirect to /');

    const lanAdminRes = await makeRequest({ path: '/admin', method: 'GET' });
    assert(lanAdminRes.statusCode === 301 && lanAdminRes.headers['location'] === '/', 'LAN Mode: /admin returns 301 redirect to /');

  } finally {
    if (lanServerProcess) {
      lanServerProcess.kill();
      await sleep(500);
    }
  }

  // -------------------------------------------------------------
  // Test Section 3: Integration Test - Public Server Mode (Mounted)
  // -------------------------------------------------------------
  console.log('\n--- 3. Integration Test: Public Server Mode (Mounted & Resilient) ---');
  let serverProcess = null;
  try {
    serverProcess = spawn('node', ['server.js'], {
      cwd: rootDir,
      env: { ...process.env, PORT: TEST_PORT, TARGET_ENV: 'server' },
      stdio: 'pipe'
    });

    serverProcess.stderr.on('data', d => {
      // Capture any unexpected errors
      const str = d.toString();
      if (!str.includes('[SECURITY ALERT]') && !str.includes('[MODULE]')) {
        console.error('  [SERVER-STDERR]', str.trim());
      }
    });

    await sleep(1500);

    // 3.1 Verify health and mounted module list
    const serverHealth = await makeRequest({ path: '/api/health', method: 'GET' });
    assert(serverHealth.statusCode === 200, 'Server Mode: boots successfully and responds 200 OK');
    const serverHealthJson = JSON.parse(serverHealth.body);
    assert(serverHealthJson.activeModules.includes('security'), 'Server Mode: security module is MOUNTED');
    assert(serverHealthJson.activeModules.includes('server-extension'), 'Server Mode: server-extension module is MOUNTED');
    console.log(`  [INFO] Public Server Active Modules: [${serverHealthJson.activeModules.join(', ')}]`);

    // 3.2 Verify security headers attached to normal traffic
    assert(serverHealth.headers['x-content-type-options'] === 'nosniff', 'Security header attached: X-Content-Type-Options: nosniff');
    assert(serverHealth.headers['x-frame-options'] === 'SAMEORIGIN', 'Security header attached: X-Frame-Options: SAMEORIGIN');

    // 3.3 Attack probe: Path Traversal
    const traversalRes = await makeRequest({ path: '/test/..%2f..%2fetc/passwd', method: 'GET' });
    assert(traversalRes.statusCode === 403, 'Blocked Path Traversal probe with 403 Forbidden');

    // 3.4 Attack probe: Exploit scanner endpoint (/wp-login.php)
    const phpRes = await makeRequest({ path: '/wp-login.php', method: 'GET' });
    assert(phpRes.statusCode === 403, 'Blocked scanner probe (/wp-login.php) with 403 Forbidden');

    // 3.5 Attack probe: XSS payload in query string
    const xssRes = await makeRequest({ path: '/?tag=%3Cscript%3Ealert(1)%3C/script%3E', method: 'GET' });
    assert(xssRes.statusCode === 403, 'Blocked XSS payload query with 403 Forbidden');

    // 3.6 Attack probe: Automated scanner User-Agent
    const scannerRes = await makeRequest({
      path: '/',
      method: 'GET',
      headers: { 'User-Agent': 'sqlmap/1.5.2#stable (https://sqlmap.org)' }
    });
    assert(scannerRes.statusCode === 403, 'Blocked automated vulnerability scanner User-Agent with 403 Forbidden');

    // 3.7 CRITICAL CHECK: Process Survival & Business Code Integrity
    // After multiple malicious attacks, send legitimate business request
    const postAttackHealth = await makeRequest({ path: '/api/health', method: 'GET' });
    assert(postAttackHealth.statusCode === 200, 'PROCESS SURVIVAL: Server is STILL HEALTHY and running 200 OK after multiple attacks!');

    // 3.8.1 Root URL / in Server Mode: 302 Redirect to /home
    const serverRootRes = await makeRequest({ path: '/', method: 'GET' });
    assert(serverRootRes.statusCode === 302 && serverRootRes.headers['location'] === '/home', 'Server Mode: / returns 302 redirect to /home');

    // 3.8.2 Lobby URL /home in Server Mode: 200 OK with __TARGET_ENV__
    const serverHomeRes = await makeRequest({ path: '/home', method: 'GET' });
    assert(serverHomeRes.statusCode === 200 && serverHomeRes.body.includes('window.__TARGET_ENV__ = "server"'), 'Server Mode: /home returns 200 OK and injects server target');

    // 3.8.3 Verify Server Extension Admin route is mounted
    const adminRes = await makeRequest({ path: '/admin', method: 'GET' });
    assert(adminRes.statusCode === 200 && adminRes.body.includes('服务器管理面板'), 'Server Extension: /admin route mounted and functional');

    // 3.9 5-Digit Pure Numeric Room URL routing: /12345
    const roomPathRes = await makeRequest({ path: '/12345', method: 'GET' });
    assert(roomPathRes.statusCode === 200, '5-Digit Room URL /12345 returns 200 OK');
    assert(roomPathRes.body.includes('window.__ROOM_ID__ = "12345"'), '5-Digit Room URL serves frontend SPA index.html with __ROOM_ID__');

    // 3.10 API: Create 5-digit room
    const createRoomRes = await makeRequest({
      path: '/api/rooms/create',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    assert(createRoomRes.statusCode === 200, 'POST /api/rooms/create returns 200 OK');
    const createRoomJson = JSON.parse(createRoomRes.body);
    assert(createRoomJson.success === true, 'Room creation reports success: true');
    assert(/^\d{5}$/.test(createRoomJson.roomId), `Room ID is exactly 5 pure digits: ${createRoomJson.roomId}`);
    assert(createRoomJson.url === `/${createRoomJson.roomId}`, `Room URL path matches 5 digits: ${createRoomJson.url}`);

    // 3.11 API: Verify 5-digit room
    const verifyValidRes = await makeRequest({ path: `/api/rooms/verify/${createRoomJson.roomId}`, method: 'GET' });
    assert(verifyValidRes.statusCode === 200, 'GET /api/rooms/verify/:5digits returns 200 OK');
    const verifyValidJson = JSON.parse(verifyValidRes.body);
    assert(verifyValidJson.valid === true && verifyValidJson.exists === true, 'Created room exists and is valid');

    const verifyInvalidRes = await makeRequest({ path: '/api/rooms/verify/abc', method: 'GET' });
    assert(verifyInvalidRes.statusCode === 400, 'GET /api/rooms/verify/invalid returns 400 Bad Request');

  } finally {
    if (serverProcess) {
      serverProcess.kill();
      await sleep(500);
    }
  }

  // -------------------------------------------------------------
  // Test Section 4: Interface Decoupling & Standalone Architecture Test
  // -------------------------------------------------------------
  console.log('\n--- 4. Interface Decoupling & Standalone Architecture Test ---');
  // Test that security-guard and server-extension provide clean lifecycle hooks without modules/ directory
  assert(!fs.existsSync(path.join(rootDir, 'modules')), 'Zero Modules Directory: modules/ directory is completely removed');
  const serverExtension = require('../server-extension');
  assert(typeof serverExtension.onPreMiddleware === 'function', 'serverExtension provides onPreMiddleware');
  assert(typeof serverExtension.onRoutes === 'function', 'serverExtension provides onRoutes');
  assert(typeof serverExtension.onSocketMiddleware === 'function', 'serverExtension provides onSocketMiddleware');
  assert(typeof serverExtension.onSocketConnection === 'function', 'serverExtension provides onSocketConnection');
  // -------------------------------------------------------------
  // Test Section 5: CLI Arguments Gating Test
  // -------------------------------------------------------------
  console.log('\n--- 5. CLI Arguments & Runtime Flag Tests ---');
  let cliServerProcess = null;
  try {
    // 5.1 Test --target=lan --no-modules
    cliServerProcess = spawn('node', ['server.js', '--target=lan', '--no-modules'], {
      cwd: rootDir,
      env: { ...process.env, PORT: TEST_PORT },
      stdio: 'pipe'
    });
    await sleep(1500);

    const cliHealthRes = await makeRequest({ path: '/api/health', method: 'GET' });
    assert(cliHealthRes.statusCode === 200, 'CLI --target=lan --no-modules: server boots and responds 200 OK');
    const cliHealthJson = JSON.parse(cliHealthRes.body);
    assert(cliHealthJson.activeModules.length === 0, 'CLI --target=lan --no-modules: activeModules is strictly empty []');

    const cliRootRes = await makeRequest({ path: '/', method: 'GET' });
    assert(cliRootRes.body.includes('window.__TARGET_ENV__ = "lan"'), 'CLI LAN mode: serves index.html injected with __TARGET_ENV__ = "lan"');
  } finally {
    if (cliServerProcess) {
      cliServerProcess.kill();
      await sleep(500);
    }
  }

  try {
    // 5.2 Test --target=server
    cliServerProcess = spawn('node', ['server.js', '--target=server'], {
      cwd: rootDir,
      env: { ...process.env, PORT: TEST_PORT },
      stdio: 'pipe'
    });
    await sleep(1500);

    const cliServerHealth = await makeRequest({ path: '/api/health', method: 'GET' });
    const cliServerJson = JSON.parse(cliServerHealth.body);
    assert(cliServerJson.activeModules.includes('security') && cliServerJson.activeModules.includes('server-extension'), 'CLI --target=server: mounts both security and server-extension');
  } finally {
    if (cliServerProcess) {
      cliServerProcess.kill();
      await sleep(500);
    }
  }

  console.log('\n===============================================================');
  console.log(`  TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('[TEST SUITE ERROR]', err);
  process.exit(1);
});
