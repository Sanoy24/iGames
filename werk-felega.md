# GAME DEVELOPMENT SPECIFICATION

# Title: ወርቅ ፍለጋ (Werk Flega — Gold Rush)

# Type: Multiplayer Browser-Based Maze Runner

---

## 1. PROJECT OVERVIEW

Build a complete, playable, browser-based multiplayer maze runner game named
**"ወርቅ ፍለጋ"** (Amharic for "Gold Hunt/Rush"). The game features a dynamically
generated maze where up to 100 players (human + AI bots) compete to collect
gold coins scattered throughout the maze. The maze size and complexity scales
automatically based on the number of active players.

The game must include:

- A **Player Lobby / Game View** (the actual maze game)
- An **Admin Dashboard** (separate screen/panel for game configuration)
- **Two winning modes** (configurable per game)
- **Prize distribution logic** with tie-handling
- **Amharic + English bilingual UI**

---

## 2. CORE GAME MECHANICS

### 2.1 The Maze

- Procedurally generated using **recursive backtracking** or **Prim's algorithm**
- **Regenerated from scratch** every new game (no two games are alike)
- **Dynamic sizing based on player count:**
  | Players | Maze Size | Complexity (extra openings %) |
  |---------|-----------|-------------------------------|
  | 1-10 | 16x16 | 12% |
  | 11-25 | 24x24 | 15% |
  | 26-50 | 32x32 | 18% |
  | 51-75 | 40x40 | 20% |
  | 76-100 | 48x48 | 22% |
- **Center cell** is always the "ገበታ / Center Hub" — a glowing golden zone
  where players must return in Mode B.
- Walls rendered in gold/brass color with Ethiopian cross motifs.
- Floor in cream/tan representing highland terrain.

### 2.2 Players

- **Human player** (always 1, controlled via keyboard)
- **AI bots** (0 to 99, configurable from admin portal)
- Each player has:
    - Unique ID, display name (Amharic + English), color
    - Position (x, y), velocity, radius
    - Inventory: coin count, special items collected
    - State: `playing`, `running_to_center`, `eliminated`, `finished`
- Player rendering: circular avatar with shield-pattern design, colored per
  player, with name tag floating above.

### 2.3 Coins (ወርቅ ሳንቲም)

- Scattered randomly across the maze at game start
- **Coin count scales with maze size:** roughly `mazeWidth * mazeHeight * 0.15`
- Three coin types with different values:
  | Type | Amharic | Value | Color | Spawn Weight |
  |----------------|-------------|-------|---------|--------------|
  | Bronze Coin | ነሃስ ሳንቲም | 1 | #cd7f32 | 60% |
  | Silver Coin | ብር ሳንቲም | 5 | #c0c0c0 | 30% |
  | Gold Coin | ወርቅ ሳንቲም | 25 | #FFD700 | 10% |
- Coins bob up and down with a sine wave animation
- Glow effect colored by rarity
- **Collected coins disappear** and are NOT respawned (finite pool)
- Collection radius: player touches coin → auto-collect with sound + particle burst

### 2.4 Special Items (Optional Power-ups)

- **Speed Boost (ፍጥነት)** — 5 seconds of 1.5x speed (rare spawn)
- **Coin Magnet (ማግኔት)** — attracts nearby coins for 8 seconds (rare spawn)
- **Shield (ጋሻ)** — prevents losing coins once for 10 seconds (very rare)
- These spawn at ~5% of coin spawn locations

### 2.5 Movement & Controls (Human Player)

- **WASD** or **Arrow Keys**: Move
- **Shift**: Sprint (limited stamina bar, 100 max, drains 30/sec, regens 20/sec)
- **E**: Interact / manual collect
- **Space**: Use active power-up
- **M**: Toggle minimap
- Movement uses circle-vs-wall collision with sliding (try full move, then
  X-only, then Y-only, else stay)
- Human speed: 150 px/sec base
- AI speed: 80-90% of human speed (fair challenge)

---

## 3. WINNING SCHEMES (Admin-Configurable)

The admin portal lets the host choose ONE of two winning modes per game:

### MODE A: "የበለጠ ሰብሳቢ" (Most Coins Collector)

- Pure collection mode
- Game runs for the full configured time
- At time end, rank all players by total coin value
- **Top 3 win prizes** (prize amounts configurable)
- **TIE RULE**: If two or more players have equal coin value at a prize rank,
  they **split that prize equally**. Example: if players A, B, C all tie for
  1st place with 500 coins each, they split the 1st-place prize 3 ways.
