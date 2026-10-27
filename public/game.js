'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (arcade/public/tutorial.js 가 듣는다. 튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 쿼리도: 화면·입력·소리·온라인. 규칙과 컴퓨터는 logic.js (LOGIC_QUORIDOR), 방·매칭은 server.js
(() => {
const L = LOGIC_QUORIDOR;
const $ = (id) => document.getElementById(id);
const COLORS = ['#ff5a4f', '#3d8bff'];                      // 0 아래쪽(먼저) · 1 위쪽
const SIDE_NAME = ['아래쪽(먼저)', '위쪽'];
const T = { cpu: 350, over: 900 };                          // 시간(ms). 시험용으로 줄일 수 있다
const GW = 0.3, PITCH = 1 + GW, UNITS = 9 + 8 * GW;           // 칸 크기 1, 칸 사이 홈 너비 0.3 (그림 단위)

// ---------- 저장소 ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};
let wins = Number(store.get('quoridorWins')) || 0;
const ONLINE_KEY = 'quoridorOnline', SESSION_KEY = 'quoridorSession';
const loadJson = (k) => { try { return JSON.parse(store.get(k)) || {}; } catch (_) { return {}; } };
function loadSession() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch (_) { return null; } }
function saveSession(s) { try { s ? sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)) : sessionStorage.removeItem(SESSION_KEY); } catch (_) {} }
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const myName = () => store.get('quoridorName') || '';

// ---------- 소리 ----------
let audio = null;
let muted = store.get('quoridorMuted') === '1';
function tone(freq, dur, type = 'sine', vol = 0.09, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination);
    o.start(t);
    o.stop(t + dur);
  } catch (_) {}
}
const seq = (notes, step, type = 'triangle', vol = 0.09) => notes.forEach((f, i) => setTimeout(() => tone(f, step * 0.0009, type, vol), i * step));
const sfx = {
  step: () => tone(380, 0.06, 'triangle', 0.09),
  jump: () => seq([380, 560], 70, 'triangle', 0.09),
  wall: () => seq([160, 120], 60, 'square', 0.07),
  bad: () => tone(150, 0.1, 'square', 0.05),
  found: () => seq([392, 523], 90, 'triangle', 0.08),
  win: () => seq([523, 659, 784, 1047], 110, 'triangle', 0.1),
  lose: () => seq([392, 330, 262, 196], 150, 'sawtooth', 0.06),
};
function toggleMute() { muted = !muted; store.set('quoridorMuted', muted ? '1' : '0'); $('muteBtn').textContent = muted ? '🔇' : '🔊'; }
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('muteBtn').textContent = muted ? '🔇' : '🔊';

// ---------- 상태 ----------
let mode = 'easy';                  // 'easy' · 'hard' (컴퓨터) · 'online'
let phase = 'title';                // title · play · over
let st = null;                      // 컴퓨터 대전 판 (나는 0번 아래쪽, 먼저)
let room = null, view = null, waitingNet = false, netDown = false, turnEnd = 0, recorded = '', seenMove = 0;
let cpuTimer = 0, overTimer = 0, thinking = false;
let tool = 'move';                  // 'move' (말 이동) · 'wall' (벽 놓기)
let ghost = null;                   // 미리 보는 벽 { o, r, c, ok }
const online = () => mode === 'online';

