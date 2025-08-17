(() => {
  const N = 10; // 10x10 = 100 square pieces
  const board = document.getElementById('board');
  const resetBtn = document.getElementById('resetBtn');
  const previewToggle = document.getElementById('previewToggle');
  const edgeToggle = document.getElementById('edgeToggle');
  const statusEl = document.getElementById('status');
  const timerEl = document.getElementById('timer');

  board.style.setProperty('--n', String(N));

  // Create tiles once, then we swap their assigned piece via dataset + CSS vars
  const total = N * N;
  const tiles = [];
  // History stacks for Undo/Redo
  const undoStack = [];
  const redoStack = [];
  const HISTORY_LIMIT = 200;

  // ---- Timer state ----
  let timerInterval = null;
  let timerRunning = false;
  let timerStartAt = 0; // epoch ms when last started
  let timerElapsedMs = 0; // accumulated elapsed ms excluding current run segment

  // ---- Puzzle progression ----
  // 1 = sid.png, 2 = sid2.png
  let currentImage = 1;
  let unlocked2 = false;

  function formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }

  function renderTimer() {
    if (!timerEl) return;
    const now = Date.now();
    const current = timerRunning ? (timerElapsedMs + (now - timerStartAt)) : timerElapsedMs;
    timerEl.textContent = formatTime(current);
  }

  function startTimer() {
    if (timerRunning) return;
    timerRunning = true;
    timerStartAt = Date.now();
    clearInterval(timerInterval);
    timerInterval = setInterval(renderTimer, 250);
    renderTimer();
  }

  function pauseTimer() {
    if (!timerRunning) return;
    timerElapsedMs += Date.now() - timerStartAt;
    timerRunning = false;
    timerStartAt = 0;
    clearInterval(timerInterval);
    timerInterval = null;
    renderTimer();
  }

  function resetTimer(start = true) {
    clearInterval(timerInterval);
    timerInterval = null;
    timerRunning = false;
    timerStartAt = 0;
    timerElapsedMs = 0;
    if (start) startTimer(); else renderTimer();
  }

  // ---- Persistence (localStorage) ----
  const STORAGE_KEY = 'puzzle-state-v1';

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) { return null; }
  }

  function saveState() {
    try {
      const pieces = tiles.map(t => Number(t.dataset.piece));
      const state = {
        n: N,
        pieces,
        preview: !!(previewToggle && previewToggle.checked),
        edges: !!(edgeToggle && edgeToggle.checked),
        // timer persistence
        elapsedMs: timerRunning ? (timerElapsedMs + (Date.now() - timerStartAt)) : timerElapsedMs,
        running: !!timerRunning,
        startedAt: timerRunning ? timerStartAt : null,
        // progression
        image: currentImage,
        unlocked2: !!unlocked2,
        ts: Date.now(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) { /* ignore */ }
  }

  // ---- Undo/Redo helpers ----
  function getSnapshot() {
    return {
      pieces: tiles.map(t => Number(t.dataset.piece)),
      preview: !!(previewToggle && previewToggle.checked),
      edges: !!(edgeToggle && edgeToggle.checked),
      elapsedMs: timerRunning ? (timerElapsedMs + (Date.now() - timerStartAt)) : timerElapsedMs,
      running: !!timerRunning,
    };
  }

  function applySnapshot(snap) {
    if (!snap || !Array.isArray(snap.pieces) || snap.pieces.length !== total) return;
    // Apply pieces
    tiles.forEach((tile, pos) => setTilePiece(tile, snap.pieces[pos]));
    // Apply toggles
    if (previewToggle) previewToggle.checked = !!snap.preview;
    if (edgeToggle) edgeToggle.checked = !!snap.edges;
    board.classList.toggle('preview', !!snap.preview);
    board.classList.toggle('edges', !!snap.edges);
    // Apply timer
    clearInterval(timerInterval);
    timerInterval = null;
    timerElapsedMs = Math.max(0, Number(snap.elapsedMs) || 0);
    timerRunning = !!snap.running;
    if (timerRunning) {
      timerStartAt = Date.now();
      timerInterval = setInterval(renderTimer, 250);
    } else {
      timerStartAt = 0;
    }
    renderTimer();
    updateJoins();
    const solved = isSolved();
    board.classList.toggle('solved', solved);
    updateStatus(solved ? 'Solved! 🎉' : '');
    saveState();
  }

  function pushUndo(customSnap) {
    const snap = customSnap || getSnapshot();
    undoStack.push(snap);
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    // New action invalidates redo stack
    redoStack.length = 0;
  }

  function doUndo() {
    if (undoStack.length === 0) return;
    const current = getSnapshot();
    const prev = undoStack.pop();
    redoStack.push(current);
    if (redoStack.length > HISTORY_LIMIT) redoStack.shift();
    applySnapshot(prev);
    updateStatus('Undo');
    setTimeout(() => updateStatus(''), 600);
  }

  function doRedo() {
    if (redoStack.length === 0) return;
    const current = getSnapshot();
    const next = redoStack.pop();
    undoStack.push(current);
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    applySnapshot(next);
    updateStatus('Redo');
    setTimeout(() => updateStatus(''), 600);
  }

  // Utility: Fisher-Yates shuffle
  function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Create the static grid of cells. Each cell (tile) displays a piece determined by its data-piece index
  function createBoard() {
    board.innerHTML = '';
    tiles.length = 0;

    // Piece indices 0..total-1
    const pieceIndices = [...Array(total).keys()];
    let initialPieces;
    const saved = loadState();
    if (saved && saved.n === N && Array.isArray(saved.pieces) && saved.pieces.length === total) {
      // restore progression
      currentImage = Math.max(1, Math.min(2, Number(saved.image) || 1));
      unlocked2 = !!saved.unlocked2;
      initialPieces = saved.pieces.slice();
      // Restore helper toggles
      if (previewToggle) previewToggle.checked = !!saved.preview;
      if (edgeToggle) edgeToggle.checked = !!saved.edges;
      board.classList.toggle('preview', !!saved.preview);
      board.classList.toggle('edges', !!saved.edges);
      // Restore timer: if running, continue; else show saved elapsed
      const savedElapsed = Math.max(0, Number(saved.elapsedMs) || 0);
      const wasRunning = !!saved.running;
      if (wasRunning) {
        // Continue from saved elapsed without double-counting
        timerElapsedMs = savedElapsed;
        timerStartAt = Date.now();
        timerRunning = true;
        clearInterval(timerInterval);
        timerInterval = setInterval(renderTimer, 250);
      } else {
        timerRunning = false;
        timerStartAt = 0;
        timerElapsedMs = savedElapsed;
        clearInterval(timerInterval);
        timerInterval = null;
      }
      renderTimer();
    } else {
      initialPieces = shuffleUntilNotSolved(pieceIndices.slice());
      // New game -> reset and start timer
      resetTimer(true);
    }

    // Apply image class to board
    board.classList.remove('image-1', 'image-2');
    board.classList.add(currentImage === 2 ? 'image-2' : 'image-1');

    for (let pos = 0; pos < total; pos++) {
      const tile = document.createElement('div');
      tile.className = 'tile';
      tile.setAttribute('role', 'gridcell');
      tile.setAttribute('draggable', 'true');
      // Inner frame for default per-side subtle edges
      const frame = document.createElement('div');
      frame.className = 'frame';

      // Correct position for victory check
      tile.dataset.correct = String(pos);

      // Assign which piece image to show initially (shuffled)
      setTilePiece(tile, initialPieces[pos]);
      addDnDHandlers(tile);

      tile.appendChild(frame);
      board.appendChild(tile);
      tiles.push(tile);
    }

    updateJoins();
    const solved = isSolved();
    board.classList.toggle('solved', solved);
    updateStatus();
    // Save initial state so refresh persists current layout
    saveState();
  }

  function setTilePiece(tile, pieceIndex) {
    tile.dataset.piece = String(pieceIndex);
    const x = pieceIndex % N;
    const y = Math.floor(pieceIndex / N);
    tile.style.setProperty('--x', String(x));
    tile.style.setProperty('--y', String(y));
    // mark edge pieces (belonging to the outer border of the original image)
    tile.classList.toggle('edge', isEdgePiece(pieceIndex));
    const sides = edgeSides(pieceIndex);
    tile.classList.toggle('edge-top', !!sides.top);
    tile.classList.toggle('edge-right', !!sides.right);
    tile.classList.toggle('edge-bottom', !!sides.bottom);
    tile.classList.toggle('edge-left', !!sides.left);
  }

  function swapTilePieces(a, b) {
    const aPiece = Number(a.dataset.piece);
    const bPiece = Number(b.dataset.piece);
    setTilePiece(a, bPiece);
    setTilePiece(b, aPiece);
    // after any swap, recompute joins around all tiles (cheap)
    updateJoins();
  }

  function isSolved() {
    return tiles.every(t => t.dataset.piece === t.dataset.correct);
  }

  // Edge helpers
  function isEdgePiece(pieceIndex) {
    const x = pieceIndex % N;
    const y = Math.floor(pieceIndex / N);
    return x === 0 || x === N - 1 || y === 0 || y === N - 1;
  }

  function edgeSides(pieceIndex) {
    const x = pieceIndex % N;
    const y = Math.floor(pieceIndex / N);
    return {
      top: y === 0,
      right: x === N - 1,
      bottom: y === N - 1,
      left: x === 0,
    };
  }

  function updateStatus(message) {
    if (message) {
      statusEl.textContent = message;
      return;
    }
    statusEl.textContent = isSolved() ? 'Solved! 🎉' : '';
  }

  // (Shuffle Again removed per UX simplification)

  function shuffleUntilNotSolved(indices) {
    let shuffled = indices.slice();
    let attempts = 0;
    do {
      shuffleInPlace(shuffled);
      attempts++;
      // Avoid pathological cases; bail after some attempts
      if (attempts > 5) break;
    } while (shuffled.every((v, i) => v === i));
    return shuffled;
  }

  // Drag & Drop
  let dragSrc = null;

  function addDnDHandlers(tile) {
    tile.addEventListener('dragstart', onDragStart);
    tile.addEventListener('dragenter', onDragEnter);
    tile.addEventListener('dragover', onDragOver);
    tile.addEventListener('dragleave', onDragLeave);
    tile.addEventListener('drop', onDrop);
    tile.addEventListener('dragend', onDragEnd);
  }

  function onDragStart(e) {
    dragSrc = this;
    this.classList.add('dragging');
    // Firefox requires data to be set
    e.dataTransfer.setData('text/plain', this.dataset.piece || '');
    e.dataTransfer.effectAllowed = 'move';
  }
  function onDragEnter() { this.classList.add('over'); }
  function onDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
  function onDragLeave() { this.classList.remove('over'); }

  function onDrop(e) {
    e.preventDefault();
    this.classList.remove('over');
    if (!dragSrc || dragSrc === this) return;
    pushUndo();
    swapTilePieces(dragSrc, this);
    dragSrc.classList.remove('dragging');
    dragSrc = null;

    updateJoins();
    const solved = isSolved();
    board.classList.toggle('solved', solved);
    if (solved) {
      let msg = 'Solved! 🎉';
      if (currentImage === 1 && !unlocked2) {
        unlocked2 = true;
        msg = 'Solved! 🎉 Unlocked Puzzle 2';
      }
      updateStatus(msg);
      pauseTimer();
    } else if (!timerRunning) {
      // If not already running (e.g., loaded mid-game but paused), start on first move
      startTimer();
    }
    saveState();
  }

  // Compute which adjacent sides should hide borders when neighbors match in the original image
  function updateJoins() {
    // clear all join classes
    for (const t of tiles) {
      t.classList.remove('join-top', 'join-right', 'join-bottom', 'join-left', 'sharp-tl', 'sharp-tr', 'sharp-br', 'sharp-bl');
    }
    for (let pos = 0; pos < total; pos++) {
      const tile = tiles[pos];
      const p = Number(tile.dataset.piece);
      const x = pos % N;
      const y = Math.floor(pos / N);
      // right neighbor
      if (x < N - 1) {
        const rTile = tiles[pos + 1];
        const rp = Number(rTile.dataset.piece);
        if (p % N !== N - 1 && rp === p + 1) {
          tile.classList.add('join-right');
          rTile.classList.add('join-left');
        }
      }
      // bottom neighbor
      if (y < N - 1) {
        const bTile = tiles[pos + N];
        const bp = Number(bTile.dataset.piece);
        if (Math.floor(p / N) !== N - 1 && bp === p + N) {
          tile.classList.add('join-bottom');
          bTile.classList.add('join-top');
        }
      }
    }

    // After marking joins, compute inner corners where a full 2x2 block is correctly assembled
    for (let y = 0; y < N - 1; y++) {
      for (let x = 0; x < N - 1; x++) {
        const pos = y * N + x;
        const t00 = tiles[pos];           // top-left
        const t10 = tiles[pos + 1];       // top-right
        const t01 = tiles[pos + N];       // bottom-left
        const t11 = tiles[pos + N + 1];   // bottom-right
        // Full corner if the four edges around the vertex are joined
        const ok = t00.classList.contains('join-right') &&
                   t00.classList.contains('join-bottom') &&
                   t10.classList.contains('join-left') &&
                   t10.classList.contains('join-bottom') &&
                   t01.classList.contains('join-top') &&
                   t01.classList.contains('join-right') &&
                   t11.classList.contains('join-top') &&
                   t11.classList.contains('join-left');
        if (ok) {
          t00.classList.add('sharp-br'); // inner corner at bottom-right of t00
          t10.classList.add('sharp-bl'); // inner corner at bottom-left of t10
          t01.classList.add('sharp-tr'); // inner corner at top-right of t01
          t11.classList.add('sharp-tl'); // inner corner at top-left of t11
        }
      }
    }
  }

  function onDragEnd() {
    this.classList.remove('dragging');
    tiles.forEach(t => t.classList.remove('over'));
    dragSrc = null;
  }

  // UI controls
  previewToggle.addEventListener('change', () => {
    // change fires after checkbox state flips; capture previous state for undo
    const prevSnap = getSnapshot();
    prevSnap.preview = !previewToggle.checked;
    pushUndo(prevSnap);
    board.classList.toggle('preview', previewToggle.checked);
    saveState();
  });
  if (edgeToggle) {
    edgeToggle.addEventListener('change', () => {
      const prevSnap = getSnapshot();
      prevSnap.edges = !edgeToggle.checked;
      pushUndo(prevSnap);
      board.classList.toggle('edges', edgeToggle.checked);
      saveState();
    });
  }
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      pushUndo();
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
      if (previewToggle) previewToggle.checked = false;
      if (edgeToggle) edgeToggle.checked = false;
      board.classList.remove('preview', 'edges', 'solved');
      // If second puzzle has been unlocked and we're on the first, switch to #2
      if (unlocked2 && currentImage === 1) {
        currentImage = 2;
      }
      createBoard();
      updateStatus('Reset');
      setTimeout(() => updateStatus(''), 800);
    });
  }

  // Keyboard shortcuts: Undo/Redo
  document.addEventListener('keydown', (e) => {
    const key = e.key;
    const mod = e.metaKey || e.ctrlKey; // Cmd (mac) or Ctrl (win/linux)
    if (!mod) return;
    // Ctrl/Cmd + Y => Redo
    if (key === 'y' || key === 'Y') {
      e.preventDefault();
      doRedo();
      return;
    }
    // Ctrl/Cmd + Z => Undo; Ctrl/Cmd + Shift + Z => Redo
    if (key === 'z' || key === 'Z') {
      e.preventDefault();
      if (e.shiftKey) doRedo();
      else doUndo();
    }
  });

  // Initialize
  createBoard();
  // reflect initial toggle states if any were persisted by the browser
  if (previewToggle && previewToggle.checked) board.classList.add('preview');
  if (edgeToggle && edgeToggle.checked) board.classList.add('edges');
})();
