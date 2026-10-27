'use strict';
const test = require('node:test');
const assert = require('node:assert');
const L = require('../public/logic.js');

const at = (st, a, b) => { st.pawn[0] = { r: a[0], c: a[1] }; st.pawn[1] = { r: b[0], c: b[1] }; };
const wall = (st, o, r, c) => { (o === 'h' ? st.h : st.v)[r * 8 + c] = 1; };
const dests = (st) => L.pawnMoves(st).map((m) => `${m.r},${m.c}`).sort();

test('new game: pawns on the middle of their edges, ten walls each, 8 steps to go', () => {
  const st = L.newGame();
  assert.deepStrictEqual(st.pawn, [{ r: 8, c: 4 }, { r: 0, c: 4 }]);
  assert.deepStrictEqual(st.walls, [10, 10]);
  assert.strictEqual(L.dist(st, 0), 8);
  assert.strictEqual(L.dist(st, 1), 8);
  assert.deepStrictEqual(dests(st), ['7,4', '8,3', '8,5']);
});

test('a pawn cannot leave the board or walk through a wall in any direction', () => {
  const st = L.newGame();
  at(st, [4, 4], [0, 0]);
  assert.strictEqual(L.pawnMoves(st).length, 4);
  wall(st, 'h', 3, 4);                                       // 위쪽 줄(3행과 4행 사이)의 4·5 열을 막음
  assert.ok(!dests(st).includes('3,4'));
  wall(st, 'h', 4, 3);                                       // 아래쪽 줄의 3·4 열을 막음
  assert.ok(!dests(st).includes('5,4'));
  wall(st, 'v', 4, 3);                                       // 왼쪽 줄(3열과 4열 사이)의 4·5 행을 막음
  assert.ok(!dests(st).includes('4,3'));
  wall(st, 'v', 3, 4);                                       // 오른쪽 줄(4열과 5열 사이)의 3·4 행을 막음
  assert.ok(!dests(st).includes('4,5'));
  assert.deepStrictEqual(dests(st), []);
});

test('a wall covers exactly two cells: the cell next to its end is free', () => {
  const st = L.newGame();
  at(st, [4, 6], [0, 0]);
  wall(st, 'h', 3, 4);                                       // 4·5 열만 막고 6 열은 열려 있다
  assert.ok(dests(st).includes('3,6'));
  at(st, [4, 5], [0, 0]);
  assert.ok(!dests(st).includes('3,5'));
});

test('jump straight over the opponent', () => {
  const st = L.newGame();
  at(st, [5, 4], [4, 4]);
  assert.ok(dests(st).includes('3,4'));
  assert.ok(!dests(st).includes('4,4'), 'cannot stand on the opponent');
});

test('jump diagonally when a wall is right behind the opponent', () => {
  const st = L.newGame();
  at(st, [5, 4], [4, 4]);
  wall(st, 'h', 3, 4);                                       // 상대 바로 뒤(3·4 행 사이)가 막힘
  const d = dests(st);
  assert.ok(!d.includes('3,4'));
  assert.ok(d.includes('4,3') && d.includes('4,5'));
});

test('jump diagonally when the board edge is behind the opponent', () => {
  const st = L.newGame();
  at(st, [1, 4], [0, 4]);
  st.turn = 0;
  const d = dests(st);
  assert.ok(d.includes('0,3') && d.includes('0,5'));
  assert.ok(!d.includes('-1,4'));
});

test('a diagonal jump is blocked by a wall beside the opponent', () => {
  const st = L.newGame();
  at(st, [5, 4], [4, 4]);
  wall(st, 'h', 3, 4);
  wall(st, 'v', 3, 3);                                       // 상대 왼쪽 줄(3·4 열 사이)을 3·4 행에서 막음
  const d = dests(st);
  assert.ok(!d.includes('4,3'));
  assert.ok(d.includes('4,5'));
});

test('a wall between you and the opponent stops the jump', () => {
  const st = L.newGame();
  at(st, [5, 4], [4, 4]);
  wall(st, 'h', 4, 4);                                       // 내 앞(4·5 행 사이)이 막힘
  assert.ok(!dests(st).includes('3,4') && !dests(st).includes('4,4'));
});

test('walls cannot overlap, cross or leave the board', () => {
  const st = L.newGame();
  assert.ok(L.placeWall(st, 'h', 3, 3));
  st.turn = 0;
  assert.strictEqual(L.canWall(st, 'h', 3, 3), false, 'same place');
  assert.strictEqual(L.canWall(st, 'h', 3, 4), false, 'overlap on the right half');
  assert.strictEqual(L.canWall(st, 'h', 3, 2), false, 'overlap on the left half');
  assert.strictEqual(L.canWall(st, 'v', 3, 3), false, 'cross through the middle');
  assert.strictEqual(L.canWall(st, 'h', 3, 5), true, 'next to it is fine');
  assert.strictEqual(L.canWall(st, 'v', 3, 4), true, 'a vertical wall one column over is fine');
  for (const [o, r, c] of [['h', -1, 0], ['h', 8, 0], ['v', 0, 8], ['v', 0, -1], ['h', 1.5, 2], ['x', 1, 1], ['h', NaN, 1], ['v', null, 1]]) assert.strictEqual(L.canWall(st, o, r, c), false, `${o}${r}${c}`);
});

test('placing a wall uses one of your walls and passes the turn', () => {
  const st = L.newGame();
  const r = L.placeWall(st, 'v', 4, 4);
  assert.ok(r && r.type === 'wall' && r.who === 0);
  assert.strictEqual(st.walls[0], 9);
  assert.strictEqual(st.turn, 1);
  assert.deepStrictEqual(st.last, { type: 'wall', who: 0, o: 'v', r: 4, c: 4 });
});

