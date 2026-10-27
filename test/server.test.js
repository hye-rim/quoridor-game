'use strict';

// 서버 시험: 보안·안정성 회귀 + 체커 온라인 대국 흐름
// 실행: npm test  (Node 18 이상, 별도 설치 없이 node:test)
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const { WebSocket } = require('ws');
const L = require('../public/logic.js');

// 운영체제가 지금 비어 있는 포트를 골라 준다 (고정 포트·범위 난수는 다른 서버와 겹쳐 가끔 실패한다)
const freePort = () => Number(require('child_process').execFileSync(process.execPath, ['-e', "const s = require('net').createServer().listen(0, '127.0.0.1', () => { console.log(s.address().port); s.close(); })"]));
const PORT = freePort();
const get = (p) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method: 'GET' }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
  req.on('error', reject); req.end();
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT), TURN_MS: '2500' }, stdio: 'ignore' });
child.unref();
process.on('exit', () => child.kill());
const ready = (async () => {
  for (let i = 0; i < 80; i++) { try { await get('/'); return; } catch { await sleep(100); } }
  throw new Error('server did not start');
})();

const open = () => new Promise((resolve, reject) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`);
  const c = { ws, msgs: [], room: null, queued: false, errors: [], closed: null };
  ws.on('message', (d) => {
    let m; try { m = JSON.parse(d); } catch { return; }
    c.msgs.push(m);
    if (m.t === 'room') c.room = m;
    if (m.t === 'queued') c.queued = true;
    if (m.t === 'error') c.errors.push(m.msg);
  });
  ws.on('close', (code) => { c.closed = code; });
  ws.on('error', () => {});
  ws.on('open', () => resolve(c));
  setTimeout(() => reject(new Error('websocket connect failed')), 3000);
});
const send = (c, t, p = {}) => c.ws.send(JSON.stringify({ t, ...p }));
const until = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(10); } return false; };

// 두 손님을 빠른 대전으로 맺어 준다
async function pair() {
  const a = await open(), b = await open();
  send(a, 'hello', { name: '가' }); send(b, 'hello', { name: '나' });
  send(a, 'quick'); await until(() => a.queued);
  send(b, 'quick');
  assert.ok(await until(() => a.room && b.room && a.room.state === 'playing' && b.room.state === 'playing'), 'both players enter a playing room');
  return [a, b];
}
const mover = (a, b) => (a.room.turn === a.room.you ? a : b);
const stOf = (room) => { const g = L.newGame(); g.pawn = room.pawn.map(([r, c]) => ({ r, c })); g.walls = room.wallsLeft.slice(); g.h = Uint8Array.from(room.h); g.v = Uint8Array.from(room.v); g.turn = room.turn; return g; };
const closeAll = (...cs) => cs.forEach((c) => c.ws.close());
async function oneMove(a, b) {
  const m = mover(a, b), seq = m.room.lastMove ? m.room.lastMove.seq : 0;
  const pick = L.aiPick(stOf(m.room), 'easy', Math.random);
  if (pick.type === 'move') send(m, 'move', { r: pick.r, c: pick.c }); else send(m, 'wall', { o: pick.o, r: pick.r, c: pick.c });
  await until(() => (a.room.lastMove && a.room.lastMove.seq > seq && b.room.lastMove && b.room.lastMove.seq > seq) || a.room.state === 'over', 3000);
}

test('malformed URLs get 400 and the server stays up', async () => {
  await ready;
  assert.strictEqual(await get('/%'), 400);
  assert.strictEqual(await get('/%00'), 400);
  assert.strictEqual(await get('/'), 200);
  assert.strictEqual(await get('/logic.js'), 200);
});

test('dotfiles and paths outside the public dir are not served', async () => {
  await ready;
  assert.strictEqual(await get('/.git/config'), 403);
  assert.ok([403, 404].includes(await get('/../server.js')));
});

test('oversized websocket message closes the connection (1009)', async () => {
  await ready;
  const c = await open();
  c.ws.send('x'.repeat(2 * 1024 * 1024));
  await sleep(500);
  assert.strictEqual(c.closed, 1009);
  assert.strictEqual(await get('/'), 200);
});

test('quick match starts with both pawns in place, ten walls each and the first player to move', async () => {
  await ready;
  const [a, b] = await pair();
  assert.notStrictEqual(a.room.you, b.room.you);
  assert.strictEqual(a.room.turn, 0);
  assert.deepStrictEqual(a.room.pawn, [[8, 4], [0, 4]]);
  assert.deepStrictEqual(a.room.wallsLeft, [10, 10]);
  assert.ok(a.room.h.every((x) => x === 0) && a.room.v.every((x) => x === 0));
  closeAll(a, b);
});

test('out-of-turn, illegal and garbage moves and walls are ignored', async () => {
  await ready;
  const [a, b] = await pair();
  const first = mover(a, b), second = first === a ? b : a;
  send(second, 'move', { r: 1, c: 4 });                            // 내 차례가 아님
  send(second, 'wall', { o: 'h', r: 3, c: 3 });
  for (const m of [{}, { r: 'a', c: 1 }, { r: 5, c: 4 }, { r: 7, c: 6 }, { r: -1, c: 4 }, { r: 1.5, c: 4 }, { r: null, c: null }, { r: [1], c: {} }]) send(first, 'move', m);
  for (const m of [{}, { o: 'x', r: 1, c: 1 }, { o: 'h', r: 9, c: 1 }, { o: 'v', r: -1, c: 0 }, { o: 'h', r: 1.5, c: 1 }, { o: 'h', r: null, c: 1 }]) send(first, 'wall', m);
  await sleep(300);
  assert.strictEqual(a.room.plies, 0, 'nothing was played');
  closeAll(a, b);
});

test('a legal pawn move and a wall are applied for both players', async () => {
  await ready;
  const [a, b] = await pair();
  const first = mover(a, b), second = first === a ? b : a;
  send(first, 'move', { r: 7, c: 4 });
  assert.ok(await until(() => a.room.plies === 1 && b.room.plies === 1));
  assert.deepStrictEqual(a.room.pawn[0], [7, 4]);
  assert.deepStrictEqual(a.room.lastMove, { seq: 1, type: 'move', who: first.room.you, from: [8, 4], to: [7, 4] });
  send(second, 'wall', { o: 'h', r: 5, c: 3 });
  assert.ok(await until(() => a.room.plies === 2 && b.room.plies === 2));
  assert.strictEqual(a.room.wallsLeft[1], 9);
  assert.strictEqual(a.room.h[5 * 8 + 3], 1);
  assert.strictEqual(a.room.lastMove.type, 'wall');
  assert.strictEqual(a.room.turn, 0);
  closeAll(a, b);
});

test('a wall that crosses or overlaps an existing wall is refused by the server', async () => {
  await ready;
  const [a, b] = await pair();
  const first = mover(a, b), second = first === a ? b : a;
  send(first, 'move', { r: 7, c: 4 });
  assert.ok(await until(() => a.room.plies === 1));
  send(second, 'wall', { o: 'h', r: 5, c: 3 });
  assert.ok(await until(() => a.room.plies === 2));
  send(first, 'wall', { o: 'v', r: 5, c: 3 });                       // 같은 가운데에서 십자로 엇갈림
  send(first, 'wall', { o: 'h', r: 5, c: 4 });                       // 겹침
  await sleep(300);
  assert.strictEqual(a.room.plies, 2, 'neither wall was placed');
  assert.strictEqual(a.room.wallsLeft[first.room.you], 10);
  send(first, 'wall', { o: 'v', r: 5, c: 4 });                       // 옆 줄의 세로 벽은 된다
  assert.ok(await until(() => a.room.plies === 3));
  closeAll(a, b);
});

test('two computers play a full game through the server and it ends by reaching the goal', async () => {
  await ready;
  const [a, b] = await pair();
  for (let i = 0; i < 250 && a.room.state === 'playing'; i++) await oneMove(a, b);
  assert.ok(await until(() => a.room.state === 'over' && b.room.state === 'over', 3000), 'the game ends');
  assert.strictEqual(a.room.reason, 'goal');
  assert.ok([0, 1].includes(a.room.winner));
  const w = a.room.pawn[a.room.winner];
  assert.strictEqual(w[0], a.room.winner === 0 ? 0 : 8, 'the winner stands on the far edge');
  closeAll(a, b);
});

test('resigning ends the game and rematch swaps sides', async () => {
  await ready;
  const [a, b] = await pair();
  const sideA = a.room.you;
  send(a, 'resign');
  assert.ok(await until(() => b.room.state === 'over'));
  assert.strictEqual(b.room.reason, 'resign');
  assert.strictEqual(b.room.winner, b.room.you);
  send(a, 'rematch'); send(b, 'rematch');
  assert.ok(await until(() => a.room.state === 'playing' && a.room.games === 2));
  assert.notStrictEqual(a.room.you, sideA, 'sides swap on a rematch');
  assert.deepStrictEqual(a.room.wallsLeft, [10, 10]);
  closeAll(a, b);
});

test('running out of time loses the game for the one on move', async () => {
  await ready;
  const [a, b] = await pair();
  const first = mover(a, b);
  assert.ok(await until(() => a.room.state === 'over', 5000), 'the timer fires');
  assert.strictEqual(a.room.reason, 'timeout');
  assert.strictEqual(a.room.winner, 1 - first.room.you);
  closeAll(a, b);
});

test('private rooms: create, join by code, and a third player is turned away', async () => {
  await ready;
  const a = await open(), b = await open(), c = await open();
  send(a, 'create');
  assert.ok(await until(() => a.room && a.room.code));
  assert.strictEqual(a.room.state, 'waiting');
  send(b, 'join', { code: a.room.code.toLowerCase() });
  assert.ok(await until(() => a.room.state === 'playing' && b.room && b.room.state === 'playing'));
  send(c, 'join', { code: a.room.code });
  assert.ok(await until(() => c.errors.length > 0));
  assert.match(c.errors[0], /이미 두 사람/);
  a.ws.close(); b.ws.close(); c.ws.close();
});

test('a dropped player can resume the same seat with the token', async () => {
  await ready;
  const [a, b] = await pair();
  const token = a.room.token, code = a.room.code, you = a.room.you;
  a.ws.close();
  assert.ok(await until(() => b.room.players.some((p) => !p.online)), 'the other side sees the drop');
  const a2 = await open();
  send(a2, 'resume', { code, token });
  assert.ok(await until(() => a2.room && a2.room.you === you && a2.room.state === 'playing'));
  assert.ok(await until(() => b.room.players.every((p) => p.online)));
  a2.ws.close(); b.ws.close();
});

// 같은 주소에서 코드를 일부러 많이 틀리므로 이 시험은 맨 뒤에 둔다 (뒤의 시험이 막히지 않게)
test('repeated wrong room codes get temporarily blocked', async () => {
  await ready;
  const c = await open();
  for (let i = 0; i < 10; i++) c.ws.send(JSON.stringify({ t: 'join', code: 'ZZZ' + 'ABCDEFGH'[i] }));
  await sleep(500);
  assert.ok(c.errors.some((x) => /그런 방이 없어요/.test(x)), 'first attempts are answered with room-not-found');
  assert.ok(c.errors.some((x) => /너무 많이 틀렸어요/.test(x)), 'many wrong codes get blocked');
  c.ws.close();
});

test('shutdown', () => { child.kill(); });
