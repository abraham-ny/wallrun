(() => {
  "use strict";

  const SIZE = 9;
  const TURN_SECONDS = 30;
  const SAVE_KEY = "wallrun-profile-v1";
  const CHAPTERS = [
    { title: "First Footing", rival: "MICA", line: "The city is yours to cross. Find the line.", quote: "Every great route starts with a first step." },
    { title: "Narrow Streets", rival: "NORTH", line: "A quiet rival is already drawing the map.", quote: "The shortest route is rarely left alone." },
    { title: "Crosswind", rival: "JUNO", line: "The wind shifts. So should your plan.", quote: "A detour is only a loss if you stop moving." },
    { title: "High Ground", rival: "BRICK", line: "One wall can change the shape of a whole race.", quote: "Hold your ground. Then make some." },
    { title: "The Long Run", rival: "PATCH", line: "The finish is close. Your nerve is closer.", quote: "Read the board. Trust the next move." },
    { title: "Open City", rival: "THE MAYOR", line: "Every street is open. Every choice is yours.", quote: "You made a way where there wasn't one." }
  ];
  const AVATARS = [
    { id: "rookie", name: "The Rookie", symbol: "R", unlock: 0, subtitle: "New city. Clean slate." },
    { id: "scout", name: "The Scout", symbol: "S", unlock: 2, subtitle: "Knows every shortcut." },
    { id: "architect", name: "The Architect", symbol: "A", unlock: 5, subtitle: "Sees the shape of things." }
  ];
  const freshProfile = () => ({ tokens: 60, xp: 0, wins: 0, campaignWins: 0, games: 0, streak: 0, bestStreak: 0, chapter: 0, avatar: "rookie" });

  const el = (id) => document.getElementById(id);
  const sdk = () => window.CrazyGames?.SDK;
  let profile = freshProfile();
  let sdkReady = false;
  let sdkEnvironment = "disabled";
  let platformUsername = "";
  let currentScreen = "home";
  let match = null;
  let timerId = null;
  let aiTimerId = null;
  let toastTimerId = null;
  let toastReturnId = null;
  let selectedMode = "campaign";
  let soundEnabled = true;
  let platformMuted = false;
  let audioContext = null;

  function readLocalProfile() {
    try {
      const value = JSON.parse(localStorage.getItem(SAVE_KEY) || "null");
      return value && typeof value === "object" ? { ...freshProfile(), ...value } : freshProfile();
    } catch {
      return freshProfile();
    }
  }

  function readStoredProfile() {
    const storage = sdkReady && (sdkEnvironment === "crazygames" || sdkEnvironment === "local") ? sdk()?.data : null;
    if (storage) {
      try {
        const value = JSON.parse(storage.getItem(SAVE_KEY) || "null");
        return value && typeof value === "object" ? { ...freshProfile(), ...value } : freshProfile();
      } catch (error) {
        console.warn("Could not load the CrazyGames save; starting a new profile.", error);
        return freshProfile();
      }
    }
    return readLocalProfile();
  }

  function saveProfile() {
    const value = JSON.stringify(profile);
    if (sdkReady && (sdkEnvironment === "crazygames" || sdkEnvironment === "local")) {
      try { sdk().data.setItem(SAVE_KEY, value); } catch (error) { console.warn("CrazyGames data save failed.", error); }
    } else {
      try { localStorage.setItem(SAVE_KEY, value); } catch (error) { console.warn("Local save is unavailable.", error); }
    }
    renderProfile();
  }

  function callSdk(method, ...args) {
    try {
      const fn = method.split(".").reduce((value, key) => value?.[key], sdk());
      if (typeof fn === "function" && sdkReady) return fn(...args);
    } catch (error) {
      console.warn(`CrazyGames SDK call failed: ${method}`, error);
    }
    return undefined;
  }

  async function initializeSdk() {
    const platform = sdk();
    if (!platform?.init) {
      el("platform-status").textContent = "SAVING ON THIS DEVICE";
      return;
    }
    try {
      await platform.init();
      sdkReady = true;
      sdkEnvironment = platform.environment || "disabled";
      if (sdkEnvironment === "crazygames" || sdkEnvironment === "local") {
        profile = readStoredProfile();
        el("platform-status").textContent = sdkEnvironment === "crazygames" ? "PROGRESS SYNC ENABLED" : "LOCAL SDK TEST MODE";
        try {
          const user = await platform.user.getUser();
          if (user?.username) platformUsername = user.username.toUpperCase().slice(0, 14);
        } catch { /* Guest play is supported. */ }
        try {
          platformMuted = Boolean(platform.game.settings?.muteAudio);
          if (platformMuted) setSound(false);
          platform.game.addSettingsChangeListener?.((settings) => {
            platformMuted = Boolean(settings?.muteAudio);
            if (platformMuted) setSound(false);
          });
        } catch { /* Optional platform settings. */ }
      } else {
        el("platform-status").textContent = "SAVING ON THIS DEVICE";
      }
    } catch (error) {
      console.warn("CrazyGames SDK unavailable; running in browser mode.", error);
      sdkReady = false;
      sdkEnvironment = "disabled";
      el("platform-status").textContent = "SAVING ON THIS DEVICE";
    }
    renderProfile();
    if (currentScreen === "game" && !el("modal").open && match && !match.over) startClock();
  }

  function moveKey(position) { return `${position.x},${position.y}`; }

  function wallFootprint(wall) {
    if (wall.orientation === "h") {
      return [[2 * wall.x + 1, 2 * wall.y + 2], [2 * wall.x + 2, 2 * wall.y + 2], [2 * wall.x + 3, 2 * wall.y + 2]];
    }
    return [[2 * wall.x + 2, 2 * wall.y + 1], [2 * wall.x + 2, 2 * wall.y + 2], [2 * wall.x + 2, 2 * wall.y + 3]];
  }

  function edgeOpen(from, to, walls = match.walls) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (Math.abs(dx) + Math.abs(dy) !== 1) return false;
    for (const wall of walls) {
      if (dx !== 0 && wall.orientation === "v" && Math.min(from.x, to.x) === wall.x && (from.y === wall.y || from.y === wall.y + 1)) return false;
      if (dy !== 0 && wall.orientation === "h" && Math.min(from.y, to.y) === wall.y && (from.x === wall.x || from.x === wall.x + 1)) return false;
    }
    return true;
  }

  function pathExists(player, walls = match.walls) {
    const queue = [player.position];
    const visited = new Set([moveKey(player.position)]);
    while (queue.length) {
      const position = queue.shift();
      if (position.y === player.goalY) return true;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const next = { x: position.x + dx, y: position.y + dy };
        const key = moveKey(next);
        if (next.x >= 0 && next.x < SIZE && next.y >= 0 && next.y < SIZE && !visited.has(key) && edgeOpen(position, next, walls)) {
          visited.add(key);
          queue.push(next);
        }
      }
    }
    return false;
  }

  function validWall(wall) {
    if (wall.x < 0 || wall.y < 0 || wall.x > SIZE - 2 || wall.y > SIZE - 2) return false;
    const footprint = new Set(wallFootprint(wall).map(([x, y]) => `${x},${y}`));
    for (const existing of match.walls) {
      if (wallFootprint(existing).some(([x, y]) => footprint.has(`${x},${y}`))) return false;
    }
    const walls = [...match.walls, wall];
    return match.players.every((player) => pathExists(player, walls));
  }

  function legalMoves(playerIndex) {
    const player = match.players[playerIndex];
    const opponent = match.players[1 - playerIndex];
    const destinations = new Map();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const adjacent = { x: player.position.x + dx, y: player.position.y + dy };
      if (adjacent.x < 0 || adjacent.x >= SIZE || adjacent.y < 0 || adjacent.y >= SIZE || !edgeOpen(player.position, adjacent)) continue;
      if (adjacent.x !== opponent.position.x || adjacent.y !== opponent.position.y) {
        destinations.set(moveKey(adjacent), adjacent);
        continue;
      }
      const jump = { x: adjacent.x + dx, y: adjacent.y + dy };
      if (jump.x >= 0 && jump.x < SIZE && jump.y >= 0 && jump.y < SIZE && edgeOpen(adjacent, jump)) {
        destinations.set(moveKey(jump), jump);
      } else {
        const sideSteps = dx === 0 ? [[1, 0], [-1, 0]] : [[0, 1], [0, -1]];
        for (const [sideX, sideY] of sideSteps) {
          const side = { x: opponent.position.x + sideX, y: opponent.position.y + sideY };
          if (side.x >= 0 && side.x < SIZE && side.y >= 0 && side.y < SIZE && edgeOpen(adjacent, side)) destinations.set(moveKey(side), side);
        }
      }
    }
    return [...destinations.values()];
  }

  function makePlayers(mode) {
    return [
      { name: mode === "duel" ? "CORAL" : profile.avatar === "rookie" ? "THE ROOKIE" : AVATARS.find((avatar) => avatar.id === profile.avatar)?.name.toUpperCase() || "THE ROOKIE", color: "coral", position: { x: 4, y: 8 }, goalY: 0, walls: 10 },
      { name: mode === "duel" ? "BLUE" : CHAPTERS[Math.min(profile.chapter, CHAPTERS.length - 1)].rival, color: "blue", position: { x: 4, y: 0 }, goalY: 8, walls: 10 }
    ];
  }

  function startMatch(mode) {
    clearInterval(timerId);
    clearTimeout(aiTimerId);
    selectedMode = mode;
    const players = makePlayers(mode);
    match = {
      mode,
      players,
      walls: [],
      turn: 0,
      turns: 0,
      round: 1,
      remaining: TURN_SECONDS,
      wallMode: "move",
      usedPowerups: { time: false, walls: false },
      over: false,
      aiLevel: Math.min(profile.chapter, 5)
    };
    for (const powerup of ["time", "walls"]) {
      const storageKey = `wallrun-preload-${powerup}`;
      if (sessionStorage.getItem(storageKey)) {
        sessionStorage.removeItem(storageKey);
        match.usedPowerups[powerup] = true;
        if (powerup === "time") match.remaining += 15;
        else players[0].walls += 2;
      }
    }
    const showIntro = mode === "campaign" && profile.chapter < CHAPTERS.length && profile.campaignWins === profile.chapter;
    currentScreen = "game";
    el("home-screen").classList.add("hidden");
    el("game-screen").classList.remove("hidden");
    el("match-mode-label").textContent = mode === "duel" ? "LOCAL DUEL · PASS & PLAY" : `CAMPAIGN · CHAPTER ${String(profile.chapter + 1).padStart(2, "0")}`;
    el("match-note").textContent = mode === "duel" ? "PASS THE KEYBOARD AFTER EACH TURN" : "FIRST TO THE FAR SIDE";
    el("clock-caption").textContent = "Think fast. The clock is live.";
    callSdk("game.gameplayStart");
    renderMatch();
    if (showIntro) showStory(0);
    else startClock();
  }

  function setWallMode(mode) {
    if (!match || match.over) return;
    match.wallMode = mode;
    for (const [id, value] of [["move-mode", "move"], ["horizontal-mode", "h"], ["vertical-mode", "v"]]) el(id).classList.toggle("active", mode === value);
    el("board-hint").textContent = mode === "move" ? "CHOOSE A SQUARE TO MOVE, OR LAY A WALL" : "CHOOSE A GAP BETWEEN TWO SQUARES";
    el("wall-help").textContent = mode === "move" ? "Select a square you can reach this turn." : `Click a highlighted gap to place a ${mode === "h" ? "horizontal" : "vertical"} wall.`;
    renderBoard();
  }

  function canPlace(wall) {
    return match.players[match.turn].walls > 0 && validWall(wall);
  }

  function renderBoard() {
    const board = el("board");
    if (!match) return;
    const activeIndex = match.turn;
    const legal = new Set(legalMoves(activeIndex).map(moveKey));
    const wallsAt = new Map();
    for (const wall of match.walls) wallsAt.set(`${wall.x},${wall.y},${wall.orientation}`, wall);
    const fragment = document.createDocumentFragment();
    for (let row = 0; row < 17; row += 1) {
      for (let col = 0; col < 17; col += 1) {
        const square = col % 2 === 0 && row % 2 === 0;
        if (square) {
          const x = col / 2;
          const y = row / 2;
          const cell = document.createElement("button");
          cell.type = "button";
          cell.className = "board-cell";
          cell.style.setProperty("--col", col + 1);
          cell.style.setProperty("--row", row + 1);
          cell.setAttribute("role", "gridcell");
          cell.setAttribute("aria-label", `Square ${String.fromCharCode(65 + x)}${y + 1}`);
          const playerIndex = match.players.findIndex((player) => player.position.x === x && player.position.y === y);
          if (playerIndex >= 0) {
            const pawn = document.createElement("span");
            pawn.className = `pawn pawn-${match.players[playerIndex].color}`;
            pawn.textContent = playerIndex === 0 ? "R" : "B";
            cell.append(pawn);
          } else if (match.wallMode === "move" && legal.has(`${x},${y}`)) {
            const dot = document.createElement("span");
            dot.className = "legal-dot";
            cell.append(dot);
          }
          const onLegalMove = match.wallMode === "move" && legal.has(`${x},${y}`);
          cell.disabled = match.over || (playerIndex >= 0) || (match.mode === "campaign" && activeIndex === 1) || !onLegalMove;
          cell.addEventListener("click", () => playMove({ x, y }));
          fragment.append(cell);
        } else if (col % 2 === 1 && row % 2 === 1) {
          const gap = document.createElement("button");
          gap.type = "button";
          gap.className = "board-gap";
          gap.style.setProperty("--col", col + 1);
          gap.style.setProperty("--row", row + 1);
          gap.tabIndex = -1;
          const gx = Math.floor(col / 2);
          const gy = Math.floor(row / 2);
          const hWall = wallsAt.get(`${gx},${gy},h`);
          const vWall = wallsAt.get(`${gx},${gy},v`);
          const wall = hWall || vWall;
          if (wall) {
            const bar = document.createElement("span");
            bar.className = `wall-bar${wall.player === 1 ? " wall-blue" : ""}`;
            if (wall.orientation === "h") {
              bar.style.width = "310%";
              bar.style.height = "100%";
            } else {
              bar.style.width = "100%";
              bar.style.height = "310%";
            }
            gap.append(bar);
          }
          fragment.append(gap);
        } else {
          const gap = document.createElement("button");
          gap.type = "button";
          gap.className = "board-gap";
          gap.style.setProperty("--col", col + 1);
          gap.style.setProperty("--row", row + 1);
          const horizontal = row % 2 === 1;
          const orientation = horizontal ? "h" : "v";
          const x = horizontal ? Math.floor(col / 2) : Math.floor((col - 1) / 2);
          const y = horizontal ? Math.floor((row - 1) / 2) : Math.floor(row / 2);
          const inRange = x < SIZE - 1 && y < SIZE - 1;
          const allowedMode = match.wallMode === orientation;
          const candidate = { x, y, orientation, player: activeIndex };
          const placeable = inRange && allowedMode && canPlace(candidate) && !(match.mode === "campaign" && activeIndex === 1);
          if (placeable) {
            gap.classList.add("wall-slot");
            gap.setAttribute("aria-label", `Place ${orientation === "h" ? "horizontal" : "vertical"} wall at ${x + 1}, ${y + 1}`);
            gap.addEventListener("click", () => placeWall(candidate));
          } else {
            gap.disabled = true;
            gap.tabIndex = -1;
          }
          fragment.append(gap);
        }
      }
    }
    board.replaceChildren(fragment);
  }

  function renderMatch() {
    if (!match) return;
    const active = match.players[match.turn];
    const other = match.players[1 - match.turn];
    el("active-name").textContent = active.name;
    el("active-detail").textContent = `${active.walls} WALLS · ${match.turn === 0 ? "SOUTH" : "NORTH"}`;
    el("opponent-name").textContent = other.name;
    el("opponent-detail").textContent = `${other.walls} WALLS · ${match.turn === 1 ? "SOUTH" : "NORTH"}`;
    el("active-chip").classList.toggle("turn-active", match.turn === 0);
    el("opponent-chip").classList.toggle("turn-active", match.turn === 1);
    const localOpponentTurn = match.mode === "duel" && match.turn === 1;
    const turnText = match.mode === "campaign" && match.turn === 1 ? "RIVAL'S TURN" : localOpponentTurn ? "BLUE TO MOVE" : "YOUR TURN";
    el("turn-banner").querySelector("strong").textContent = turnText;
    el("turn-subtitle").textContent = match.mode === "duel" ? "PASS THE KEYBOARD" : match.mode === "campaign" && match.turn === 1 ? "MICA IS THINKING" : "MAKE IT COUNT";
    el("turn-count").textContent = `TURN ${String(match.turns + 1).padStart(2, "0")}`;
    el("round-label").textContent = `ROUND ${String(match.round).padStart(2, "0")}`;
    el("wall-count-tag").textContent = `${active.walls} LEFT`;
    el("sprint-button").disabled = match.over || match.usedPowerups.time || profile.tokens < 35;
    el("extra-wall-button").disabled = match.over || match.usedPowerups.walls || profile.tokens < 50;
    el("board").setAttribute("aria-label", `${active.name}'s turn. ${active.walls} walls remain.`);
    renderBoard();
    updateClock();
  }

  function playMove(position) {
    if (!match || match.over || (match.mode === "campaign" && match.turn === 1)) return;
    if (!legalMoves(match.turn).some((move) => move.x === position.x && move.y === position.y)) return;
    match.players[match.turn].position = position;
    playTone(520, .06);
    finishTurn();
  }

  function placeWall(wall) {
    if (!match || match.over || !canPlace(wall) || (match.mode === "campaign" && match.turn === 1)) return;
    match.walls.push(wall);
    match.players[match.turn].walls -= 1;
    playTone(330, .09);
    finishTurn();
  }

  function finishTurn() {
    if (match.players[match.turn].position.y === match.players[match.turn].goalY) {
      endMatch(match.turn, "finish");
      return;
    }
    match.turns += 1;
    match.turn = 1 - match.turn;
    if (match.turn === 0) match.round += 1;
    match.remaining = TURN_SECONDS;
    renderMatch();
    clearInterval(timerId);
    if (match.mode === "campaign" && match.turn === 1) scheduleAiMove();
    else startClock();
  }

  function startClock() {
    clearInterval(timerId);
    if (!match || match.over || el("modal").open) return;
    timerId = setInterval(() => {
      if (!match || match.over || currentScreen !== "game") return;
      match.remaining -= 1;
      updateClock();
      if (match.remaining <= 0) {
        clearInterval(timerId);
        endMatch(1 - match.turn, "timeout");
      }
    }, 1000);
  }

  function updateClock() {
    if (!match) return;
    el("clock-value").textContent = String(Math.max(0, match.remaining)).padStart(2, "0");
    el("clock-ring").classList.toggle("clock-urgent", match.remaining <= 8);
    el("clock-caption").textContent = match.remaining <= 8 ? "Clock's almost out." : match.mode === "duel" && match.turn === 1 ? "Blue's clock is live." : "Think fast. The clock is live.";
    el("clock-ring").parentElement.classList.toggle("clock-urgent", match.remaining <= 8);
  }

  function distanceToGoal(player, walls = match.walls) {
    const queue = [{ ...player.position, steps: 0 }];
    const visited = new Set([moveKey(player.position)]);
    while (queue.length) {
      const current = queue.shift();
      if (current.y === player.goalY) return current.steps;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const next = { x: current.x + dx, y: current.y + dy };
        const key = moveKey(next);
        if (next.x >= 0 && next.x < SIZE && next.y >= 0 && next.y < SIZE && !visited.has(key) && edgeOpen(current, next, walls)) {
          visited.add(key);
          queue.push({ ...next, steps: current.steps + 1 });
        }
      }
    }
    return 99;
  }

  function legalWallCandidates(playerIndex) {
    const walls = [];
    for (const orientation of ["h", "v"]) {
      for (let y = 0; y < SIZE - 1; y += 1) {
        for (let x = 0; x < SIZE - 1; x += 1) {
          const wall = { x, y, orientation, player: playerIndex };
          if (match.players[playerIndex].walls > 0 && validWall(wall)) walls.push(wall);
        }
      }
    }
    return walls;
  }

  function scheduleAiMove() {
    clearInterval(timerId);
    clearTimeout(aiTimerId);
    el("turn-banner").querySelector("strong").textContent = "RIVAL'S TURN";
    el("board-hint").textContent = "THE RIVAL IS READING YOUR ROUTE";
    aiTimerId = setTimeout(() => {
      if (!match || match.over || match.turn !== 1) return;
      const options = legalMoves(1);
      if (!options.length) return endMatch(0, "finish");
      const player = match.players[1];
      const ownDistance = distanceToGoal(player);
      const preferred = options.map((position) => ({ position, distance: distanceToGoal({ ...player, position }) })).sort((a, b) => a.distance - b.distance);
      let bestMove = preferred[0];
      const chapter = Math.min(match.aiLevel, CHAPTERS.length - 1);
      if (chapter >= 2 && player.walls > 0 && Math.random() < Math.min(.16 + chapter * .075, .42)) {
        const opponentDistance = distanceToGoal(match.players[0]);
        const candidates = legalWallCandidates(1).map((wall) => {
          const proposed = [...match.walls, wall];
          return { wall, own: distanceToGoal(player, proposed), opponent: distanceToGoal(match.players[0], proposed) };
        }).filter((result) => result.own <= ownDistance + 1 && result.opponent > opponentDistance);
        candidates.sort((a, b) => (b.opponent - opponentDistance) - (a.opponent - opponentDistance));
        if (candidates.length && (chapter >= 4 || Math.random() < .68)) {
          const picked = candidates[0].wall;
          match.walls.push(picked);
          match.players[1].walls -= 1;
          finishTurn();
          return;
        }
      }
      const skill = chapter === 0 ? .28 : chapter === 1 ? .48 : .68 + chapter * .055;
      if (Math.random() > skill && preferred.length > 1) bestMove = preferred[Math.floor(Math.random() * Math.min(3, preferred.length))];
      match.players[1].position = bestMove.position;
      finishTurn();
    }, 550 + Math.random() * 450);
  }

  function endMatch(winnerIndex, reason) {
    if (!match || match.over) return;
    match.over = true;
    clearInterval(timerId);
    clearTimeout(aiTimerId);
    callSdk("game.gameplayStop");
    const winner = match.players[winnerIndex];
    const playerWon = match.mode === "duel" ? winnerIndex === 0 : winnerIndex === 0;
    profile.games += 1;
    if (playerWon) {
      profile.wins += 1;
      profile.streak += 1;
      profile.bestStreak = Math.max(profile.bestStreak, profile.streak);
      if (match.mode === "campaign") {
        profile.campaignWins += 1;
        profile.xp += 55 + (match.aiLevel * 7);
        profile.tokens += 40 + Math.min(match.aiLevel * 5, 25);
        profile.chapter = Math.min(CHAPTERS.length - 1, profile.chapter + 1);
        if (profile.campaignWins >= CHAPTERS.length) {
          profile.chapter = CHAPTERS.length - 1;
          callSdk("game.reportGameCompletedPercentage", 100);
        } else {
          callSdk("game.reportGameCompletedPercentage", Math.round((profile.campaignWins / CHAPTERS.length) * 100));
        }
        callSdk("game.happytime");
        submitLeaderboardScore(profile.xp);
      }
    } else {
      profile.streak = 0;
    }
    saveProfile();
    playTone(playerWon ? 660 : 190, .18);
    showEndMatch(winner, playerWon, reason);
  }

  async function submitLeaderboardScore(score) {
    const key = window.WALLRUN_CONFIG?.leaderboardEncryptionKey;
    if (!key || !sdkReady || sdkEnvironment !== "crazygames" || !sdk()?.user?.submitScore || !window.crypto?.subtle) return;
    try {
      const iv = window.crypto.getRandomValues(new Uint8Array(12));
      const bytes = Uint8Array.from(atob(key), (character) => character.charCodeAt(0));
      const cryptoKey = await window.crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt"]);
      const encrypted = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, new TextEncoder().encode(String(score)));
      const combined = new Uint8Array(iv.length + encrypted.byteLength);
      combined.set(iv);
      combined.set(new Uint8Array(encrypted), iv.length);
      const encryptedScore = btoa(String.fromCharCode(...combined));
      await sdk().user.submitScore({ encryptedScore, score });
    } catch (error) {
      console.warn("Leaderboard submission failed.", error);
    }
  }

  function showEndMatch(winner, playerWon, reason) {
    const title = match.mode === "duel" ? `${winner.name} takes the run.` : playerWon ? "A way through." : "Not this time.";
    const description = reason === "timeout"
      ? `${winner.name} wins on the clock. The next route is still yours to find.`
      : playerWon
        ? `${winner.name} made it to the far side. The city opens a little more.`
        : `${winner.name} reached the far side first. Reset, read the walls, and run it back.`;
    const reward = playerWon && match.mode === "campaign" ? `+${55 + match.aiLevel * 7} XP · +${40 + Math.min(match.aiLevel * 5, 25)} RUN TOKENS` : match.mode === "duel" ? "LOCAL DUEL · NO CAMPAIGN REWARDS" : "NO CAMPAIGN REWARD THIS RUN";
    el("modal-kicker").textContent = "RUN COMPLETE";
    el("modal-content").innerHTML = `
      <h2 class="modal-content-title">${title}</h2>
      <p class="modal-copy">${description}</p>
      <p class="modal-copy"><strong>${reward}</strong></p>
      <button class="button button-primary modal-action" id="rematch-button" type="button"><span>RUN IT BACK</span><span class="button-arrow">↗</span></button>
      <button class="button button-secondary modal-action" id="end-home-button" type="button">BACK TO THE CLUB</button>`;
    el("modal").showModal();
    el("rematch-button").addEventListener("click", () => {
      const mode = match.mode;
      el("modal").close();
      startMatch(mode);
    });
    el("end-home-button").addEventListener("click", () => {
      el("modal").close();
      goHome();
    });
  }

  function showStory(chapterIndex) {
    const chapter = CHAPTERS[chapterIndex];
    if (!chapter) return;
    el("modal-kicker").textContent = `CHAPTER ${String(chapterIndex + 1).padStart(2, "0")}`;
    el("modal-content").innerHTML = `
      <h2 class="modal-content-title">${chapter.title}</h2>
      <p class="modal-copy">${chapter.line}</p>
      <p class="modal-copy"><em>“${chapter.quote}”</em></p>
      <button class="button button-primary modal-action" id="story-start" type="button"><span>STEP ONTO THE BOARD</span><span class="button-arrow">↗</span></button>`;
    el("modal").showModal();
    el("story-start").addEventListener("click", () => {
      el("modal").close();
      if (match && !match.over) startClock();
    });
  }

  function showRules() {
    el("modal-kicker").textContent = "FIELD GUIDE";
    el("modal-content").innerHTML = `
      <h2 class="modal-content-title">Make your way.</h2>
      <p class="modal-copy">Reach the opposite edge before your rival. Every turn, move one square, jump over a rival, or spend a wall to redirect the race.</p>
      <ul class="modal-list">
        <li><b>01</b><span>Move one square with the arrow keys or WASD. You may jump over a rival; if a wall blocks the jump, step to either side.</span></li>
        <li><b>02</b><span>Choose H WALL or V WALL, then click a highlighted gap. A wall blocks two lanes. It cannot overlap another wall or seal every route.</span></li>
        <li><b>03</b><span>Your turn clock is 30 seconds. When it runs out, the other runner wins.</span></li>
        <li><b>04</b><span>Campaign victories earn Run Tokens and XP. Spend tokens on one-use tactics; rewarded ads grant tokens only after the video completes.</span></li>
      </ul>
      <button class="button button-primary modal-action" id="rules-close" type="button"><span>GOT IT</span><span class="button-arrow">↗</span></button>`;
    el("modal").showModal();
    el("rules-close").addEventListener("click", () => el("modal").close());
  }

  function showStore() {
    const nextChapter = Math.min(profile.chapter, CHAPTERS.length - 1);
    el("modal-kicker").textContent = "THE LOCKER ROOM";
    el("modal-content").innerHTML = `
      <h2 class="modal-content-title">Pack light. Run far.</h2>
      <p class="modal-copy">Your Run Tokens: <strong>${profile.tokens} W</strong></p>
      <div class="store-list">
        <div class="store-item"><span>⏱</span><span><strong>Time Slip</strong><small>15 extra seconds, once next match.</small></span><button class="store-buy" data-buy="time">35 W</button></div>
        <div class="store-item"><span>╋</span><span><strong>Spare Walls</strong><small>Two extra blockers, once next match.</small></span><button class="store-buy" data-buy="walls">50 W</button></div>
        <div class="store-item"><span>✦</span><span><strong>Runner's Patch</strong><small>Chapter ${String(nextChapter + 1).padStart(2, "0")} · ${CHAPTERS[nextChapter].title}</small></span><button class="store-buy" data-buy="chapter">${profile.chapter >= 2 ? "EARNED" : "LOCKED"}</button></div>
      </div>
      <p class="modal-copy">Win campaign chapters to unlock new runners. Your equipped runner is in the club profile.</p>`;
    el("modal").showModal();
    el("modal-content").querySelectorAll("[data-buy]").forEach((button) => button.addEventListener("click", () => buyStoreItem(button.dataset.buy)));
  }

  function buyStoreItem(item) {
    const price = item === "time" ? 35 : 50;
    if (item === "chapter") return showToast(profile.chapter >= 2 ? "That patch is already yours. Check your runner profile." : "Win two campaign runs to earn the Scout patch.");
    if (profile.tokens < price) return showToast(`You need ${price - profile.tokens} more Run Tokens.`);
    profile.tokens -= price;
    saveProfile();
    el("modal").close();
    if (currentScreen === "game" && match && !match.over && !match.usedPowerups[item]) activatePowerup(item, true);
    else {
      showToast(item === "time" ? "Time Slip packed for your next run." : "Spare walls packed for your next run.");
      sessionStorage.setItem(`wallrun-preload-${item}`, "1");
    }
    playTone(740, .08);
  }

  function activatePowerup(item, purchased = false) {
    if (!match || match.over || match.usedPowerups[item]) return;
    const cost = item === "time" ? 35 : 50;
    if (!purchased && profile.tokens < cost) return showToast(`You need ${cost - profile.tokens} more Run Tokens.`);
    if (!purchased) profile.tokens -= cost;
    match.usedPowerups[item] = true;
    if (item === "time") {
      match.remaining += 15;
      showToast("TIME SLIP. Fifteen extra seconds.");
    } else {
      match.players[match.turn].walls += 2;
      showToast("SPARE WALLS. Two blockers added.");
    }
    saveProfile();
    renderMatch();
    playTone(740, .08);
  }

  function useRewardedAd() {
    if (!sdkReady || sdkEnvironment !== "crazygames" || !sdk()?.ad?.requestAd) {
      showToast("Rewarded videos are available when Wall Run is played on CrazyGames.");
      return;
    }
    let awarded = false;
    const wasInGame = currentScreen === "game" && match && !match.over;
    const restoreSound = soundEnabled;
    clearInterval(timerId);
    try {
      sdk().ad.requestAd("rewarded", {
        adStarted: () => {
          clearInterval(timerId);
          setSound(false);
          el("clock-caption").textContent = "Run paused for your video.";
        },
        adFinished: () => {
          setSound(restoreSound);
          if (awarded) return;
          awarded = true;
          profile.tokens += 60;
          saveProfile();
          showToast("60 Run Tokens added to your locker.");
          if (wasInGame) startClock();
        },
        adError: (error) => {
          setSound(restoreSound);
          console.warn("Rewarded ad did not complete.", error);
          showToast(error?.code === "adblock" ? "A video couldn't load. Your run is ready when you are." : "No video available right now. Your run is ready when you are.");
          if (wasInGame) startClock();
        }
      });
    } catch (error) {
      console.warn("Could not request a rewarded video.", error);
      setSound(restoreSound);
      showToast("No video available right now. Your run is ready when you are.");
      if (wasInGame) startClock();
    }
  }

  function renderProfile() {
    const xpIntoLevel = profile.xp % 100;
    const level = Math.floor(profile.xp / 100) + 1;
    const avatar = AVATARS.find((value) => value.id === profile.avatar) || AVATARS[0];
    const completed = Math.min(profile.wins, CHAPTERS.length);
    const chapter = CHAPTERS[Math.min(profile.chapter, CHAPTERS.length - 1)];
    el("token-count").textContent = String(profile.tokens);
    el("win-count").textContent = String(profile.wins).padStart(2, "0");
    el("win-rate").textContent = profile.games ? `${Math.round((profile.wins / profile.games) * 100)}%` : "—";
    el("streak-count").textContent = String(profile.bestStreak).padStart(2, "0");
    el("runner-level").textContent = `LV. ${String(level).padStart(2, "0")}`;
    el("runner-name").textContent = avatar.name.toUpperCase();
    el("runner-subtitle").textContent = profile.wins ? avatar.subtitle : AVATARS[0].subtitle;
    el("portrait-initial").textContent = avatar.symbol;
    el("xp-label").textContent = `${xpIntoLevel} / 100`;
    el("xp-bar").style.width = `${xpIntoLevel}%`;
    el("chapter-number").textContent = String(profile.chapter + 1).padStart(2, "0");
    el("chapter-title").textContent = chapter.title;
    el("chapter-description").textContent = chapter.line;
    el("chapter-progress").textContent = `${String(Math.min(profile.chapter + 1, CHAPTERS.length)).padStart(2, "0")} / ${String(CHAPTERS.length).padStart(2, "0")}`;
    el("chapter-status").textContent = completed >= CHAPTERS.length ? "REPLAY" : "PLAY";
    el("continue-label").textContent = profile.games ? "CONTINUE THE RUN" : "START THE RUN";
    el("season-label").textContent = profile.wins >= CHAPTERS.length ? "SEASON 01 · CITY RUNNER" : "SEASON 01 · THE LONG WAY HOME";
    el("profile-name").textContent = platformUsername || avatar.name.replace("The ", "").toUpperCase();
  }

  function showAvatars() {
    const unlockedWins = profile.campaignWins;
    el("modal-kicker").textContent = "RUNNER ROSTER";
    el("modal-content").innerHTML = `
      <h2 class="modal-content-title">Pick your runner.</h2>
      <p class="modal-copy">More of the city opens up as you collect campaign wins.</p>
      <div class="avatar-options">${AVATARS.map((avatar) => {
        const unlocked = unlockedWins >= avatar.unlock;
        return `<button class="avatar-option ${profile.avatar === avatar.id ? "selected" : ""} ${unlocked ? "" : "locked"}" data-avatar="${avatar.id}" ${unlocked ? "" : "disabled"}><span class="avatar-face">${avatar.symbol}</span><strong>${avatar.name}</strong><small>${unlocked ? profile.avatar === avatar.id ? "EQUIPPED" : "UNLOCKED" : `${avatar.unlock} WINS TO GO`}</small></button>`;
      }).join("")}</div>`;
    el("modal").showModal();
    el("modal-content").querySelectorAll("[data-avatar]").forEach((button) => button.addEventListener("click", () => {
      profile.avatar = button.dataset.avatar;
      saveProfile();
      showAvatars();
    }));
  }

  function showLeaderboard() {
    const configured = Boolean(window.WALLRUN_CONFIG?.leaderboardEncryptionKey);
    el("modal-kicker").textContent = "WORLD RANKINGS";
    el("modal-content").innerHTML = `
      <h2 class="modal-content-title">Run the city.</h2>
      <p class="modal-copy">Campaign XP${configured ? " is submitted to the CrazyGames leaderboard when you win." : " is tracked in your profile. Global scores unlock after the CrazyGames leaderboard key is configured in the Developer Portal."}</p>
      <div class="store-item"><span>✦</span><span><strong>${profile.xp} XP</strong><small>${profile.wins} campaign wins · best streak ${profile.bestStreak}</small></span></div>
      <p class="modal-copy">CrazyGames global leaderboards are available to invited games. Client-submitted results can be modified, so the game uses backend validation only when a server is configured.</p>`;
    el("modal").showModal();
  }

  function goHome() {
    clearInterval(timerId);
    clearTimeout(aiTimerId);
    match = null;
    currentScreen = "home";
    el("game-screen").classList.add("hidden");
    el("home-screen").classList.remove("hidden");
    callSdk("game.gameplayStop");
    renderProfile();
  }

  function showToast(message) {
    const toast = el("toast");
    toast.textContent = message;
    toast.classList.add("visible");
    clearTimeout(toastTimerId);
    toastTimerId = setTimeout(() => toast.classList.remove("visible"), 2600);
  }

  function setSound(enabled) {
    if (platformMuted && enabled) enabled = false;
    soundEnabled = enabled;
    el("sound-state").textContent = enabled ? "ON" : "OFF";
    el("sound-toggle").textContent = enabled ? "♪" : "×";
    el("sound-toggle").setAttribute("aria-label", enabled ? "Mute sound" : "Turn sound on");
  }

  function playTone(frequency, duration) {
    if (!soundEnabled || !window.AudioContext) return;
    try {
      audioContext ||= new AudioContext();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(.045, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + duration);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + duration);
    } catch { /* Audio is an optional enhancement. */ }
  }

  function handleKeyboard(event) {
    if (currentScreen !== "game" || !match || match.over || el("modal").open) return;
    if (match.mode === "campaign" && match.turn === 1) return;
    const directions = { ArrowUp: [0, -1], w: [0, -1], W: [0, -1], ArrowDown: [0, 1], s: [0, 1], S: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0], A: [-1, 0], ArrowRight: [1, 0], d: [1, 0], D: [1, 0] };
    if (directions[event.key]) {
      event.preventDefault();
      if (match.wallMode !== "move") setWallMode("move");
      const [dx, dy] = directions[event.key];
      const position = { x: match.players[match.turn].position.x + dx, y: match.players[match.turn].position.y + dy };
      const moves = legalMoves(match.turn);
      const move = moves.find((candidate) => candidate.x === position.x && candidate.y === position.y);
      const jumpedMove = moves.find((candidate) => (dx !== 0 && candidate.y === position.y && Math.sign(candidate.x - match.players[match.turn].position.x) === dx) || (dy !== 0 && candidate.x === position.x && Math.sign(candidate.y - match.players[match.turn].position.y) === dy));
      if (move || jumpedMove) playMove(move || jumpedMove);
      else showToast("That square is blocked. Try a jump or a wall-free route.");
    }
  }

  function init() {
    profile = readLocalProfile();
    renderProfile();
    initializeSdk();
    el("continue-button").addEventListener("click", () => {
      startMatch("campaign");
    });
    el("chapter-button").addEventListener("click", () => {
      startMatch("campaign");
    });
    el("duel-button").addEventListener("click", () => startMatch("duel"));
    el("back-button").addEventListener("click", () => {
      if (match && !match.over && match.mode === "campaign") {
        el("modal-kicker").textContent = "PAUSE THE RUN";
        el("modal-content").innerHTML = `<h2 class="modal-content-title">Leave the board?</h2><p class="modal-copy">This match won't count as a win, but your runner progress is safe.</p><button class="button button-primary modal-action" id="leave-button" type="button"><span>BACK TO THE CLUB</span><span class="button-arrow">↗</span></button><button class="button button-secondary modal-action" id="keep-playing" type="button">STAY IN THE MATCH</button>`;
        el("modal").showModal();
        el("leave-button").addEventListener("click", () => { el("modal").close(); goHome(); });
        el("keep-playing").addEventListener("click", () => { el("modal").close(); startClock(); });
      } else goHome();
    });
    el("rules-button").addEventListener("click", showRules);
    el("move-mode").addEventListener("click", () => setWallMode("move"));
    el("horizontal-mode").addEventListener("click", () => setWallMode("h"));
    el("vertical-mode").addEventListener("click", () => setWallMode("v"));
    el("sprint-button").addEventListener("click", () => activatePowerup("time"));
    el("extra-wall-button").addEventListener("click", () => activatePowerup("walls"));
    el("reward-button").addEventListener("click", useRewardedAd);
    document.querySelector(".currency").addEventListener("click", showStore);
    el("profile-button").addEventListener("click", showAvatars);
    el("leaderboard-button").addEventListener("click", showLeaderboard);
    el("sound-toggle").addEventListener("click", () => setSound(!soundEnabled));
    el("sound-footer").addEventListener("click", () => setSound(!soundEnabled));
    el("modal-close").addEventListener("click", () => el("modal").close());
    el("modal").addEventListener("click", (event) => { if (event.target === el("modal")) el("modal").close(); });
    document.addEventListener("keydown", handleKeyboard);
    window.addEventListener("pagehide", () => {
      clearInterval(timerId);
      callSdk("game.gameplayStop");
    });
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("mode") === "duel") startMatch("duel");
    else if (sdk()?.game?.inviteParams && sdk()?.game?.isInstantMultiplayer) {
      setTimeout(() => showToast("This build supports local duels; online room networking still needs a game server."), 500);
    }
  }

  document.addEventListener("DOMContentLoaded", init, { once: true });
})();