// 화면에 그릴 모양: { s: 판(규칙 상태), you, turn, state, winner, reason, last, names }
function model() {
  if (online()) {
    if (!room || !view) return null;
    return { s: view, you: room.you, turn: room.turn, state: room.state, winner: room.winner, reason: room.reason, last: room.lastMove,
      names: [0, 1].map((c) => (c === room.you ? '나' : ((room.players.find((p) => p.color === c) || {}).name || '상대'))) };
  }
  if (!st) return null;
  return { s: st, you: 0, turn: st.turn, state: st.winner >= 0 ? 'over' : 'playing', winner: st.winner, reason: st.winner >= 0 ? 'goal' : '', last: st.last && { type: st.last.type, who: st.last.who, from: st.last.from && [st.last.from.r, st.last.from.c], to: st.last.to && [st.last.to.r, st.last.to.c], o: st.last.o, r: st.last.r, c: st.last.c }, names: ['나', '컴퓨터'] };
}
function stateFromRoom(r) {
  const g = L.newGame();
  g.pawn = r.pawn.map(([pr, pc]) => ({ r: pr, c: pc }));
  g.walls = r.wallsLeft.slice(); g.h = Uint8Array.from(r.h); g.v = Uint8Array.from(r.v); g.turn = r.turn; g.plies = r.plies;
  g.winner = r.state === 'over' && r.reason === 'goal' ? r.winner : -1;
  return g;
}
const myTurn = (m) => !!m && m.state === 'playing' && m.turn === m.you && !netDown && !thinking;
const canAct = (m) => myTurn(m) && !waitingNet;

// ---------- 그리기 ----------
const canvas = $('board'), ctx = canvas.getContext('2d');
let cw = 0, dpr = 1;
function fit() {
  const r = canvas.getBoundingClientRect();
  dpr = Math.min(3, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(r.width * dpr));
  if (w !== canvas.width || w !== canvas.height) { canvas.width = w; canvas.height = w; }
  cw = w;
}
const flipped = () => { const m = model(); return !!m && m.you === 1; };
// 그림 단위 → 화면 픽셀 / 화면 → 그림 단위 (내가 위쪽이면 판을 180도 돌려 내 말이 늘 아래에 오게)
function pt(x, y) { const k = cw / UNITS; return flipped() ? [cw - x * k, cw - y * k] : [x * k, y * k]; }
function unpt(px, py) { const k = cw / UNITS; return flipped() ? [(cw - px) / k, (cw - py) / k] : [px / k, py / k]; }
const cellRect = (r, c) => ({ x: c * PITCH, y: r * PITCH });
function wallRect(o, r, c) {                                     // 벽이 덮는 직사각형 (그림 단위)
  return o === 'h' ? { x: c * PITCH, y: (r + 1) * PITCH - GW, w: 2 + GW, h: GW } : { x: (c + 1) * PITCH - GW, y: r * PITCH, w: GW, h: 2 + GW };
}
function rectPx(rc) { const a = pt(rc.x, rc.y), b = pt(rc.x + rc.w, rc.y + rc.h); return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) }; }
function rr(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

function draw(now = performance.now()) {
  fit();
  const m = model();
  ctx.clearRect(0, 0, cw, cw);
  const k = cw / UNITS;
  const dests = new Set();
  if (m && canAct(m) && tool === 'move') for (const d of L.pawnMoves(m.s, m.you)) dests.add(d.r * 9 + d.c);
  const last = m && m.last && m.last.who !== m.you ? m.last : null;       // 상대가 방금 한 수
  // 칸
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
    const p = rectPx({ x: c * PITCH, y: r * PITCH, w: 1, h: 1 });
    const goalMine = m && r === L.goalRow(m.you), goalOpp = m && r === L.goalRow(1 - m.you);
    ctx.fillStyle = goalMine ? '#c8f0b8' : goalOpp ? '#ffd6cf' : '#fff3d6';
    rr(p.x, p.y, p.w, p.h, 5 * dpr); ctx.fill();
    if (last && last.type === 'move' && ((last.from[0] === r && last.from[1] === c))) { ctx.strokeStyle = '#ff9f1c'; ctx.lineWidth = 3 * dpr; ctx.setLineDash([5 * dpr, 4 * dpr]); rr(p.x + 2 * dpr, p.y + 2 * dpr, p.w - 4 * dpr, p.h - 4 * dpr, 4 * dpr); ctx.stroke(); ctx.setLineDash([]); }
    if (dests.has(r * 9 + c)) { ctx.fillStyle = 'rgba(43,29,82,.45)'; ctx.beginPath(); ctx.arc(p.x + p.w / 2, p.y + p.h / 2, p.w * 0.17, 0, Math.PI * 2); ctx.fill(); }
  }
  if (!m) return;
  // 벽 (놓인 것, 상대가 방금 놓은 것은 주황, 미리 보는 것)
  const drawWall = (o, r, c, fill, glow) => {
    const p = rectPx(wallRect(o, r, c));
    if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = 8 * dpr; }
    ctx.fillStyle = fill; rr(p.x, p.y, p.w, p.h, Math.min(p.w, p.h) / 2); ctx.fill();
    ctx.shadowBlur = 0;
  };
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const isLast = last && last.type === 'wall' && last.r === r && last.c === c;
    if (m.s.h[r * 8 + c]) drawWall('h', r, c, isLast && last.o === 'h' ? '#ff9f1c' : '#5b3a1e', isLast && last.o === 'h' ? '#ffd23f' : null);
    if (m.s.v[r * 8 + c]) drawWall('v', r, c, isLast && last.o === 'v' ? '#ff9f1c' : '#5b3a1e', isLast && last.o === 'v' ? '#ffd23f' : null);
  }
  if (ghost && tool === 'wall') drawWall(ghost.o, ghost.r, ghost.c, ghost.ok ? 'rgba(255,159,28,.8)' : 'rgba(255,60,60,.55)', null);
  // 말
  for (let who = 0; who < 2; who++) {
    const pw = m.s.pawn[who];
    const p = rectPx({ x: pw.c * PITCH, y: pw.r * PITCH, w: 1, h: 1 });
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2, rad = p.w * 0.36;
    const hit = last && last.type === 'move' && last.who === who;
    ctx.fillStyle = 'rgba(43,29,82,.25)'; ctx.beginPath(); ctx.arc(cx + 1.5 * dpr, cy + 3 * dpr, rad, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = COLORS[who === m.you ? 0 : 1]; ctx.strokeStyle = '#2b1d52'; ctx.lineWidth = 3 * dpr;
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.beginPath(); ctx.arc(cx - rad * 0.3, cy - rad * 0.3, rad * 0.3, 0, Math.PI * 2); ctx.fill();
    if (hit) { ctx.strokeStyle = `rgba(255,159,28,${0.55 + 0.45 * Math.sin(now / 250)})`; ctx.lineWidth = 4 * dpr; ctx.beginPath(); ctx.arc(cx, cy, rad + 4 * dpr, 0, Math.PI * 2); ctx.stroke(); }
    if (who === m.turn && m.state === 'playing') { ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 2.5 * dpr; ctx.beginPath(); ctx.arc(cx, cy, rad + 1.5 * dpr, 0, Math.PI * 2); ctx.stroke(); }
  }
}