test('you cannot place a wall with none left', () => {
  const st = L.newGame();
  st.walls[0] = 0;
  assert.strictEqual(L.canWall(st, 'h', 2, 2), false);
  assert.strictEqual(L.placeWall(st, 'h', 2, 2), null);
});

test('a wall that closes the last way to the goal is refused', () => {
  const st = L.newGame();
  at(st, [8, 0], [0, 8]);
  assert.ok(L.placeWall(st, 'h', 7, 0));                      // (8,0)·(8,1) 의 위쪽이 막힘
  st.turn = 0;
  assert.strictEqual(L.canWall(st, 'v', 7, 1), false, 'closing the right side would trap the pawn in two cells');
  assert.strictEqual(L.placeWall(st, 'v', 7, 1), null);
  assert.ok(L.dist(st, 0) < Infinity, 'the pawn still has a way out');
  assert.strictEqual(L.canWall(st, 'v', 6, 1), true, 'a wall that leaves a detour is fine');
});

test('every legal wall placement keeps both players a path (random games)', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const st = L.newGame(), r = L.rng(seed);
    for (let i = 0; i < 80 && st.winner < 0; i++) {
      if (r() < 0.6 && st.walls[st.turn] > 0) {
        const o = r() < 0.5 ? 'h' : 'v', rr = Math.floor(r() * 8), cc = Math.floor(r() * 8);
        if (L.placeWall(st, o, rr, cc)) { assert.ok(L.dist(st, 0) < Infinity && L.dist(st, 1) < Infinity); continue; }
      }
      const ms = L.pawnMoves(st);
      assert.ok(ms.length > 0, 'a pawn can always move');
      const m = ms[Math.floor(r() * ms.length)];
      assert.ok(L.movePawn(st, m.r, m.c));
    }
  }
});

test('reaching the far edge wins and the game stops', () => {
  const st = L.newGame();
  at(st, [1, 4], [5, 2]);
  const r = L.movePawn(st, 0, 4);
  assert.deepStrictEqual([r.over, r.winner], [true, 0]);
  assert.strictEqual(st.winner, 0);
  assert.strictEqual(L.movePawn(st, 0, 3), null);
  assert.strictEqual(L.placeWall(st, 'h', 2, 2), null);
  const b = L.newGame();
  at(b, [5, 2], [7, 4]); b.turn = 1;
  assert.strictEqual(L.movePawn(b, 8, 4).winner, 1);
});

test('illegal pawn moves and garbage are refused', () => {
  const st = L.newGame();
  for (const [r, c] of [[5, 4], [8, 6], [7, 3], [-1, 4], [9, 4], [1.5, 4], [NaN, 4], [null, null]]) assert.strictEqual(L.movePawn(st, r, c), null);
  assert.strictEqual(st.plies, 0);
});

test('the computer always returns a legal move and finishes games', () => {
  for (let seed = 1; seed <= 4; seed++) {
    const st = L.newGame(), r = L.rng(seed);
    let n = 0;
    while (st.winner < 0 && n++ < 250) {
      const m = L.aiPick(st, st.turn ? 'easy' : 'hard', r, { depth: 2 });
      const ok = m.type === 'move' ? L.movePawn(st, m.r, m.c) : L.placeWall(st, m.o, m.r, m.c);
      assert.ok(ok, `legal ${JSON.stringify(m)}`);
    }
    assert.ok(st.winner >= 0, 'a winner within 250 plies');
  }
});

test('the computer wins at once when it can', () => {
  const st = L.newGame();
  at(st, [1, 4], [5, 2]);
  const m = L.aiPick(st, 'hard', L.rng(1), { depth: 2 });
  assert.deepStrictEqual([m.type, m.r], ['move', 0]);
});

test('the computer blocks when the opponent is about to win and it cannot win first', () => {
  const st = L.newGame();
  at(st, [6, 0], [7, 4]); st.turn = 0;                           // 흰(0)은 멀리 있고 검(1)이 한 걸음 남았다
  st.turn = 0;
  const m = L.aiPick(st, 'hard', L.rng(3), { depth: 2 });
  const c = L.clone(st); (m.type === 'move' ? L.movePawn(c, m.r, m.c) : L.placeWall(c, m.o, m.r, m.c));
  assert.ok(c.winner !== 1, 'it did not just let the other side win next move');
  assert.ok(L.dist(c, 1) > 1 || m.type === 'wall', 'the opponent is no longer one step away');
});

test('hard beats easy in a fixed series', () => {
  let hard = 0, easy = 0;
  for (let s = 1; s <= 6; s++) {
    const st = L.newGame(), r = L.rng(s + 20), hardSide = s % 2;
    let n = 0;
    while (st.winner < 0 && n++ < 300) {
      const m = L.aiPick(st, st.turn === hardSide ? 'hard' : 'easy', r, st.turn === hardSide ? { depth: 2 } : {});
      m.type === 'move' ? L.movePawn(st, m.r, m.c) : L.placeWall(st, m.o, m.r, m.c);
    }
    if (st.winner === hardSide) hard++; else if (st.winner === 1 - hardSide) easy++;
  }
  assert.ok(hard >= easy + 2, `hard ${hard} easy ${easy}`);
});

test('same seed gives the same game', () => {
  const play = () => {
    const st = L.newGame(), r = L.rng(11);
    for (let i = 0; i < 60 && st.winner < 0; i++) { const m = L.aiPick(st, 'easy', r); m.type === 'move' ? L.movePawn(st, m.r, m.c) : L.placeWall(st, m.o, m.r, m.c); }
    return JSON.stringify([st.pawn, st.walls, Array.from(st.h), Array.from(st.v), st.winner]);
  };
  assert.strictEqual(play(), play());
});