- Players can keep collecting until the timer hits 0

### MODE B: "የጊዜ ፍልሚያ" (Time Race — Final Sprint)

- Game runs for configured time
- **7 seconds before time ends**, a loud horn sounds and the center hub
  begins pulsing urgently
- All players must **reach the center cell** before the timer hits 0
- **Elimination**: Any player NOT inside the center cell when time = 0 is
  **eliminated** and wins NOTHING, regardless of coin count
- **Among survivors** (those who made it to center on time):
    - Rank by coin value
    - Top 3 win prizes
    - Same tie-splitting rule as Mode A
- Strategy implication: players must balance collecting vs. positioning
  themselves close to center as the final seconds approach

### 2nd Timer (Final Sprint Timer)

- In Mode B, when `timeLeft <= 7`, show a **large red countdown overlay**
  (7, 6, 5, 4, 3, 2, 1, ጊዜ አልቋል!)
- Center hub pulses red and emits warning particles
- Horn sound plays at 7s, 3s, and 0s
- Players' UI shows a directional arrow pointing to center

---

## 4. PRIZE DISTRIBUTION LOGIC

It will be configured from Dashboard. We can have 5 prizes we put the percentage based on their winning position. [the same as bingo configuration]

**Example scenarios:**

- Clear 1-2-3: Player A (500), B (400), C (300) → A gets rank1, B rank2, C rank3
- Tie for 1st: A (500), B (500), C (300) → A & B split rank1 prize, C gets rank3
- Tie for 1st with 3: A (500), B (500), C (500) → all 3 split rank1 prize; no rank2 or rank3 awarded
- Tie across 1st and 2nd: A (500), B (500), C (500), D (400) → A,B,C split rank1; D gets rank2 (rank3 skipped)

---

## 5. ADMIN DASHBOARD

A separate screen/panel accessible via a button on the title screen.
**Password protection optional** (simple PIN gate is fine).

### 5.1 Configuration Fields

| Field                    | Type   | Default | Description                             |
| ------------------------ | ------ | ------- | --------------------------------------- |
| Game Name                | text   | ወርቅ ፍለጋ | Display name for the game               |
| Total Players            | number | 10      | 1-100 (humans + bots)                   |
| Human Players            | number | 1       | 1-4 (local shared keyboard or reserved) |
| Bot Count                | number | 9       | Auto = Total - Human                    |
| Bot Seed Mode            | select | auto    | "auto" / "zero" / "custom"              |
| Game Duration (seconds)  | number | 120     | 30-600                                  |
| Winning Mode             | select | A       | "A: Most Coins" / "B: Final Sprint"     |
| Final Sprint Warning (s) | number | 7       | 3-15 (only used in Mode B)              |
| 1st Place Prize          | number | 1000    | Currency units                          |
| 2nd Place Prize          | number | 500     | Currency units                          |
| 3rd Place Prize          | number | 250     | Currency units                          |
| Coin Density             | slider | 0.15    | 0.05-0.30 (coins per cell)              |
| Power-up Spawns          | toggle | ON      | Enable/disable special items            |
| Maze Theme               | select | adwa    | "adwa" / "highland" / "desert"          |

### 5.2 Bot Behavior Configuration

- **Bot Count**: 0 to (Total - Human)
- **Bot Seed Mode**:
    - `auto`: AI fills remaining slots with varied strategies
    - `zero`: No bots at all (pure human or empty seats)
    - `custom`: Admin picks exact bot personalities
- **Bot Personalities** (when auto or custom):
    - **Gatherer (ሰብሳቢ)**: Nearest-coin greedy, baseline strategy
    - **Sniper (ተወዳዳሪ)**: Targets only high-value gold coins
    - **Strategist (ስትራቴጂስት)**: In Mode B, starts heading to center at warning time
    - **Explorer (ፈላጊ)**: Visits unexplored cells first, then collects
    - **Chaotic (ዘፈቀደ)**: Random walk, acts as filler/noise
- Each bot has a visible name from a pool of Amharic names

### 5.3 Live Admin Controls (during game)

- Pause / Resume game
- Add/remove bots mid-game
- Force end game
- Broadcast message to all players
- View live leaderboard

