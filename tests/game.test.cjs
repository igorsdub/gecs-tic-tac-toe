const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const html = readFileSync(new URL('../index.html', `file://${__filename}`), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, 'index.html contains the game script');

class Element {
  constructor() {
    this.textContent = '';
    this.disabled = false;
    this.attributes = {};
    this.listeners = {};
    this.classList = {
      values: new Set(),
      add: (...names) => names.forEach(name => this.classList.values.add(name)),
      remove: (...names) => names.forEach(name => this.classList.values.delete(name)),
      toggle: (name, force) => {
        const add = force ?? !this.classList.values.has(name);
        if (add) this.classList.values.add(name);
        else this.classList.values.delete(name);
        return add;
      },
      contains: name => this.classList.values.has(name)
    };
  }

  addEventListener(type, callback) {
    (this.listeners[type] ??= []).push(callback);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  focus() {
    if (!this.disabled) document.activeElement = this;
  }

  dispatch(type, event = {}) {
    for (const callback of this.listeners[type] ?? []) callback(event);
  }

  click() {
    this.dispatch('click');
  }
}

function createGame() {
  const squares = Array.from({ length: 9 }, () => new Element());
  const elements = {
    '#status': new Element(),
    '#player-x': new Element(),
    '#player-o': new Element(),
    '#new-game': new Element()
  };
  global.document = {
    activeElement: null,
    querySelectorAll: selector => selector === '.square' ? squares : [],
    querySelector: selector => elements[selector]
  };
  vm.runInNewContext(script, { document: global.document });

  return {
    squares,
    status: elements['#status'],
    playerX: elements['#player-x'],
    playerO: elements['#player-o'],
    newGame: () => elements['#new-game'].click(),
    play: (...indices) => indices.forEach(index => squares[index].click()),
    press: (index, key) => {
      let prevented = false;
      squares[index].dispatch('keydown', { key, preventDefault: () => { prevented = true; } });
      return prevented;
    }
  };
}

function marked(game) {
  return game.squares.map(square => square.textContent);
}

function sequenceFor(line, winner) {
  const search = (board, moves, current) => {
    if (board.filter(Boolean).length >= 9) return null;
    for (let index = 0; index < 9; index += 1) {
      if (board[index]) continue;
      const next = board.slice();
      next[index] = current;
      const wonLines = [
        [0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6],
        [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]
      ].filter(candidate => candidate.every(cell => next[cell] === current));
      if (wonLines.length) {
        if (current === winner && wonLines.some(candidate => candidate.every(cell => line.includes(cell)))) return [...moves, index];
        continue;
      }
      const suffix = search(next, [...moves, index], current === 'X' ? 'O' : 'X');
      if (suffix) return suffix;
    }
    return null;
  };
  const result = search(Array(9).fill(''), [], 'X');
  assert.ok(result, `can construct a legal ${winner} win on ${line}`);
  return result;
}

test('alternates turns and rejects an occupied square', () => {
  const game = createGame();
  game.play(0, 0, 1);
  assert.deepEqual(marked(game).slice(0, 3), ['X', 'O', '']);
  assert.match(game.status.textContent, /Pink player \(X\), your turn/);
});

for (const winner of ['X', 'O']) {
  for (const [index, line] of [[0, [0, 1, 2]], [1, [3, 4, 5]], [2, [6, 7, 8]], [3, [0, 3, 6]], [4, [1, 4, 7]], [5, [2, 5, 8]], [6, [0, 4, 8]], [7, [2, 4, 6]]]) {
    test(`${winner} wins on line ${index + 1}`, () => {
      const game = createGame();
      const moves = sequenceFor(line, winner);
      game.play(...moves);
      assert.match(game.status.textContent, new RegExp(`${winner}\\) wins!`));
      assert.ok(line.every(cell => game.squares[cell].classList.contains('winner')));
      const boardAtWin = marked(game);
      const statusAtWin = game.status.textContent;
      const emptyCell = boardAtWin.findIndex(mark => !mark);
      if (emptyCell >= 0) game.play(emptyCell);
      assert.deepEqual(marked(game), boardAtWin);
      assert.equal(game.status.textContent, statusAtWin);
    });
  }
}

test('detects a draw and stops further moves', () => {
  const game = createGame();
  game.play(0, 1, 2, 4, 3, 5, 7, 6, 8);
  assert.match(game.status.textContent, /draw/i);
  assert.deepEqual(marked(game), ['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X']);
});

test('resets an unfinished game and a completed game', () => {
  const game = createGame();
  game.play(0, 1);
  game.newGame();
  assert.deepEqual(marked(game), Array(9).fill(''));
  assert.equal(game.status.textContent, 'Pink player (X), your turn.');
  assert.ok(game.squares.every(square => square.getAttribute('aria-disabled') === 'false'));
  game.play(0, 3, 1, 4, 2);
  game.newGame();
  assert.deepEqual(marked(game), Array(9).fill(''));
  assert.equal(game.squares[0].classList.contains('winner'), false);
});

test('occupied cells remain focusable and terminal cells expose disabled state', () => {
  const game = createGame();
  game.play(0);
  assert.equal(game.squares[0].disabled, false);
  assert.equal(game.squares[0].getAttribute('aria-disabled'), 'true');
  game.play(3, 1, 4, 2);
  assert.match(game.status.textContent, /wins!/);
  assert.ok(game.squares.every(square => square.getAttribute('aria-disabled') === 'true'));
  assert.ok(game.squares.every(square => square.disabled === false));
});

test('supports arrow-key movement across occupied cells', () => {
  const game = createGame();
  game.play(1);
  assert.equal(game.press(0, 'ArrowRight'), true);
  assert.equal(global.document.activeElement, game.squares[1]);
  assert.equal(game.press(1, 'ArrowDown'), true);
  assert.equal(global.document.activeElement, game.squares[4]);
});
