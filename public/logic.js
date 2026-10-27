'use strict';

// 쿼리도: 규칙과 컴퓨터만 모아 둔 파일 (그리기·입력 없음). 브라우저·서버·테스트(Node)가 같이 쓴다.
//
// - 9x9 판에서 두 사람이 말 하나씩을 움직인다. 0 번(아래쪽, 먼저)은 맨 윗줄(0 행)에, 1 번(위쪽)은 맨 아랫줄(8 행)에 먼저 닿으면 이긴다
// - 자기 차례에는 둘 중 하나: ① 말을 한 칸 (위·아래·왼쪽·오른쪽) 옮긴다 ② 벽(두 칸 길이)을 하나 놓아 상대 길을 막는다. 벽은 사람마다 10개
// - 상대 말이 바로 앞에 있으면 **뛰어넘을** 수 있다. 뛰어넘을 자리 뒤가 벽이나 판 끝이면 대각선으로 비껴 간다
// - 벽은 서로 겹치거나 십자로 엇갈리게 놓을 수 없고, **누구의 길도 완전히 막아서는 안 된다** (어떻게든 도착할 길은 남아 있어야 한다)
// - 칸 번호는 (행 r, 열 c) 0~8, 왼쪽 위가 (0,0). 벽은 놓는 곳의 기준 칸 (r,c) 0~7 과 방향으로 말한다
//   'h' (가로 벽): r 행과 r+1 행 사이 줄을 c 열과 c+1 열 두 칸 폭으로 막는다 / 'v' (세로 벽): c 열과 c+1 열 사이 줄을 r 행과 r+1 행 두 칸 높이로 막는다
const LOGIC_QUORIDOR = (() => {
const N = 9, WALLS = 10;
const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];                 // 위 · 아래 · 왼쪽 · 오른쪽

function rng(seed) {                                              // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function newGame() {
  return { pawn: [{ r: 8, c: 4 }, { r: 0, c: 4 }], walls: [WALLS, WALLS], h: new Uint8Array(64), v: new Uint8Array(64), turn: 0, winner: -1, plies: 0, last: null };
}
const clone = (st) => ({ pawn: st.pawn.map((p) => ({ ...p })), walls: st.walls.slice(), h: Uint8Array.from(st.h), v: Uint8Array.from(st.v), turn: st.turn, winner: st.winner, plies: st.plies, last: st.last });
const goalRow = (who) => (who === 0 ? 0 : 8);
const inside = (r, c) => r >= 0 && c >= 0 && r < N && c < N;
const hw = (st, r, c) => r >= 0 && c >= 0 && r < 8 && c < 8 && st.h[r * 8 + c] === 1;
const vw = (st, r, c) => r >= 0 && c >= 0 && r < 8 && c < 8 && st.v[r * 8 + c] === 1;

// 벽 때문에 (r,c) 에서 방향 d(0 위 1 아래 2 왼 3 오른)로 못 가는가 (판 끝은 따로 본다)
function blocked(st, r, c, d) {
  if (d === 0) return hw(st, r - 1, c) || hw(st, r - 1, c - 1);
  if (d === 1) return hw(st, r, c) || hw(st, r, c - 1);
  if (d === 2) return vw(st, r, c - 1) || vw(st, r - 1, c - 1);
  return vw(st, r, c) || vw(st, r - 1, c);
}
const canStep = (st, r, c, d) => inside(r + DIRS[d][0], c + DIRS[d][1]) && !blocked(st, r, c, d);

// 말이 갈 수 있는 칸들 (상대 말 뛰어넘기 포함)
function pawnMoves(st, who = st.turn) {
  const me = st.pawn[who], op = st.pawn[1 - who], out = [];
  for (let d = 0; d < 4; d++) {
    if (!canStep(st, me.r, me.c, d)) continue;
    const nr = me.r + DIRS[d][0], nc = me.c + DIRS[d][1];
    if (nr !== op.r || nc !== op.c) { out.push({ r: nr, c: nc }); continue; }
    if (canStep(st, nr, nc, d)) { out.push({ r: nr + DIRS[d][0], c: nc + DIRS[d][1] }); continue; }       // 바로 뒤로 뛰어넘기
    for (const sd of d < 2 ? [2, 3] : [0, 1]) if (canStep(st, nr, nc, sd)) out.push({ r: nr + DIRS[sd][0], c: nc + DIRS[sd][1] });   // 뒤가 막히면 대각선
  }
  return out;
}

// 상대 말을 무시하고 목표 줄까지 가장 짧은 걸음 수 (길이 없으면 Infinity)
function dist(st, who) {
  const g = goalRow(who);
  const seen = new Uint8Array(81), q = [st.pawn[who].r * 9 + st.pawn[who].c];
  seen[q[0]] = 1;
  let layer = q, d = 0;
  while (layer.length) {
    const next = [];
    for (const k of layer) {
      const r = (k / 9) | 0, c = k % 9;
      if (r === g) return d;
      for (let dd = 0; dd < 4; dd++) {
        if (!canStep(st, r, c, dd)) continue;
        const nk = (r + DIRS[dd][0]) * 9 + c + DIRS[dd][1];
        if (!seen[nk]) { seen[nk] = 1; next.push(nk); }
      }
    }
    layer = next; d++;
  }
  return Infinity;
}
// 한 사람의 가장 짧은 길 하나 (칸 번호 r*9+c 의 줄, 시작 칸 포함)
function path(st, who) {
  const g = goalRow(who), start = st.pawn[who].r * 9 + st.pawn[who].c;
  const prev = new Int16Array(81).fill(-1); prev[start] = start;
  let layer = [start];
  while (layer.length) {
    const next = [];
    for (const k of layer) {
      const r = (k / 9) | 0, c = k % 9;
      if (r === g) { const out = [k]; let x = k; while (x !== start) { x = prev[x]; out.push(x); } return out.reverse(); }
      for (let dd = 0; dd < 4; dd++) {
        if (!canStep(st, r, c, dd)) continue;
        const nk = (r + DIRS[dd][0]) * 9 + c + DIRS[dd][1];
        if (prev[nk] < 0) { prev[nk] = k; next.push(nk); }
      }
    }
    layer = next;
  }
  return null;
}

// 벽 (o, r, c) 를 놓을 수 있는가: 판 안, 겹치거나 엇갈리지 않음, 두 사람 모두 길이 남음 (누구 차례인지·벽이 남았는지는 보지 않는다)
function wallFits(st, o, r, c) {
  if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r > 7 || c > 7) return false;
  const k = r * 8 + c;
  if (st.h[k] || st.v[k]) return false;                         // 같은 자리, 또는 같은 가운데에서 십자로 엇갈림
  if (o === 'h') { if (hw(st, r, c - 1) || hw(st, r, c + 1)) return false; }
  else if (o === 'v') { if (vw(st, r - 1, c) || vw(st, r + 1, c)) return false; }
  else return false;
  (o === 'h' ? st.h : st.v)[k] = 1;
  const ok = dist(st, 0) < Infinity && dist(st, 1) < Infinity;
  (o === 'h' ? st.h : st.v)[k] = 0;
  return ok;
}
const canWall = (st, o, r, c) => st.winner < 0 && st.walls[st.turn] > 0 && wallFits(st, o, r, c);