function renderBars(m) {
  const bar = (el, who) => {
    const d = L.dist(m.s, who);
    el.className = 'bar' + (m.state === 'playing' && m.turn === who ? ' turn' : '');
    el.innerHTML = `<span class="dot" style="--c:${COLORS[who === m.you ? 0 : 1]}"></span><span class="nm">${esc(m.names[who])}</span><span class="st">🧱 <b>${m.s.walls[who]}</b> · 목표까지 <b>${d === Infinity ? '-' : d}</b>칸</span>`;
  };
  bar($('barOp'), 1 - m.you); bar($('barMe'), m.you);
}
function render() {
  const m = model();
  if (!m) { renderHud(null); draw(); return; }
  renderBars(m);
  const mineNow = canAct(m);
  $('moveBtn').classList.toggle('on', tool === 'move');
  $('wallBtn').classList.toggle('on', tool === 'wall');
  $('wallBtn').textContent = `🧱 벽 놓기 (${m.s.walls[m.you]})`;
  $('wallBtn').disabled = !mineNow || m.s.walls[m.you] === 0;
  $('moveBtn').disabled = !mineNow;
  $('okBtn').style.display = tool === 'wall' && mineNow ? 'inline-block' : 'none';
  $('okBtn').disabled = !(ghost && ghost.ok);
  renderHud(m);
  draw();
}
function renderHud(m = model()) {
  $('wins').textContent = wins.toLocaleString('ko-KR');
  let text = '쿼리도';
  if (m && phase === 'play' && m.state === 'playing') {
    const sec = Math.max(0, Math.ceil((turnEnd - performance.now()) / 1000));
    if (online() && netDown) text = '연결 다시 붙이는 중…';
    else if (m.turn === m.you) text = `내 차례${online() ? ` · ${sec}초` : ''}`;
    else text = online() ? `${m.names[m.turn]} 차례 · ${sec}초` : '컴퓨터 생각 중…';
  }
  $('turn').textContent = text;
  $('resignBtn').style.display = online() && room && room.state === 'playing' ? '' : 'none';
}
function say(t) { $('msg').textContent = t; }

