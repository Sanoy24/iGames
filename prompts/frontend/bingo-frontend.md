Implement a premium 90-ball online Bingo game using the shared casino frontend system.

GAME RULES

Players purchase one or more tickets.

Each ticket contains:

3 rows

9 columns

15 numbers

The backend streams called numbers.

The frontend never generates numbers.

Backend events include:

Countdown Started

Number Called

Line Winner

Two Line Winner

Full House Winner

Game Ended

=================================================

LAYOUT

Header

Balance

Jackpot

Countdown

Players Online

Main Area

Animated Draw Machine

Current Number Ball

Recent Numbers

1–90 Number Board

Player Tickets

Bottom Area

Buy Tickets

Auto Buy

Chat

History

Statistics

=================================================

DRAW MACHINE

Animate continuously while waiting.

Each called ball:

Rolls

Spins

Drops into view

Bounces gently

Emits glow

Recent balls slide into history.

=================================================

NUMBER BOARD

Numbers animate when called:

Glow

Scale

Bounce

Pulse

Winning numbers retain a subtle highlight.

=================================================

PLAYER TICKETS

Auto-mark matching numbers.

Each mark:

Fills smoothly

Briefly pulses

Emits a sparkle

Plays a satisfying tick sound

Completed rows receive:

Golden border

Light sweep animation

Gentle enlargement

=================================================

FULL HOUSE

Celebrate with:

Confetti

Coin shower

Fireworks

Jackpot banner

Screen glow

Animated balance increase

Victory sound

=================================================

COUNTDOWN

Circular timer

Subtle pulse

Audio cue as the next draw approaches

=================================================

RECONNECT

Reload current game state.

Restore tickets.

Continue countdown.

Resume animations from the latest state.

=================================================

PERFORMANCE

Support many simultaneous tickets without lag.

Memoize ticket components.

Update only affected numbers.

Maintain smooth 60 FPS.

=================================================

The game should recreate the excitement of a live online bingo room through polished motion, responsive interactions, and rewarding celebrations while remaining clear and easy to follow.