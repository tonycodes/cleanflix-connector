import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createLibrary } from './library.js';

const port = Number(process.env.PORT || 8787);
const mediaRoot = path.resolve(process.env.MEDIA_ROOT || './media');
const publicBaseUrl = (process.env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/$/, '');
const approvalBaseUrl = (process.env.APPROVAL_BASE_URL || publicBaseUrl).replace(/\/$/, '');
const pairingSecret = process.env.PAIRING_SECRET;
const pairingPasswordHash = process.env.PAIRING_PASSWORD_HASH;
const demoStreamUrl = process.env.DEMO_STREAM_URL;
const library = createLibrary(mediaRoot, path.resolve(process.env.LIBRARY_INDEX_PATH || './data/library-index.json'), process.env.TMDB_API_KEY);
const tokenPath = path.resolve(process.env.TOKEN_STORE_PATH || './data/tokens.json');
library.startReconciler(Number(process.env.LIBRARY_RECONCILE_SECONDS || 900));
if (!pairingSecret && !pairingPasswordHash) throw new Error('PAIRING_PASSWORD_HASH or PAIRING_SECRET is required');

const sessions = new Map();
const loadTokens = () => {
  try { return new Map(Object.entries(JSON.parse(fs.readFileSync(tokenPath, 'utf8')))); } catch { return new Map(); }
};
const tokens = loadTokens();
const saveTokens = () => {
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
  fs.writeFileSync(tokenPath, `${JSON.stringify(Object.fromEntries(tokens))}\n`, { mode: 0o600 });
};
const videos = async () => [
  ...(await library.catalog()).map(item => ({ ...item, imdbId: item.imdbId || item.suggestedImdbId, description: item.description || item.file })),
  ...(demoStreamUrl ? [{ id: 'demo-stream', title: 'Connector playback test', type: 'video', description: 'Staging test stream' }] : []),
];
// Responses can contain pairing and stream tokens; never write their bodies to logs.
const json = (res, code, value) => { const body = JSON.stringify(value); console.log(code); res.writeHead(code, { 'content-type': 'application/json' }); res.end(body); };
const readJson = req => new Promise((resolve, reject) => { let raw = ''; req.on('data', d => raw += d); req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { reject(new Error('Invalid JSON')); } }); });
const bearer = req => req.headers.authorization?.replace(/^Bearer\s+/i, '');
const authenticated = req => {
  const token = bearer(req);
  const expiresAt = Number(tokens.get(token));
  if (expiresAt > Date.now()) return true;
  if (token) { tokens.delete(token); saveTokens(); }
  return false;
};
const id = () => crypto.randomBytes(24).toString('base64url');
const passwordMatches = value => {
  if (pairingPasswordHash) {
    const [salt, expected] = pairingPasswordHash.split(':');
    if (!salt || !expected) return false;
    const actual = crypto.scryptSync(value, salt, 32).toString('base64url');
    return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
  }
  const actual = Buffer.from(value);
  const expected = Buffer.from(pairingSecret || '');
  return Boolean(pairingSecret) && actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
};
const admin = req => {
  const raw = req.headers.authorization?.replace(/^Basic\s+/i, '');
  return Boolean(raw) && passwordMatches(Buffer.from(raw, 'base64').toString().split(':').slice(1).join(':'));
};
const html = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const libraryPage = items => `<!doctype html><title>CleanStream Library</title><style>body{font:16px system-ui;max-width:1100px;margin:2rem auto}form{display:grid;grid-template-columns:2fr 2fr 1fr auto;gap:.5rem;margin:.5rem 0}input{padding:.5rem}small{grid-column:1/-1;color:#666}</style><h1>Library review</h1><p>Confirm titles and IMDb IDs. Original files are never renamed or moved.</p>${items.map(item => `<form method="post" action="/library/mapping"><input type="hidden" name="file" value="${encodeURIComponent(item.file)}"><input name="title" value="${html(item.title)}"><input name="imdbId" placeholder="tt1234567" value="${html(item.imdbId || item.suggestedImdbId || '')}"><input name="year" value="${item.year || ''}" placeholder="year"><button>Save</button><small>${html(item.file)}${item.candidate ? ` · TMDB: ${html(item.candidate.title)} (${html(item.candidate.year)})` : ''}</small></form>`).join('')}`;