// ---------- 창 ----------
const overlayOpen = () => !$('overlay').classList.contains('hidden');
function showOverlay(html) { $('overlay').innerHTML = html; $('overlay').classList.remove('hidden'); }
function hideOverlay() { $('overlay').classList.add('hidden'); }

// ---------- 입력 ----------
function cellAt(x, y) {                                          // 그림 단위 좌표 → 칸 (홈 위를 눌러도 가까운 칸)
  const c = Math.min(8, Math.max(0, Math.floor(x / PITCH))), r = Math.min(8, Math.max(0, Math.floor(y / PITCH)));
  return { r, c };
}
function wallAt(x, y) {                                          // 누른 곳에서 가장 가까운 홈에 놓을 벽 (미리 보기)
  let bestH = { d: Infinity, i: 0 }, bestV = { d: Infinity, i: 0 };
  for (let i = 0; i < 8; i++) {
    const hy = (i + 1) * PITCH - GW / 2, vx = (i + 1) * PITCH - GW / 2;
    if (Math.abs(y - hy) < bestH.d) bestH = { d: Math.abs(y - hy), i };
    if (Math.abs(x - vx) < bestV.d) bestV = { d: Math.abs(x - vx), i };
  }
  const clamp = (v) => Math.min(7, Math.max(0, v));
  if (bestH.d <= bestV.d) return { o: 'h', r: bestH.i, c: clamp(Math.round((x + GW / 2) / PITCH - 1)) };
  return { o: 'v', r: clamp(Math.round((y + GW / 2) / PITCH - 1)), c: bestV.i };
}
function onPointer(e) {
  const m = model();
  if (!canAct(m)) return;
  const rect = canvas.getBoundingClientRect();
  const [x, y] = unpt((e.clientX - rect.left) / rect.width * cw, (e.clientY - rect.top) / rect.height * cw);
  if (tool === 'wall') {
    const w = wallAt(x, y);
    ghost = { ...w, ok: L.canWall(m.s, w.o, w.r, w.c) };
    render();
    return;
  }
  const { r, c } = cellAt(x, y);
  if (!L.pawnMoves(m.s, m.you).some((d) => d.r === r && d.c === c)) { if (e.type === 'pointerdown') sfx.bad(); return; }
  doMove(r, c);
}
canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); onPointer(e); });
canvas.addEventListener('pointermove', (e) => { if (tool === 'wall' && (e.buttons || e.pointerType === 'mouse')) onPointer(e); });
$('moveBtn').onclick = (e) => { e.currentTarget.blur(); tool = 'move'; ghost = null; render(); };
$('wallBtn').onclick = (e) => { e.currentTarget.blur(); tool = 'wall'; ghost = null; render(); say('벽을 놓을 곳을 눌러요 (홈 쪽으로 붙어요). 맞으면 ✔ 놓기!'); };
$('okBtn').onclick = (e) => { e.currentTarget.blur(); if (ghost && ghost.ok) doWall(ghost.o, ghost.r, ghost.c); };
addEventListener('keydown', (e) => { if (e.target.tagName !== 'INPUT' && e.code === 'KeyM') toggleMute(); });

