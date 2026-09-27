/**
 * Security Guard & Traffic Cleaning Engine (公网服务器网络安全防护核心)
 * 
 * Provides front-loaded traffic inspection, sanitization, threat blocking,
 * rate limiting, and dynamic IP auto-ban for public server deployment.
 * 
 * In public server mode:
 * - Threat detection responds with 403 Forbidden (never process.exit(1))
 * - Dynamic IP banning for repeated probe attempts
 * - Sliding-window rate limiting to prevent flood / DoS attacks
 * - Clean requests pass through seamlessly (next()) with zero business interference
 */

const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, 'security_alerts.log');

// Path traversal & relative path attacks
const PATH_TRAVERSAL_PATTERNS = ['..', '%2e%2e'];

// Sensitive file, credential, and dotfile probing
const SENSITIVE_PATTERNS = [
  /\/\.(env|git|svn|hg|bzr|aws|ssh|ds_store|vscode|idea|htaccess|htpasswd)/i,
  /\/(config\.json|\.user\.ini|web\.config|docker-compose|dockerfile)/i,
  /\/etc\/(passwd|shadow|hosts)/i,
  /\/(windows|winnt)\/win\.ini/i,
  /\/proc\/(self|version|cpuinfo)/i
];

// Known exploit & scanner endpoints (PHP/ASP/JSP/CGI scripts, CMS admin paths)
const EXPLOIT_ENDPOINTS = [
  /\.(php|asp|aspx|jsp|jspx|cgi|cfm|pl|sh|bash)($|\?)/i,
  /\/(wp-admin|wp-login|wp-content|wp-includes|phpmyadmin|pma|adminer|actuator|solr|cgi-bin|boaform|telescope|debugbar|vendor|telescope|swagger|setup\.cgi|HNAP1|manager\/html)/i,
  /\/(shell|cmd|eval|exec|invoker|system|passthru|powershell|bin\/sh|bin\/bash)/i
];