http.createServer(async (req, res) => {
  const url = new URL(req.url, publicBaseUrl);
  console.log(`${req.method} ${url.pathname}`);
  if (req.method === 'GET' && url.pathname === '/library') {
    if (!admin(req)) { res.writeHead(401, { 'www-authenticate': 'Basic realm="CleanStream Library"' }); return res.end('Authentication required'); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(libraryPage(await library.scan()));
  }
  if (req.method === 'POST' && url.pathname === '/library/mapping') {
    if (!admin(req)) return json(res, 401, { error: 'Unauthorized' });
    let raw = ''; req.on('data', d => raw += d); req.on('end', () => { const body = new URLSearchParams(raw); const file = decodeURIComponent(body.get('file') || ''); if (!file || file.includes('..')) return json(res, 400, { error: 'Invalid file' }); library.saveMapping(file, { title: body.get('title') || undefined, imdbId: body.get('imdbId') || undefined, year: Number(body.get('year')) || undefined }); res.writeHead(303, { location: '/library' }); res.end(); }); return;
  }
  if (req.method === 'GET' && url.pathname === '/.well-known/cleanstream-connector.json') return json(res, 200, {
    protocolVersion: 1, id: 'reference.home-library', name: 'Reference Home Library', capabilities: ['catalog', 'metadata', 'stream'],
    endpoints: { catalog: '/v1/catalog', metadata: '/v1/metadata', stream: '/v1/stream', pairStart: '/v1/pair/start', pairStatus: '/v1/pair/{sessionId}', pairToken: '/v1/pair/token' }
  });
  if (req.method === 'POST' && url.pathname === '/v1/pair/start') {
    const body = await readJson(req); if ((body.codeChallengeMethod || 'S256') !== 'S256' || !body.codeChallenge) return json(res, 400, { error: 'PKCE S256 required' });
    const sessionId = id(); sessions.set(sessionId, { challenge: body.codeChallenge, expires: Date.now() + 300000 });
    return json(res, 200, { sessionId, approvalUri: `${approvalBaseUrl}/pair/approve?session=${sessionId}`, expiresAt: new Date(Date.now() + 300000).toISOString(), pollIntervalSeconds: 2 });
  }
  if (req.method === 'GET' && url.pathname === '/pair/approve') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end('<form method="post"><input name="secret" type="password" placeholder="Pairing secret"><button>Approve TV</button></form>'); }
  if (req.method === 'POST' && url.pathname === '/pair/approve') { let raw=''; req.on('data', d => raw += d); req.on('end', () => { const session=sessions.get(url.searchParams.get('session')); if (!session || !passwordMatches(new URLSearchParams(raw).get('secret') || '')) { res.statusCode=403; return res.end('Denied'); } session.code=id(); res.end('Approved. Return to your TV.'); }); return; }
  if (req.method === 'GET' && url.pathname.startsWith('/v1/pair/')) { const session=sessions.get(url.pathname.split('/').pop()); if (!session || session.expires < Date.now()) return json(res, 200, { status: 'expired' }); return json(res, 200, session.code ? { status: 'approved', authorizationCode: session.code } : { status: 'pending' }); }
  if (req.method === 'POST' && url.pathname === '/v1/pair/token') { const body=await readJson(req), session=sessions.get(body.sessionId); const challenge=crypto.createHash('sha256').update(body.codeVerifier || '').digest('base64url'); if (!session || session.code !== body.authorizationCode || session.challenge !== challenge) return json(res, 403, { error: 'Invalid pairing exchange' }); const token=id(); tokens.set(token, Date.now()+2592000000); saveTokens(); sessions.delete(body.sessionId); return json(res, 200, { accessToken: token, expiresAt: new Date(tokens.get(token)).toISOString(), scopes: ['catalog','stream'] }); }
  if (req.method === 'GET' && url.pathname === '/v1/catalog') return authenticated(req) ? json(res, 200, { items: await videos() }) : json(res, 401, { error: 'Unauthorized' });
  if (req.method === 'GET' && url.pathname === '/v1/metadata') {
    if (!authenticated(req)) return json(res, 401, { error: 'Unauthorized' });
    const item = await library.metadata(url.searchParams.get('id') || '');
    return item ? json(res, 200, { item: { ...item, imdbId: item.imdbId || item.suggestedImdbId, description: item.description || item.file } }) : json(res, 404, { error: 'Not found' });
  }
  if (req.method === 'POST' && url.pathname === '/v1/stream') { if (!authenticated(req)) return json(res,401,{error:'Unauthorized'}); const body=await readJson(req); if (body.id === 'demo-stream' && demoStreamUrl) return json(res,200,{streams:[{id:'demo-stream',url:demoStreamUrl,filename:'demo.m3u8',headers:{}}]}); const members=await library.members(body.id || ''); if (!members?.length || members.some(member => member.file.includes('..'))) return json(res,404,{error:'Not found'}); return json(res,200,{streams:members.map(member => ({id:member.id,url:`${publicBaseUrl}/v1/media/${member.id}?token=${bearer(req)}`,filename:path.basename(member.file),headers:{}}))}); }
  if (req.method === 'GET' && url.pathname.startsWith('/v1/media/')) { const token=url.searchParams.get('token'); const file=Buffer.from(url.pathname.split('/').pop(), 'base64url').toString(); const target=path.resolve(mediaRoot,file); if (!tokens.has(token) || !target.startsWith(`${mediaRoot}${path.sep}`) || !fs.existsSync(target)) return json(res,404,{error:'Not found'}); res.writeHead(200,{'content-type':'application/octet-stream','content-length':fs.statSync(target).size}); return fs.createReadStream(target).pipe(res); }
  json(res, 404, { error: 'Not found' });
}).listen(port, () => console.log(`Connector listening on ${publicBaseUrl}`));