function doMove(r, c) {
  if (online()) { waitingNet = true; net.send('move', { r, c }); render(); return; }
  const res = L.movePawn(st, r, c);
  if (!res) return;
  announce(res.who, { type: 'move', jump: Math.abs(res.to.r - res.from.r) + Math.abs(res.to.c - res.from.c) > 1 });
  tutorialSignal('move');
  afterMine(res);
}
function doWall(o, r, c) {
  if (online()) { waitingNet = true; net.send('wall', { o, r, c }); ghost = null; tool = 'move'; render(); return; }
  const res = L.placeWall(st, o, r, c);
  if (!res) return;
  announce(res.who, { type: 'wall' });
  tutorialSignal('wall');
  ghost = null; tool = 'move';
  afterMine(res);
}
function announce(who, ev) {
  const m = model();
  const mine = who === m.you;
  if (ev.type === 'wall') { sfx.wall(); say(`${mine ? '내가' : '상대가'} 벽을 놓았어요`); }
  else if (ev.jump) { sfx.jump(); say(`${mine ? '내가' : '상대가'} 뛰어넘었어요`); }
  else { sfx.step(); say(''); }
}
function afterMine(res) {
  render();
  if (res.over) { overTimer = setTimeout(showOver, T.over); return; }
  scheduleCpu();
}

// ---------- 컴퓨터 대전 ----------
function startCpu(level) {
  leaveOnline();
  clearTimeout(cpuTimer); clearTimeout(overTimer);
  mode = level; st = L.newGame(); phase = 'play'; tool = 'move'; ghost = null; thinking = false; turnEnd = 0;
  hideOverlay(); render();
  say('내 말(빨강)을 맨 위 줄까지 먼저 보내요!\n점을 누르면 한 칸 이동, 🧱 로 벽을 놓아 상대를 막아요');
}
function scheduleCpu() { thinking = true; render(); cpuTimer = setTimeout(cpuTurn, T.cpu); }
function cpuTurn() {
  if (phase !== 'play' || !st || online() || st.winner >= 0 || st.turn !== 1) { thinking = false; return; }
  const mv = L.aiPick(st, mode === 'hard' ? 'hard' : 'easy');
  thinking = false;
  const res = mv.type === 'move' ? L.movePawn(st, mv.r, mv.c) : L.placeWall(st, mv.o, mv.r, mv.c);
  if (!res) { render(); return; }
  announce(res.who, { type: res.type, jump: res.type === 'move' && Math.abs(res.to.r - res.from.r) + Math.abs(res.to.c - res.from.c) > 1 });
  render();
  if (res.over) overTimer = setTimeout(showOver, T.over);
}
function showOver() {
  phase = 'over';
  const youWon = st.winner === 0;
  if (youWon) { wins++; store.set('quoridorWins', String(wins)); sfx.win(); } else sfx.lose();
  showOverlay(`
    <h2>${youWon ? '이겼어요! 🎉' : '아쉬워요! 😵'}</h2>
    <p>${youWon ? '내 말이 먼저 반대편에 닿았어요!' : '상대 말이 먼저 반대편에 닿았어요'}</p>
    <dl class="stats card2"><dt>둔 수</dt><dd>${st.plies}수</dd><dt>남은 벽</dt><dd>나 ${st.walls[0]}개 · 컴퓨터 ${st.walls[1]}개</dd></dl>
    <p>컴퓨터 상대 승리 <b>${wins}</b>번</p>
    <div class="col"><button data-act="again">다시 하기</button><button class="sub" data-act="home">처음으로</button></div>`);
  render();
}
function showTitle() {
  leaveOnline();
  clearTimeout(cpuTimer); clearTimeout(overTimer);
  mode = 'easy'; phase = 'title'; st = L.newGame(); tool = 'move'; ghost = null; thinking = false;
  say(''); render();
  const on = loadJson(ONLINE_KEY);
  showOverlay(`
    <h1>쿼리도</h1>
    <p>내 말을 <b>반대편 줄</b>에 먼저 보내요!</p>
    <div class="card2" style="font-size:13px">내 차례에 <b>한 칸 이동</b> 아니면 <b>벽 놓기</b><br>벽으로 상대 길을 막아 늦출 수 있어요 (벽은 10개)<br>상대 말이 앞에 있으면 <b>뛰어넘어요</b><br>단, 길을 <b>완전히 막는 벽</b>은 놓을 수 없어요</div>
    <div class="col"><button data-act="cpu" data-lv="easy">🤖 컴퓨터랑 · 쉬움</button><button class="sub" data-act="cpu" data-lv="hard">🤖 컴퓨터랑 · 어려움</button><button class="sub" data-act="online">🌐 온라인 대전${on.w || on.l ? ` · ${on.w || 0}승 ${on.l || 0}패` : ''}</button></div>`);
}