// Attack payloads in URL / Query params (SQLi, XSS, Command Injection)
const PAYLOAD_PATTERNS = [
  /(<script|%3Cscript)/i,
  /(union\s+select|information_schema|benchmark\(|sleep\(|waitfor\s+delay)/i,
  /(;|\||`|\$\(|\$\{)\s*(cat|ls|dir|echo|whoami|curl|wget|bash|sh|powershell|nc|python)/i
];

// Automated vulnerability scanner User-Agents
const SCANNER_UA_PATTERNS = [
  /(sqlmap|nikto|masscan|nmap|dirbuster|gobuster|wpscan|zgrab|acunetix|nessus|openvas|hydra|censys|shodan)/i
];

// Allowed HTTP methods for this application
const ALLOWED_METHODS = ['GET', 'POST', 'HEAD', 'OPTIONS'];

// In-memory rate limiting and IP banning stores
const rateLimitMap = new Map(); // ip -> { count, resetTime }
const threatStrikes = new Map(); // ip -> { strikes, lastStrike }
const bannedIps = new Map();     // ip -> banExpiryTimestamp

// Security telemetry stats
const stats = {
  totalThreatsBlocked: 0,
  totalRateLimitBlocked: 0,
  totalBannedHits: 0,
  lastThreat: null
};

// Periodic cleanup of expired rate limit and ban entries (every 2 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of rateLimitMap.entries()) {
    if (now > data.resetTime) rateLimitMap.delete(ip);
  }
  for (const [ip, data] of threatStrikes.entries()) {
    if (now - data.lastStrike > 30 * 60 * 1000) threatStrikes.delete(ip);
  }
  for (const [ip, expiry] of bannedIps.entries()) {
    if (now > expiry) bannedIps.delete(ip);
  }
}, 2 * 60 * 1000).unref();

/**
 * Extract normalized client IP from request (supporting reverse proxy trust proxy)
 */
function getClientIp(req) {
  const xForwarded = req.headers && req.headers['x-forwarded-for'];
  if (xForwarded && typeof xForwarded === 'string') {
    return xForwarded.split(',')[0].trim();
  }
  const realIp = req.headers && req.headers['x-real-ip'];
  if (realIp && typeof realIp === 'string') {
    return realIp.trim();
  }
  return (req.socket && req.socket.remoteAddress) || (req.connection && req.connection.remoteAddress) || 'unknown';
}

/**
 * Inspect an incoming request for threat signatures.
 * Returns { threat: string, details: string } if malicious, or null if clean.
 */
function inspectThreat(req) {
  const rawUrl = req.originalUrl || req.url || '';
  let decodedUrl = rawUrl;
  try {
    decodedUrl = decodeURI(rawUrl);
  } catch (e) {
    return { threat: 'Malformed URI / encoding bypass probe', details: rawUrl };
  }

  const userAgent = (req.headers && req.headers['user-agent']) || '';
  const method = (req.method || '').toUpperCase();

  // 1. Path traversal
  if (PATH_TRAVERSAL_PATTERNS.some(p => rawUrl.includes(p) || decodedUrl.includes(p))) {
    return { threat: 'Path Traversal attempt (..)', details: rawUrl };
  }

  // 2. Sensitive file/credential probing
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(decodedUrl)) {
      return { threat: `Sensitive file/path probe: ${pattern}`, details: rawUrl };
    }
  }

  // 3. Known exploit & scanner endpoints
  for (const pattern of EXPLOIT_ENDPOINTS) {
    if (pattern.test(decodedUrl)) {
      return { threat: `Exploit/scanner endpoint probe: ${pattern}`, details: rawUrl };
    }
  }

  // 4. Attack payloads in URL / Query params
  for (const pattern of PAYLOAD_PATTERNS) {
    if (pattern.test(decodedUrl)) {
      return { threat: `Malicious payload in URL: ${pattern}`, details: rawUrl };
    }
  }

  // 5. Vulnerability scanner User-Agents
  for (const pattern of SCANNER_UA_PATTERNS) {
    if (pattern.test(userAgent)) {
      return { threat: `Vulnerability scanner User-Agent: ${pattern}`, details: userAgent };
    }
  }

  // 6. Abnormal HTTP methods
  if (method && !ALLOWED_METHODS.includes(method)) {
    return { threat: `Abnormal HTTP method: ${method}`, details: method };
  }

  return null;
}

/**
 * Record threat and execute defense response
 * In public server deployment (default): returns 403 Forbidden and keeps server alive.
 */
function handleThreat(req, res, threat, source = 'HTTP') {
  const clientIp = getClientIp(req);
  const userAgent = (req.headers && req.headers['user-agent']) || 'unknown';
  const timestamp = new Date().toISOString();
  const url = req.originalUrl || req.url || 'unknown';
  const method = req.method || 'UNKNOWN';

  stats.totalThreatsBlocked++;
  stats.lastThreat = {
    timestamp,
    clientIp,
    threat: threat.threat,
    url
  };

  // Dynamic strike recording & auto-banning
  const banThreshold = Number(process.env.SECURITY_BAN_THRESHOLD) || 5;
  const banDuration = Number(process.env.SECURITY_BAN_DURATION_MS) || 15 * 60 * 1000;
  
  const currentStrikes = (threatStrikes.get(clientIp)?.strikes || 0) + 1;
  threatStrikes.set(clientIp, { strikes: currentStrikes, lastStrike: Date.now() });

  let banNote = '';
  if (currentStrikes >= banThreshold && clientIp !== '127.0.0.1' && clientIp !== '::1') {
    bannedIps.set(clientIp, Date.now() + banDuration);
    banNote = `\nIP ${clientIp} AUTO-BANNED for ${(banDuration / 60000).toFixed(0)} minutes (${currentStrikes} violations)`;
  }

  const alertMsg = [
    '',
    '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
    `[SECURITY ALERT] MALICIOUS ${source} REQUEST INTERCEPTED & BLOCKED!`,
    `Timestamp : ${timestamp}`,
    `Client IP : ${clientIp} (Strikes: ${currentStrikes}/${banThreshold})`,
    `Method    : ${method}`,
    `URL       : ${url}`,
    `Threat    : ${threat.threat}`,
    `Details   : ${threat.details}`,
    `UserAgent : ${userAgent}${banNote}`,
    'ACTION: HTTP 403 FORBIDDEN (SERVICE CONTINUES RUNNING)',
    '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!',
    ''
  ].join('\n');

  console.error(alertMsg);

  try {
    fs.appendFileSync(LOG_FILE, alertMsg + '\n', 'utf8');
  } catch (err) {}

  // Configurable action: 'exit' only if strictly configured (legacy paranoid mode)
  const action = (process.env.SECURITY_BLOCK_ACTION || 'block').toLowerCase();
  if (action === 'exit') {
    console.error('[SECURITY] Strict exit mode triggered. Terminating process.');
    process.exit(1);
  }

  // Default server mode: cleanly block with 403 Forbidden
  if (res && !res.headersSent) {
    res.status(403)
       .type('text/plain')
       .set('X-Content-Type-Options', 'nosniff')
       .send('403 Forbidden: Request blocked by security guard');
  }
}

/**
 * Sliding window IP rate limiter check.
 * Returns true if request should be allowed, false if limit exceeded.
 */
function checkRateLimit(clientIp) {
  // Localhost is exempt from rate limiting
  if (clientIp === '127.0.0.1' || clientIp === '::1' || clientIp === 'localhost') {
    return true;
  }

  const windowMs = Number(process.env.SECURITY_RATE_LIMIT_WINDOW_MS) || 60000;
  const maxRequests = Number(process.env.SECURITY_RATE_LIMIT_MAX) || 180;
  const now = Date.now();

  const record = rateLimitMap.get(clientIp);
  if (!record || now > record.resetTime) {
    rateLimitMap.set(clientIp, { count: 1, resetTime: now + windowMs });
    return true;
  }

  record.count++;
  if (record.count > maxRequests) {
    return false;
  }
  return true;
}

/**
 * Express middleware: Front-loaded traffic cleaning & protection
 */
function securityMiddleware(req, res, next) {
  const clientIp = getClientIp(req);

  // 1. Check if IP is currently banned
  const banExpiry = bannedIps.get(clientIp);
  if (banExpiry) {
    if (Date.now() < banExpiry) {
      stats.totalBannedHits++;
      res.status(403)
         .type('text/plain')
         .set('X-Content-Type-Options', 'nosniff')
         .send('403 Forbidden: IP temporarily blacklisted due to security policy');
      return;
    } else {
      bannedIps.delete(clientIp);
    }
  }

  // 2. Sliding window Rate Limiting
  if (!checkRateLimit(clientIp)) {
    stats.totalRateLimitBlocked++;
    res.status(429)
       .type('text/plain')
       .set('Retry-After', '60')
       .set('X-Content-Type-Options', 'nosniff')
       .send('429 Too Many Requests: Rate limit exceeded');
    return;
  }

  // 3. Inspect for malicious threat signatures
  const threat = inspectThreat(req);
  if (threat) {
    handleThreat(req, res, threat, 'HTTP');
    return;
  }

  // 4. Attach standard security headers to response
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // 5. Clean request -> seamlessly hand over to business logic
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    // Log non-static requests or when verbose logging is desired
    if (!req.originalUrl.startsWith('/assets') && !req.originalUrl.endsWith('.js') && !req.originalUrl.endsWith('.css')) {
      console.log(`[HTTP] ${new Date().toISOString()} ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms - ${clientIp}`);
    }
  });

  next();
}

/**
 * Socket.IO middleware for handshake threat detection
 */
function socketSecurityMiddleware(socket, next) {
  const threat = inspectThreat(socket.request);
  if (threat) {
    handleThreat(socket.request, null, threat, 'SOCKET');
    return next(new Error('Security violation: Access Denied'));
  }
  next();
}

/**
 * Backward-compatible handleMaliciousRequest interface
 */
function handleMaliciousRequest(req, threat, source = 'HTTP') {
  handleThreat(req, null, threat, source);
}

module.exports = {
  inspectThreat,
  handleThreat,
  handleMaliciousRequest,
  securityMiddleware,
  socketSecurityMiddleware,
  getClientIp,
  getStats: () => ({ ...stats, activeBannedCount: bannedIps.size }),
  resetStats: () => {
    stats.totalThreatsBlocked = 0;
    stats.totalRateLimitBlocked = 0;
    stats.totalBannedHits = 0;
    stats.lastThreat = null;
    rateLimitMap.clear();
    threatStrikes.clear();
    bannedIps.clear();
  }
};
