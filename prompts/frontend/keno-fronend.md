Implement a premium Keno game using the shared casino frontend system.

GAME RULES

Display a number grid (configurable, e.g., 1–80).

Allow players to select numbers.

Support Quick Pick.

Support Clear Selection.

Support Auto Pick.

Support configurable bet amount.

Support configurable risk level if required.

Backend returns:

Selected Numbers

Drawn Numbers

Hits

Multiplier

Payout

History

The frontend never generates results.

=================================================

LAYOUT

Header

Balance

Bet

Multiplier

Potential Win

Game Area

80 Number Grid

Quick Pick

Clear

Auto Play

Play Button

History

Statistics

=================================================

NUMBER GRID

Each tile:

Hover lift

Glow

Spring animation

Click bounce

Selected state glow

Winning state pulse

Miss state dim

Hit state explodes with particles

=================================================

DRAW ANIMATION

When backend responds:

Disable controls

Display "Drawing..."

Reveal numbers one at a time or in configurable batches.

Each revealed number:

Drops in

Spins slightly

Glows

Updates history

Highlights on the board

Matched selections emit sparkles and pulse.

=================================================

RESULTS

Misses gently fade.

Hits celebrate.

Winning multiplier animates upward.

Balance counts up.

Big wins trigger confetti and coin rain.

=================================================

AUTO PLAY

Configurable rounds

Stop on profit/loss

Pause/Resume

Animated progress indicator

=================================================

PERFORMANCE

Only rerender changed tiles.

Use memoization.

Maintain smooth 60 FPS.

=================================================

The experience should feel fast, premium, exciting, and visually satisfying.