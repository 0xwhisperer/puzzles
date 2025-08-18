(() => {
  const N = 10; // 10x10 = 100 square pieces
  const board = document.getElementById('board');
  const resetBtn = document.getElementById('resetBtn');
  const previewToggle = document.getElementById('previewToggle');
  const edgeToggle = document.getElementById('edgeToggle');
  const statusEl = document.getElementById('status');
  const timerEl = document.getElementById('timer');
  const titleEl = document.getElementById('title');
  const backBtn = document.getElementById('backBtn');
  const nextBtnTop = document.getElementById('nextBtn');
  const modal = document.getElementById('modal');
  const modalContent = document.getElementById('modalContent');
  let modalTimer = null;
  // Layout refs for dynamic sizing
  const appEl = document.querySelector('.app');
  const titlebarEl = document.querySelector('.titlebar');
  const controlsEl = document.querySelector('.controls');

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
  // 1 = sid1.png, 2 = sid2.png, 3 = catman.png
  const TOTAL_PUZZLES = 3; // update if more puzzles are added
  let currentImage = 1; // 1-based index
  let unlocked2 = false;
  let unlocked3 = false;
  let initialized = false; // tracks first-time initialization

  function formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }

  // ---- Micro-interactions: correct placement pulse + sparkles ----
  function prefersReducedMotion() {
    try {
      return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (_) { return false; }
  }

  function pulseTile(tile) {
    if (!tile) return;
    if (prefersReducedMotion()) {
      tile.classList.add('correct-pulse-rm');
      setTimeout(() => tile.classList.remove('correct-pulse-rm'), 420);
      return;
    }
    tile.classList.add('correct-pulse');
    // Remove the class after animation completes
    setTimeout(() => tile.classList.remove('correct-pulse'), 420);
  }

  function spawnSparklesAtTile(tile, count = 3) {
    if (!tile || prefersReducedMotion()) return;
    const bRect = board.getBoundingClientRect();
    const tRect = tile.getBoundingClientRect();
    const cx = tRect.left - bRect.left + tRect.width / 2;
    const cy = tRect.top - bRect.top + tRect.height / 2;
    for (let i = 0; i < count; i++) {
      const p = document.createElement('div');
      p.className = 'sparkle';
      // Small random offset around center
      const jitterX = (Math.random() - 0.5) * (tRect.width * 0.2);
      const jitterY = (Math.random() - 0.5) * (tRect.height * 0.2);
      p.style.left = `${cx + jitterX - 3}px`;
      p.style.top = `${cy + jitterY - 3}px`;
      // Random travel vector
      const dx = (Math.random() - 0.5) * 22;
      const dy = -12 - Math.random() * 14;
      p.style.setProperty('--dx', `${dx}px`);
      p.style.setProperty('--dy', `${dy}px`);
      board.appendChild(p);
      // Auto-remove after animation
      setTimeout(() => { if (p.parentNode) p.parentNode.removeChild(p); }, 700);
    }
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

  // ---- Responsive sizing: keep the square board within the viewport ----
  function ensureBoardFits() {
    if (!appEl || !board) return;
    const appStyles = getComputedStyle(appEl);
    const padH = parseFloat(appStyles.paddingLeft) + parseFloat(appStyles.paddingRight);
    const padV = parseFloat(appStyles.paddingTop) + parseFloat(appStyles.paddingBottom);
    const tbH = titlebarEl ? titlebarEl.offsetHeight : 0;
    const tbMB = titlebarEl ? parseFloat(getComputedStyle(titlebarEl).marginBottom) : 0;
    const ctrH = controlsEl ? controlsEl.offsetHeight : 0;
    const ctrMB = controlsEl ? parseFloat(getComputedStyle(controlsEl).marginBottom) : 0;
    const chromeV = padV + tbH + tbMB + ctrH + ctrMB;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cardW = Math.min(vw, 720);
    const availableW = cardW - padH;
    const availableH = vh - chromeV;
    const size = Math.max(260, Math.min(availableW, availableH));
    board.style.width = `${size}px`;
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
      const now = Date.now();
      const existing = loadState() || {};
      const boards = existing.boards && typeof existing.boards === 'object' ? existing.boards : {};
      const elapsed = timerRunning ? (timerElapsedMs + (now - timerStartAt)) : timerElapsedMs;
      boards[String(currentImage)] = {
        pieces,
        preview: !!(previewToggle && previewToggle.checked),
        edges: !!(edgeToggle && edgeToggle.checked),
        // per-puzzle timer persistence
        tElapsedMs: elapsed,
        tRunning: !!timerRunning,
        tStartedAt: timerRunning ? timerStartAt : null,
        ts: now,
      };
      const state = {
        n: N,
        image: currentImage,
        unlocked2: !!unlocked2,
        unlocked3: !!unlocked3,
        boards,
        // legacy/global timer fields (kept for backward compatibility)
        elapsedMs: elapsed,
        running: !!timerRunning,
        startedAt: timerRunning ? timerStartAt : null,
        ts: now,
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
    if (saved && saved.n === N) {
      // Migrate v1 -> v2 (single board -> boards map)
      if (!saved.boards) {
        const img = Math.max(1, Math.min(TOTAL_PUZZLES, Number(saved.image) || 1));
        saved.boards = {};
        if (Array.isArray(saved.pieces) && saved.pieces.length === total) {
          saved.boards[String(img)] = {
            pieces: saved.pieces.slice(),
            preview: !!saved.preview,
            edges: !!saved.edges,
            ts: saved.ts || Date.now(),
          };
        }
        delete saved.pieces;
        delete saved.preview;
        delete saved.edges;
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch (_) {}
      }
      // restore progression
      // Only set currentImage from saved on first load; keep navigation choice thereafter
      if (!initialized && saved.image != null) {
        currentImage = Math.max(1, Math.min(TOTAL_PUZZLES, Number(saved.image) || 1));
      }
      unlocked2 = !!saved.unlocked2;
      unlocked3 = !!saved.unlocked3;
      const boardState = saved.boards && saved.boards[String(currentImage)];
      if (boardState && Array.isArray(boardState.pieces) && boardState.pieces.length === total) {
        initialPieces = boardState.pieces.slice();
        if (previewToggle) previewToggle.checked = !!boardState.preview;
        if (edgeToggle) edgeToggle.checked = !!boardState.edges;
        board.classList.toggle('preview', !!boardState.preview);
        board.classList.toggle('edges', !!boardState.edges);
      } else {
        initialPieces = shuffleUntilNotSolved(pieceIndices.slice());
        // default toggles off for new puzzle state
        if (previewToggle) previewToggle.checked = false;
        if (edgeToggle) edgeToggle.checked = false;
        board.classList.remove('preview', 'edges');
      }
      // Restore per-puzzle timer if present; otherwise fallback to legacy/global
      const boardKey = String(currentImage);
      const nowTs = Date.now();
      const boardTimer = saved.boards && saved.boards[boardKey] ? saved.boards[boardKey] : null;
      if (boardTimer && ("tElapsedMs" in boardTimer || "tRunning" in boardTimer)) {
        const tElapsed = Math.max(0, Number(boardTimer.tElapsedMs) || 0);
        const tRunning = !!boardTimer.tRunning;
        timerElapsedMs = tElapsed;
        if (tRunning) {
          // Resume from current time to avoid double-counting past elapsed
          timerStartAt = nowTs;
          timerRunning = true;
          clearInterval(timerInterval);
          timerInterval = setInterval(renderTimer, 250);
        } else {
          timerRunning = false;
          timerStartAt = 0;
          clearInterval(timerInterval);
          timerInterval = null;
        }
        renderTimer();
      } else if (boardTimer) {
        // Fallback to legacy/global timer
        const savedElapsed = Math.max(0, Number(saved.elapsedMs) || 0);
        const wasRunning = !!saved.running;
        if (wasRunning) {
          timerElapsedMs = savedElapsed;
          timerStartAt = nowTs;
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
        // No board exists yet for this puzzle: ensure timer is reset and stopped
        clearInterval(timerInterval);
        timerInterval = null;
        timerRunning = false;
        timerStartAt = 0;
        timerElapsedMs = 0;
        renderTimer();
      }
    } else {
      initialPieces = shuffleUntilNotSolved(pieceIndices.slice());
      // New game -> reset but do not start timer; start on first move
      resetTimer(false);
    }

    // Apply image class to board
    board.classList.remove('image-1', 'image-2', 'image-3');
    board.classList.add(
      currentImage === 3 ? 'image-3' : currentImage === 2 ? 'image-2' : 'image-1'
    );
    // Ensure titlebar nav buttons reflect current progression
    updateNavButtons();
    // Reflect active puzzle in the heading
    updateTitle();

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

      // Mark fixed board position sides for perimeter styling
      const px = pos % N;
      const py = Math.floor(pos / N);
      if (py === 0) tile.classList.add('pos-top');
      if (px === N - 1) tile.classList.add('pos-right');
      if (py === N - 1) tile.classList.add('pos-bottom');
      if (px === 0) tile.classList.add('pos-left');

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
    initialized = true;
    // Adjust board size to fit viewport
    ensureBoardFits();
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

  function showModal(message, duration = 1200) {
    if (!modal || !modalContent) return;
    modalContent.textContent = message;
    modal.classList.add('show');
    clearTimeout(modalTimer);
    modalTimer = setTimeout(() => {
      modal.classList.remove('show');
      modalTimer = null;
    }, duration);
  }

  function updateStatus(message, duration) {
    if (message) {
      // Keep aria-live updated but render feedback via modal to avoid layout shift
      if (statusEl) statusEl.textContent = message;
      showModal(message, typeof duration === 'number' ? duration : 1200);
      return;
    }
    // Default/passive state (no modal): just keep aria-live up to date
    if (statusEl) statusEl.textContent = isSolved() ? 'Solved! 🎉' : '';
  }

  function updateTitle() {
    if (!titleEl) return;
    let which = 'Sid Puzzle 1';
    if (currentImage === 2) which = 'Sid Puzzle 2';
    if (currentImage === 3) which = 'Catman Puzzle';
    titleEl.textContent = `${which} (100 pcs.)`;
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
  let touchOver = null; // current tile under finger during touch drag
  let holdTimer = null;
  let holdActive = false;
  let touchStartX = 0;
  let touchStartY = 0;
  let dragAvatar = null;
  let avatarHalfW = 0;
  let avatarHalfH = 0;
  let pendingTile = null; // tile touched but not yet dragging
  const HOLD_MS = 300;
  const MOVE_THRESHOLD = 10; // px

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
    this.classList.add('drag-origin');
    // Firefox requires data to be set
    e.dataTransfer.setData('text/plain', this.dataset.piece || '');
    e.dataTransfer.effectAllowed = 'move';
    // Create a custom drag image (ghost) with solid inner ring
    const rect = this.getBoundingClientRect();
    const avatar = document.createElement('div');
    avatar.className = 'drag-avatar';
    avatar.style.setProperty('--n', String(N));
    avatar.style.setProperty('--x', this.style.getPropertyValue('--x'));
    avatar.style.setProperty('--y', this.style.getPropertyValue('--y'));
    avatar.style.backgroundImage = (
      currentImage === 3 ? 'url("./catman.png")' :
      currentImage === 2 ? 'url("./sid2.png")' :
      'url("./sid1.png")'
    );
    avatar.style.width = rect.width + 'px';
    avatar.style.height = rect.height + 'px';
    avatar.style.position = 'fixed';
    avatar.style.left = '-10000px';
    avatar.style.top = '-10000px';
    avatar.style.pointerEvents = 'none';
    document.body.appendChild(avatar);
    dragAvatar = avatar;
    try { e.dataTransfer.setDragImage(avatar, rect.width / 2, rect.height / 2); } catch (_) {}
  }
  function onDragEnter() { this.classList.add('over'); }
  function onDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
  function onDragLeave() { this.classList.remove('over'); }

  function onDrop(e) {
    e.preventDefault();
    this.classList.remove('over');
    if (!dragSrc || dragSrc === this) return;
    const a = dragSrc; // source tile
    const b = this;    // drop target tile
    pushUndo();
    swapTilePieces(a, b);
    // Celebrate newly correct placements (before we clear dragSrc)
    const newlyCorrect = [];
    if (a && a.dataset.piece === a.dataset.correct) newlyCorrect.push(a);
    if (b && b.dataset.piece === b.dataset.correct) newlyCorrect.push(b);
    if (newlyCorrect.length) {
      for (const t of newlyCorrect) {
        pulseTile(t);
        spawnSparklesAtTile(t, 3);
      }
      if (navigator.vibrate) {
        try { navigator.vibrate(12); } catch (_) {}
      }
    }
    a.classList.remove('dragging');
    a.classList.remove('drag-origin');
    if (dragAvatar && dragAvatar.parentNode) dragAvatar.parentNode.removeChild(dragAvatar);
    dragAvatar = null;
    dragSrc = null;

    updateJoins();
    const solved = isSolved();
    board.classList.toggle('solved', solved);
    if (solved) {
      let msg = 'Solved! 🎉';
      let dur = undefined;
      if (currentImage === 1 && !unlocked2) {
        unlocked2 = true;
        msg = "Solved. You've unlocked Puzzle 2! Click Next to continue.";
        dur = 5000;
      } else if (currentImage === 2 && !unlocked3) {
        unlocked3 = true;
        msg = "Solved. You've unlocked Puzzle 3 (Catman)! Click Next to continue.";
        dur = 5000;
      }
      updateStatus(msg, dur);
      pauseTimer();
      updateNavButtons();
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
    this.classList.remove('drag-origin');
    tiles.forEach(t => t.classList.remove('over'));
    if (dragAvatar && dragAvatar.parentNode) dragAvatar.parentNode.removeChild(dragAvatar);
    dragAvatar = null;
    dragSrc = null;
  }

  // Touch support (iOS/Android) with long-press + threshold and drag avatar
  function beginTouchDrag(tile, touch) {
    dragSrc = tile;
    holdActive = true;
    tile.classList.add('dragging');
    tile.classList.add('drag-origin');
    if (navigator.vibrate) {
      try { navigator.vibrate(10); } catch (_) {}
    }
    // Create a visual avatar that follows the finger
    const rect = tile.getBoundingClientRect();
    const avatar = document.createElement('div');
    avatar.className = 'drag-avatar';
    // Mirror tile background via CSS vars and image
    avatar.style.setProperty('--n', String(N));
    avatar.style.setProperty('--x', tile.style.getPropertyValue('--x'));
    avatar.style.setProperty('--y', tile.style.getPropertyValue('--y'));
    avatar.style.backgroundImage = (
      currentImage === 3 ? 'url("./catman.png")' :
      currentImage === 2 ? 'url("./sid2.png")' :
      'url("./sid1.png")'
    );
    avatar.style.width = rect.width + 'px';
    avatar.style.height = rect.height + 'px';
    avatar.style.position = 'fixed';
    avatar.style.left = '0px';
    avatar.style.top = '0px';
    avatar.style.pointerEvents = 'none';
    avatar.style.zIndex = '1000';
    document.body.appendChild(avatar);
    dragAvatar = avatar;
    avatarHalfW = rect.width / 2;
    avatarHalfH = rect.height / 2;
    // Initial position under finger
    moveAvatar(touch.clientX, touch.clientY);
  }

  function moveAvatar(clientX, clientY) {
    if (!dragAvatar) return;
    const x = clientX - avatarHalfW;
    const y = clientY - avatarHalfH;
    dragAvatar.style.transform = `translate(${x}px, ${y}px)`;
  }

  function endTouchDrag(commitDrop = true) {
    clearTimeout(holdTimer); holdTimer = null;
    const src = dragSrc;
    const dropTarget = (commitDrop && touchOver && touchOver !== src) ? touchOver : null;
    if (touchOver) touchOver.classList.remove('over');
    if (dragAvatar && dragAvatar.parentNode) dragAvatar.parentNode.removeChild(dragAvatar);
    dragAvatar = null;
    avatarHalfW = avatarHalfH = 0;
    if (src) { src.classList.remove('dragging'); src.classList.remove('drag-origin'); }
    dragSrc = null;
    holdActive = false;
    touchOver = null;
    pendingTile = null;
    if (!dropTarget || !src) return;
    // Mirror onDrop logic
    pushUndo();
    swapTilePieces(src, dropTarget);
    // Celebrate newly correct placements
    const newlyCorrect = [];
    if (src && src.dataset.piece === src.dataset.correct) newlyCorrect.push(src);
    if (dropTarget && dropTarget.dataset.piece === dropTarget.dataset.correct) newlyCorrect.push(dropTarget);
    if (newlyCorrect.length) {
      for (const t of newlyCorrect) {
        pulseTile(t);
        spawnSparklesAtTile(t, 3);
      }
      if (navigator.vibrate) {
        try { navigator.vibrate(12); } catch (_) {}
      }
    }
    updateJoins();
    const solved = isSolved();
    board.classList.toggle('solved', solved);
    if (solved) {
      let msg = 'Solved! 🎉';
      let dur = undefined;
      if (currentImage === 1 && !unlocked2) {
        unlocked2 = true;
        msg = "Solved. You've unlocked Puzzle 2! Click Next to continue.";
        dur = 5000;
      } else if (currentImage === 2 && !unlocked3) {
        unlocked3 = true;
        msg = "Solved. You've unlocked Puzzle 3 (Catman)! Click Next to continue.";
        dur = 5000;
      }
      updateStatus(msg, dur);
      pauseTimer();
      updateNavButtons();
    } else if (!timerRunning) {
      startTimer();
    }
    saveState();
  }

  function onTouchStart(e) {
    const t = e.target.closest('.tile');
    if (!t) return;
    const touch = e.touches && e.touches[0];
    if (!touch) return;
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    pendingTile = t;
    // Schedule long-press begin; do not immediately preventDefault to allow quick taps if needed
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      // Only begin via long-press if we haven't started due to movement
      if (!holdActive && pendingTile === t) beginTouchDrag(t, touch);
    }, HOLD_MS);
  }

  function onTouchMove(e) {
    const touch = e.touches && e.touches[0];
    if (!touch) return;
    if (!holdActive) {
      // If moved beyond threshold, start drag immediately (swipe-to-drag)
      const dx = touch.clientX - touchStartX;
      const dy = touch.clientY - touchStartY;
      if (Math.hypot(dx, dy) > MOVE_THRESHOLD && pendingTile) {
        clearTimeout(holdTimer); holdTimer = null;
        beginTouchDrag(pendingTile, touch);
      } else {
        return; // still within threshold; allow page to scroll
      }
    }
    // Dragging: prevent page gestures and update avatar + hover
    e.preventDefault();
    moveAvatar(touch.clientX, touch.clientY);
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const over = el ? el.closest('.tile') : null;
    if (touchOver && touchOver !== over) touchOver.classList.remove('over');
    if (over && over !== dragSrc) over.classList.add('over');
    touchOver = over;
  }

  function onTouchEnd(e) {
    if (holdActive) {
      endTouchDrag(true);
    } else {
      // Touch ended before hold => cancel pending drag
      clearTimeout(holdTimer); holdTimer = null;
      pendingTile = null;
    }
  }

  function onTouchCancel() {
    if (holdActive) endTouchDrag(false);
    clearTimeout(holdTimer); holdTimer = null;
    pendingTile = null;
  }

  // Attach board-level touch listeners once
  board.addEventListener('touchstart', onTouchStart, { passive: true });
  board.addEventListener('touchmove', onTouchMove, { passive: false });
  board.addEventListener('touchend', onTouchEnd, { passive: true });
  board.addEventListener('touchcancel', onTouchCancel, { passive: true });

  // UI controls
  // Titlebar Back/Next buttons
  function updateNavButtons() {
    if (backBtn) backBtn.disabled = currentImage <= 1;
    if (nextBtnTop) {
      const atEnd = currentImage >= TOTAL_PUZZLES;
      // Stepwise unlocks: 1->2 requires unlocked2, 2->3 requires unlocked3
      const nextLocked = (currentImage === 1 && !unlocked2) || (currentImage === 2 && !unlocked3);
      nextBtnTop.disabled = atEnd || nextLocked;
      const small = window.innerWidth <= 380;
      const label = nextLocked ? (small ? '🔒' : '🔒 Locked') : 'Next';
      nextBtnTop.textContent = label;
      nextBtnTop.setAttribute('aria-label', nextLocked ? 'Next (locked)' : 'Next');
    }
  }
  // Keep button labels responsive to viewport changes
  window.addEventListener('resize', updateNavButtons);
  window.addEventListener('resize', ensureBoardFits);
  // Localhost-only Cheat button to instantly solve (and unlock next puzzle)
  (function addCheatIfLocal() {
    const host = window.location.hostname;
    const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if (!isLocal) return;
    const controls = document.querySelector('.controls');
    if (!controls) return;
    const toggles = controls.querySelector('.toggles');
    const cheatBtn = document.createElement('button');
    cheatBtn.type = 'button';
    cheatBtn.id = 'cheatBtn';
    cheatBtn.textContent = 'Cheat';
    // Place Cheat in the center with the checkbox controls
    if (toggles) toggles.appendChild(cheatBtn);
    else controls.insertBefore(cheatBtn, (resetBtn && resetBtn) || null);
    cheatBtn.addEventListener('click', () => {
      // Complete the puzzle by assigning correct piece to each tile position
      pushUndo();
      tiles.forEach((tile, pos) => setTilePiece(tile, pos));
      updateJoins();
      board.classList.add('solved');
      let msg = 'Solved! 🎉';
      let dur = undefined;
      if (currentImage === 1 && !unlocked2) {
        unlocked2 = true;
        msg = "Solved. You've unlocked Puzzle 2! Click Next to continue.";
        dur = 5000;
      } else if (currentImage === 2 && !unlocked3) {
        unlocked3 = true;
        msg = "Solved. You've unlocked Puzzle 3 (Catman)! Click Next to continue.";
        dur = 5000;
      }
      updateStatus(msg, dur);
      pauseTimer();
      updateNavButtons();
      saveState();
    });
  })();
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
  // Click the clock to pause; it resumes automatically on the next move
  if (timerEl) {
    timerEl.addEventListener('click', () => {
      if (!timerRunning) return;
      pauseTimer();
      updateStatus('Paused');
      setTimeout(() => updateStatus(''), 800);
      saveState();
    });
  }
  // Back/Next button handlers
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      if (currentImage <= 1) return;
      pushUndo();
      // Persist current puzzle before switching
      saveState();
      currentImage = Math.max(1, currentImage - 1);
      createBoard();
      updateStatus(`Back: Puzzle ${currentImage}`);
      setTimeout(() => updateStatus(''), 800);
    });
  }
  if (nextBtnTop) {
    nextBtnTop.addEventListener('click', () => {
      if (currentImage >= TOTAL_PUZZLES) return; // no more puzzles
      // Stepwise locks: 1->2 needs unlocked2, 2->3 needs unlocked3
      if ((currentImage === 1 && !unlocked2) || (currentImage === 2 && !unlocked3)) return;
      pushUndo();
      // Persist current puzzle before switching
      saveState();
      currentImage = Math.min(TOTAL_PUZZLES, currentImage + 1);
      createBoard();
      updateStatus(`Next: Puzzle ${currentImage}`);
      setTimeout(() => updateStatus(''), 800);
    });
  }
  if (resetBtn) {
    resetBtn.addEventListener('click', (e) => {
      const relock = !!e.altKey; // Option/Alt-click to relock next puzzle for testing
      pushUndo();
      const saved = loadState() || {};
      // Normal reset: only reset current puzzle state
      if (!relock) {
        // Clear toggles and assign a fresh shuffle
        if (previewToggle) previewToggle.checked = false;
        if (edgeToggle) edgeToggle.checked = false;
        board.classList.remove('preview', 'edges', 'solved');
        const fresh = shuffleUntilNotSolved([...Array(total).keys()]);
        tiles.forEach((tile, pos) => setTilePiece(tile, fresh[pos]));
        updateJoins();
        // Reset but do not start timer; start on first move
        resetTimer(false);
        saveState();
        updateStatus('Reset');
        setTimeout(() => updateStatus(''), 800);
        return;
      }
      // Relock path: clear saved boards for puzzles 1 and 2, lock progression, and zero timer
      unlocked2 = false;
      const boards = saved.boards && typeof saved.boards === 'object' ? saved.boards : {};
      delete boards['1'];
      delete boards['2'];
      try {
        const now = Date.now();
        const newState = {
          n: N,
          image: 1,
          unlocked2: false,
          boards,
          elapsedMs: 0,
          running: false,
          startedAt: null,
          ts: now,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newState));
      } catch (_) {}
      currentImage = 1;
      if (previewToggle) previewToggle.checked = false;
      if (edgeToggle) edgeToggle.checked = false;
      board.classList.remove('preview', 'edges', 'solved');
      createBoard();
      updateStatus('Relocked next puzzle for testing', 1500);
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
  ensureBoardFits();
  // reflect initial toggle states if any were persisted by the browser
  if (previewToggle && previewToggle.checked) board.classList.add('preview');
  if (edgeToggle && edgeToggle.checked) board.classList.add('edges');
})();
