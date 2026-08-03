import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const port = Number(process.env.PORT || 8787);
const mediaRoot = path.resolve(process.env.MEDIA_ROOT || './media');
const publicBaseUrl = (process.env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/$/, '');
const approvalBaseUrl = (process.env.APPROVAL_BASE_URL || publicBaseUrl).replace(/\/$/, '');
const pairingSecret = process.env.PAIRING_SECRET;
const demoStreamUrl = process.env.DEMO_STREAM_URL;
if (!pairingSecret) throw new Error('PAIRING_SECRET is required');

const sessions = new Map();
const tokens = new Map();
const videos = () => [
  ...(fs.existsSync(mediaRoot) ? fs.readdirSync(mediaRoot, { recursive: true })
  .filter(file => /\.(mkv|mp4|webm|m4v)$/i.test(file))
  .map(file => ({ id: Buffer.from(file).toString('base64url'), title: path.basename(file, path.extname(file)), type: 'video', description: file })) : []),
  ...(demoStreamUrl ? [{ id: 'demo-stream', title: 'Connector playback test', type: 'video', description: 'Staging test stream' }] : []),
];
const json = (res, code, value) => { const body = JSON.stringify(value); console.log(`${code} ${body}`); res.writeHead(code, { 'content-type': 'application/json' }); res.end(body); };
const readJson = req => new Promise((resolve, reject) => { let raw = ''; req.on('data', d => raw += d); req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { reject(new Error('Invalid JSON')); } }); });
const bearer = req => req.headers.authorization?.replace(/^Bearer\s+/i, '');
const authenticated = req => tokens.has(bearer(req));
const id = () => crypto.randomBytes(24).toString('base64url');

http.createServer(async (req, res) => {
  const url = new URL(req.url, publicBaseUrl);
  console.log(`${req.method} ${url.pathname}`);
  if (req.method === 'GET' && url.pathname === '/.well-known/cleanstream-connector.json') return json(res, 200, {
    protocolVersion: 1, id: 'reference.home-library', name: 'Reference Home Library', capabilities: ['catalog', 'stream'],
    endpoints: { catalog: '/v1/catalog', stream: '/v1/stream', pairStart: '/v1/pair/start', pairStatus: '/v1/pair/{sessionId}', pairToken: '/v1/pair/token' }
  });
  if (req.method === 'POST' && url.pathname === '/v1/pair/start') {
    const body = await readJson(req); if (body.codeChallengeMethod !== 'S256' || !body.codeChallenge) return json(res, 400, { error: 'PKCE S256 required' });
    const sessionId = id(); sessions.set(sessionId, { challenge: body.codeChallenge, expires: Date.now() + 300000 });
    return json(res, 200, { sessionId, approvalUri: `${approvalBaseUrl}/pair/approve?session=${sessionId}`, expiresAt: new Date(Date.now() + 300000).toISOString(), pollIntervalSeconds: 2 });
  }
  if (req.method === 'GET' && url.pathname === '/pair/approve') return res.end('<form method="post"><input name="secret" type="password" placeholder="Pairing secret"><button>Approve TV</button></form>');
  if (req.method === 'POST' && url.pathname === '/pair/approve') { let raw=''; req.on('data', d => raw += d); req.on('end', () => { const session=sessions.get(url.searchParams.get('session')); if (!session || new URLSearchParams(raw).get('secret') !== pairingSecret) { res.statusCode=403; return res.end('Denied'); } session.code=id(); res.end('Approved. Return to your TV.'); }); return; }
  if (req.method === 'GET' && url.pathname.startsWith('/v1/pair/')) { const session=sessions.get(url.pathname.split('/').pop()); if (!session || session.expires < Date.now()) return json(res, 200, { status: 'expired' }); return json(res, 200, session.code ? { status: 'approved', authorizationCode: session.code } : { status: 'pending' }); }
  if (req.method === 'POST' && url.pathname === '/v1/pair/token') { const body=await readJson(req), session=sessions.get(body.sessionId); const challenge=crypto.createHash('sha256').update(body.codeVerifier || '').digest('base64url'); if (!session || session.code !== body.authorizationCode || session.challenge !== challenge) return json(res, 403, { error: 'Invalid pairing exchange' }); const token=id(); tokens.set(token, Date.now()+2592000000); sessions.delete(body.sessionId); return json(res, 200, { accessToken: token, expiresAt: new Date(tokens.get(token)).toISOString(), scopes: ['catalog','stream'] }); }
  if (req.method === 'GET' && url.pathname === '/v1/catalog') return authenticated(req) ? json(res, 200, { items: videos() }) : json(res, 401, { error: 'Unauthorized' });
  if (req.method === 'POST' && url.pathname === '/v1/stream') { if (!authenticated(req)) return json(res,401,{error:'Unauthorized'}); const body=await readJson(req); if (body.id === 'demo-stream' && demoStreamUrl) return json(res,200,{streams:[{id:'demo-stream',url:demoStreamUrl,filename:'demo.m3u8',headers:{}}]}); const file=Buffer.from(body.id || '', 'base64url').toString(); if (!videos().some(v => v.id === body.id) || file.includes('..')) return json(res,404,{error:'Not found'}); return json(res,200,{streams:[{id:body.id,url:`${publicBaseUrl}/v1/media/${body.id}?token=${bearer(req)}`,filename:path.basename(file),headers:{}}]}); }
  if (req.method === 'GET' && url.pathname.startsWith('/v1/media/')) { const token=url.searchParams.get('token'); const file=Buffer.from(url.pathname.split('/').pop(), 'base64url').toString(); const target=path.resolve(mediaRoot,file); if (!tokens.has(token) || !target.startsWith(`${mediaRoot}${path.sep}`) || !fs.existsSync(target)) return json(res,404,{error:'Not found'}); res.writeHead(200,{'content-type':'application/octet-stream','content-length':fs.statSync(target).size}); return fs.createReadStream(target).pipe(res); }
  json(res, 404, { error: 'Not found' });
}).listen(port, () => console.log(`Connector listening on ${publicBaseUrl}`));