---

## 6. USER INTERFACE LAYOUT

### 6.1 Title Screen

- Large title "ወርቅ ፍለጋ" with golden glow
- Subtitle "Gold Rush" in English
- Ethiopian flag tricolor bar (green/yellow/red)
- Buttons:
    - **ጨዋታ ጀምር / Start Game** → goes to lobby
    - **አስተዳዳሪ ፖርታል / Admin Portal** → goes to admin dashboard
    - **እንዴት ይጫወታሉ / How to Play** → shows rules modal
- Animated background: slowly rotating gold coins or maze preview

### 6.2 Game HUD (during gameplay)

- **Top-left**: Minimap (180x180px) showing maze, players, coins, center hub
- **Top-right**: Live leaderboard (top 10 players with name, color, coin value)
- **Bottom-left**: Player's personal stats:
    - Coin count with breakdown (bronze/silver/gold)
    - Total value
    - Stamina bar
    - Active power-ups with timers
- **Bottom-center**: Main timer (large, prominent)
    - In Mode B, turns red and pulses when `timeLeft <= finalSprintWarning`
- **Bottom-right**: Position indicator ("Rank: #X of Y")
- **Center overlay** (Mode B only): When `timeLeft <= 7`, show huge countdown

### 6.3 Victory Screen

- Winner announcement with podium (1st, 2nd, 3rd)
- Detailed prize distribution table showing tie splits
- Full leaderboard
- Player's personal stats
- Buttons: **ጨዋታ አዲስ / New Game** and **ወደ ዋና ስክሪን / Main Menu**
- Confetti particle effect in Ethiopian flag colors

---

## 7. AI BOT BEHAVIOR

### 7.1 Pathfinding

- Use **BFS** (Breadth-First Search) for shortest path between cells
- Cache paths where possible; recompute when target changes
- Bots move toward cell centers, not pixel-perfect

### 7.2 Decision Loop (runs every 1-2 seconds per bot)

    // Score each coin
    for coin in candidates:
        pathLen = bfs(bot.cell, coin.cell).length
        score = coin.value - pathLen * 0.5

        // Personality modifiers
        if bot.personality == 'sniper':
            score += coin.value * 0.5
        if bot.personality == 'strategist' and timeLeft < 30:
            distToCenter = bfs(coin.cell, centerCell).length
            score -= distToCenter * 0.3

    target = candidates.maxBy(score)

bot.currentPath = bfs(bot.cell, target.cell)

### 7.3 Bot Movement

- Follow path cell-by-cell
- Speed = `humanSpeed * (0.80 + random * 0.10)` (varied per bot)
- Auto-collect coins walked over
- Stuck detection: if position unchanged for 1.5s, recompute path

---

## 8. VISUAL STYLE

### 8.1 Color Palette

- Background: Deep green `#006B3F` with radial gradient
- Walls: Gold `#D4A017` with darker edge shading
- Floor: Cream `#F5E6A3` with subtle highland texture
- Coins: Bronze `#cd7f32`, Silver `#c0c0c0`, Gold `#FFD700`
- UI accents: Ethiopian flag colors (green/yellow/red)
- Center hub: Pulsing golden glow with star symbol ★

### 8.2 Animations

- Coins bob vertically (sine wave, 3Hz)
- Center hub pulses (scale + glow intensity, 2Hz)
- Player collection: particle burst in coin color, 12 particles
- Victory: confetti shower in flag colors, 200 particles
- Final sprint warning (Mode B): red pulse overlay, screen shake

### 8.3 Typography

- Primary: System Ethiopic fonts (`Noto Sans Ethiopic`, `Nyala`, fallback sans-serif)
- All UI text bilingual: Amharic primary, English secondary in smaller font
- Numbers use Western digits for readability

---

## 9. AUDIO (Web Audio API — Synthesized)

No external audio files. All sounds synthesized:

- **Coin pickup**: Rising triangle wave (880Hz → 1320Hz), 80ms
- **Gold coin pickup**: Richer chord (523+659+784Hz), 150ms
- **Footstep**: Soft noise burst, low volume
- **Final sprint horn** (Mode B): Sawtooth 180Hz → 260Hz, 900ms
- **Countdown beeps**: Sine 440Hz, 100ms each
- **Victory fanfare**: Ascending arpeggio C-E-G-C
- **Master mute toggle** in top-right corner

---