function movePawn(st, r, c) {
  if (st.winner >= 0 || !Number.isInteger(r) || !Number.isInteger(c)) return null;
  if (!pawnMoves(st).some((m) => m.r === r && m.c === c)) return null;
  const who = st.turn, from = { ...st.pawn[who] };
  st.pawn[who] = { r, c };
  st.plies++;
  st.last = { type: 'move', who, from, to: { r, c } };
  if (r === goalRow(who)) st.winner = who; else st.turn = 1 - who;
  return { ...st.last, over: st.winner >= 0, winner: st.winner };
}
function placeWall(st, o, r, c) {
  if (!canWall(st, o, r, c)) return null;
  const who = st.turn;
  (o === 'h' ? st.h : st.v)[r * 8 + c] = 1;
  st.walls[who]--;
  st.plies++;
  st.turn = 1 - who;
  st.last = { type: 'wall', who, o, r, c };
  return { ...st.last, over: false, winner: -1 };
}

// ---------- 컴퓨터 ----------
const INF = 1e6;
function evaluate(st, me) {                                      // me 쪽에서 본 점수
  if (st.winner >= 0) return st.winner === me ? INF : -INF;
  const dm = dist(st, me), dop = dist(st, 1 - me);
  return (dop - dm) * 10 + (st.walls[me] - st.walls[1 - me]) * 1.5 + (st.turn === me ? 1 : -1);
}
// 후보 수: 말 이동 전부 + 상대 가장 짧은 길을 막는 벽들 (+ 쉬움이 아닐 땐 내 앞길을 지키는 벽은 보지 않는다)
function candidates(st, wallLimit, rand) {
  const out = pawnMoves(st).map((m) => ({ type: 'move', r: m.r, c: m.c }));
  const who = st.turn;
  if (st.walls[who] > 0) {
    const opp = 1 - who, p = path(st, opp);
    const seen = new Set();
    const add = (o, r, c) => { const key = `${o}${r}${c}`; if (!seen.has(key) && wallFits(st, o, r, c)) { seen.add(key); out.push({ type: 'wall', o, r, c }); } };
    if (p) for (let i = 0; i + 1 < p.length; i++) {
      const r = (p[i] / 9) | 0, c = p[i] % 9, nr = (p[i + 1] / 9) | 0, nc = p[i + 1] % 9;
      if (nr !== r) { const top = Math.min(r, nr); add('h', top, c); add('h', top, c - 1); }      // 위·아래로 가는 길은 가로 벽으로
      else { const left = Math.min(c, nc); add('v', r, left); add('v', r - 1, left); }            // 옆으로 가는 길은 세로 벽으로
    }
  }
  return out;
}
function applyCand(st, m) { return m.type === 'move' ? movePawn(st, m.r, m.c) : placeWall(st, m.o, m.r, m.c); }
// 상대가 이 수를 둔 뒤에도 (상대 쪽 길이 얼마나 길어졌나 - 내 길이 얼마나 길어졌나) 로 빠르게 매긴 점수: 가지치기용
function quickScore(st, m, me) {
  const c = clone(st);
  applyCand(c, m);
  return evaluate(c, me);
}
function minimax(st, depth, alpha, beta, me, k, ctx) {
  if (st.winner >= 0 || depth === 0) return evaluate(st, me);
  if (ctx.deadline && (++ctx.nodes & 31) === 0 && Date.now() > ctx.deadline) ctx.stop = true;
  if (ctx.stop) return 0;
  let cands = candidates(st, k);
  if (cands.length > k + 5) {                                      // 후보가 많으면 빠른 점수로 좋은 것만 남긴다
    const maximizing0 = st.turn === me;
    cands = cands.map((m) => [m, quickScore(st, m, me)]).sort((a, b) => (maximizing0 ? b[1] - a[1] : a[1] - b[1])).slice(0, k + 5).map((x) => x[0]);
  }
  const maximizing = st.turn === me;
  let best = maximizing ? -Infinity : Infinity;
  for (const m of cands) {
    const c = clone(st);
    applyCand(c, m);
    const v = minimax(c, depth - 1, alpha, beta, me, k, ctx);
    if (ctx.stop) return 0;
    if (maximizing) { if (v > best) best = v; if (v > alpha) alpha = v; } else { if (v < best) best = v; if (v < beta) beta = v; }
    if (alpha >= beta) break;
  }
  return best;
}
// level 'easy': 대체로 가장 짧은 길로 걷고 벽은 가끔만 놓는다 (실수도 한다) / 'hard': 시간(기본 600ms) 안에서 깊이를 늘려 가며(최대 2수, 사람이 이길 만하게 예전 4수에서 낮춤) 본다
// opts.depth 를 주면 시간 대신 그 깊이로 고정 (시험용)
function aiPick(st, level, rand = Math.random, opts = {}) {
  const me = st.turn;
  const moves = pawnMoves(st);
  const p = path(st, me);
  const stepTo = (() => {                                          // 내 가장 짧은 길의 다음 칸으로 가는 수 (상대 말이 막으면 갈 수 있는 칸 중 가장 목표에 가까운 곳)
    let best = null, bd = Infinity;
    for (const m of moves) {
      const c = clone(st); c.pawn[me] = { r: m.r, c: m.c };
      const d = dist(c, me);
      if (d < bd || (d === bd && rand() < 0.5)) { bd = d; best = m; }
    }
    return best;
  })();
  if (level === 'easy') {
    const myD = dist(st, me), opD = dist(st, 1 - me);
    if (st.walls[me] > 0 && opD <= myD && rand() < 0.35) {          // 상대가 앞서거나 비슷하면 가끔 벽
      const cs = candidates(st, 8).filter((m) => m.type === 'wall');
      if (cs.length) { const m = cs[Math.floor(rand() * cs.length)]; return m; }
    }
    if (rand() < 0.12) { const m = moves[Math.floor(rand() * moves.length)]; return { type: 'move', r: m.r, c: m.c }; }   // 가끔 엉뚱한 칸
    return { type: 'move', r: stepTo.r, c: stepTo.c };
  }
  const maxDepth = opts.depth || 2, budget = opts.depth ? 0 : (opts.ms || 600);
  const root = candidates(st, 10);
  let best = { type: 'move', r: stepTo.r, c: stepTo.c };
  const startAt = Date.now();
  for (let d = 1; d <= maxDepth; d++) {
    const ctx = { deadline: budget ? startAt + budget : 0, nodes: 0, stop: false };
    let bv = -Infinity, bm = null;
    for (const m of root) {
      const c = clone(st);
      applyCand(c, m);
      if (c.winner === me) return m;                                // 이기는 수는 바로
      const v = minimax(c, d - 1, -INF * 2, INF * 2, me, 5, ctx) + rand() * 0.01;
      if (ctx.stop) break;
      if (v > bv) { bv = v; bm = m; }
    }
    if (ctx.stop || !bm) break;
    best = bm;
    root.splice(root.indexOf(bm), 1); root.unshift(bm);
    if (budget && Date.now() - startAt > budget * 0.5) break;
  }
  return best;
}

return { N, WALLS, rng, newGame, clone, pawnMoves, canWall, wallFits, movePawn, placeWall, dist, path, goalRow, aiPick, blocked, canStep, evaluate };
})();
if (typeof module !== 'undefined') module.exports = LOGIC_QUORIDOR;