// ---------- 온라인: 연결 ----------
const net = {
  ws: null, pulse: null, outbox: [], retry: 0,
  connect() {
    if (this.ws && this.ws.readyState <= 1) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}${location.pathname}`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.raw('hello', { name: myName() });
      const s = loadSession();
      if (s) this.raw('resume', s);
      for (const [t, p] of this.outbox.splice(0)) this.raw(t, p);
      clearInterval(this.pulse);
      this.pulse = setInterval(() => this.raw('pulse'), 10000);
    };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (_) { return; } onNet(m); };
    ws.onclose = () => {
      clearInterval(this.pulse);
      if (this.ws !== ws) return;
      this.ws = null;
      if (!online()) return;
      if (room || loadSession()) {
        netDown = true; waitingNet = false; render();
        setTimeout(() => { if (online()) this.connect(); }, Math.min(4000, 500 * 2 ** this.retry++));
      } else showOnline('서버와 연결이 끊겼어요. 다시 시도해 주세요.');
    };
  },
  send(t, p = {}) {
    if (this.ws && this.ws.readyState === 1) this.raw(t, p);
    else { this.outbox.push([t, p]); this.connect(); }
  },
  raw(t, p = {}) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t, ...p })); },
  close() {
    const ws = this.ws;
    this.ws = null; this.outbox = [];
    clearInterval(this.pulse);
    if (ws) ws.close();
  },
};

function onNet(m) {
  if (m.t === 'queued') showQueued();
  else if (m.t === 'room') applyRoom(m);
  else if (m.t === 'error') { room = null; saveSession(null); showOnline(m.msg); }
  else if (m.t === 'resumeFailed') {
    saveSession(null);
    if (room) { room = null; showOnline('대국이 끝나서 이어갈 수 없어요.'); }
    netDown = false; render();
  }
}

function leaveOnline() {
  if (!online()) return;
  net.send('leave'); net.close();
  saveSession(null);
  room = null; view = null; netDown = false; waitingNet = false; mode = 'easy'; phase = 'title';
}

// ---------- 온라인: 대국 ----------
function applyRoom(r) {
  const fresh = !room || room.code !== r.code;
  const newGame = fresh || room.games !== r.games;
  room = r;
  view = stateFromRoom(r);
  netDown = false; waitingNet = false;
  saveSession({ code: r.code, token: r.token });
  turnEnd = performance.now() + r.remain;
  ghost = null; tool = 'move';
  if (newGame) { seenMove = r.lastMove ? r.lastMove.seq : 0; say(''); }
  if (r.state === 'waiting') { phase = 'title'; showWaiting(); render(); return; }
  phase = r.state === 'playing' ? 'play' : 'over';
  if (newGame && r.state === 'playing') { sfx.found(); say(r.turn === r.you ? '내가 먼저예요! 내 말(빨강)을 반대편까지 보내요' : '상대가 먼저 둬요'); }
  if (!($('overlay').dataset.screen === 'confirm') && r.state !== 'over') hideOverlay();
  const lm = r.lastMove;
  if (lm && lm.seq > seenMove && !newGame) {
    seenMove = lm.seq;
    announce(lm.who, { type: lm.type, jump: lm.type === 'move' && Math.abs(lm.to[0] - lm.from[0]) + Math.abs(lm.to[1] - lm.from[1]) > 1 });
    if (lm.who === r.you) tutorialSignal(lm.type === 'wall' ? 'wall' : 'move');
  }
  render();
  if (r.state === 'over') afterOver();
}
function afterOver() {
  const r = room;
  const key = `${r.code}:${r.games}:${r.reason}:${r.winner}`;
  if (recorded !== key) {
    recorded = key;
    const rec = loadJson(ONLINE_KEY);
    if (r.winner === r.you) { rec.w = (rec.w || 0) + 1; sfx.win(); } else { rec.l = (rec.l || 0) + 1; sfx.lose(); }
    store.set(ONLINE_KEY, JSON.stringify(rec));
    setTimeout(() => { if (room && room.state === 'over') showResult(); }, T.over);
  } else if (overlayOpen()) showResult();
}

function showResult() {
  const r = room;
  const won = r.winner === r.you;
  const why = {
    goal: won ? '내 말이 먼저 반대편에 닿았어요!' : '상대 말이 먼저 반대편에 닿았어요',
    resign: won ? '상대가 기권했어요' : '기권했어요',
    timeout: won ? '상대가 시간을 넘겼어요' : '시간을 넘겼어요',
    left: won ? '상대가 나갔어요' : '연결이 끊겨 패배했어요',
  }[r.reason] || '';
  const rec = loadJson(ONLINE_KEY);
  const opp = r.players.find((p) => p.color !== r.you);
  const iVoted = r.rematch.includes(r.you), theyVoted = opp && r.rematch.includes(opp.color);
  let again;
  if (!opp) again = '<p>상대가 방을 나갔어요</p>';
  else if (iVoted) again = '<p>상대를 기다리는 중…</p>';
  else again = `${theyVoted ? '<p>상대가 한 판 더 하고 싶어해요!</p>' : ''}<button data-act="rematch">한 판 더</button>`;
  showOverlay(`
    <h2>${won ? '🎉 승리!' : '😵 패배'}</h2>
    ${why ? `<p>${esc(why)}</p>` : ''}
    <span class="tag">온라인 ${rec.w || 0}승 ${rec.l || 0}패</span>
    <div class="col">${again}
      <div class="row"><button class="sub" data-act="view">판 보기</button><button class="sub" data-act="leave">나가기</button></div>
    </div>`);
}

function showOnline(error = '') {
  leaveOnline();
  clearTimeout(cpuTimer); clearTimeout(overTimer);
  mode = 'online'; phase = 'title'; room = null; view = L.newGame(); st = null; waitingNet = false; tool = 'move'; ghost = null; thinking = false;
  say(''); render();
  showOverlay(`
    <h2>🌐 온라인 대전</h2>
    <input id="nameInput" maxlength="10" placeholder="내 이름 (최대 10자)" value="${esc(myName())}" autocomplete="off">
    <div class="col">
      <button data-act="quick">⚡ 빠른 대전</button>
      <button class="sub" data-act="create">방 만들기</button>
      <div class="row join"><input id="codeInput" maxlength="4" placeholder="방 코드" autocomplete="off" autocapitalize="characters"><button class="sub" data-act="join">들어가기</button></div>
    </div>
    <span class="error">${esc(error)}</span>
    <button class="back" data-act="home">← 처음으로</button>
    <p style="font-size:12.5px">한 수에 60초 · 아래쪽(먼저)과 위쪽은 한 판마다 바뀌어요</p>`);
}
function showQueued() {
  showOverlay(`
    <h2>상대를 찾는 중…</h2>
    <div class="dots"><span></span><span></span><span></span></div>
    <p>누군가 빠른 대전을 누르면 바로 시작해요</p>
    <button class="sub" data-act="cancel">취소</button>`);
}
const inviteUrl = () => `${location.origin}${location.pathname}?room=${room.code}`;
function showWaiting() {
  showOverlay(`
    <h2>친구를 기다리는 중…</h2>
    <p>방 코드</p>
    <div class="code">${esc(room.code)}</div>
    <p>친구가 <b>온라인 대전 → 들어가기</b>에<br>이 코드를 넣으면 시작해요</p>
    <button data-act="copy">🔗 초대 링크 복사</button>
    <button class="sub" data-act="cancel">취소</button>`);
}
function saveName() {
  const input = $('nameInput');
  if (!input) return;
  const name = input.value.trim().slice(0, 10);
  store.set('quoridorName', name);
  net.send('hello', { name });
}
function confirmResign() {
  showOverlay(`<h2>기권할까요?</h2><p>이번 판은 패배로 기록돼요</p>
    <div class="row"><button data-act="close">계속하기</button><button class="sub" data-act="resign">🏳 기권</button></div>`);
  $('overlay').dataset.screen = 'confirm';
}

let lastCpu = 'easy';
$('overlay').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  btn.blur();
  $('overlay').dataset.screen = '';
  const act = btn.dataset.act;
  if (act === 'cpu') { lastCpu = btn.dataset.lv; startCpu(lastCpu); }
  else if (act === 'again') startCpu(lastCpu);
  else if (act === 'home') showTitle();
  else if (act === 'online') showOnline();
  else if (act === 'quick') { saveName(); net.send('quick'); }
  else if (act === 'create') { saveName(); net.send('create'); }
  else if (act === 'join') {
    const code = ($('codeInput').value || '').trim().toUpperCase();
    if (code.length !== 4) { $('overlay').querySelector('.error').textContent = '방 코드 4자리를 넣어 주세요.'; return; }
    saveName();
    net.send('join', { code });
  } else if (act === 'cancel') { net.send('cancel'); showOnline(); }
  else if (act === 'copy') {
    const url = inviteUrl();
    const done = () => { btn.textContent = '✅ 복사했어요'; setTimeout(() => { btn.textContent = '🔗 초대 링크 복사'; }, 1500); };
    if (navigator.share && matchMedia('(pointer: coarse)').matches) navigator.share({ title: '쿼리도 한 판 해요!', url }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => prompt('링크를 복사하세요', url));
    else prompt('링크를 복사하세요', url);
  } else if (act === 'rematch') { net.send('rematch'); }
  else if (act === 'view') hideOverlay();
  else if (act === 'leave') showOnline();
  else if (act === 'resign') { net.send('resign'); hideOverlay(); }
  else if (act === 'close') hideOverlay();
});
$('overlay').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'codeInput') $('overlay').querySelector('[data-act="join"]').click();
  if (e.target.id === 'nameInput') $('overlay').querySelector('[data-act="quick"]').click();
  e.stopPropagation();
});
$('resignBtn').onclick = (e) => { e.currentTarget.blur(); if (online() && room && room.state === 'playing') confirmResign(); };
setInterval(() => { if (online() && room && room.state === 'playing' && !netDown) renderHud(); }, 500);
addEventListener('resize', () => render());
(function loop() { requestAnimationFrame(loop); if (phase === 'play') { const m = model(); if (m && m.last && m.last.who !== m.you && m.last.type === 'move') draw(); } })();

// ---------- 시작 ----------
const invite = new URLSearchParams(location.search).get('room');
if (invite) { try { window.history.replaceState(null, '', location.pathname); } catch (_) {} }
function joinInvite(code) { showOnline(); net.send('join', { code: code.toUpperCase() }); }
if (loadSession()) {
  mode = 'online';
  view = L.newGame(); render();
  showOverlay('<h2>대국으로 돌아가는 중…</h2>');
  net.connect();
  const until = setInterval(() => {
    if (room || !loadSession()) { clearInterval(until); if (!room) invite ? joinInvite(invite) : showOnline(); }
  }, 100);
} else if (invite) joinInvite(invite);
else showTitle();

/* @test-hooks:start */
window.__qd = { get st() { return st; }, get mode() { return mode; }, get phase() { return phase; }, get room() { return room; }, get tool() { return tool; }, get ghost() { return ghost; }, T, doMove, doWall, startCpu, render, draw, wallAt, cellAt, unpt, pt, get thinking() { return thinking; } };
/* @test-hooks:end */
})();
