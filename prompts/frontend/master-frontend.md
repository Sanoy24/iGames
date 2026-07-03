You are a Staff Frontend Engineer and Senior UI/UX Designer specializing in premium online casino platforms.

Build an enterprise-grade frontend framework that can power multiple casino games including Bingo, Keno, Crash, Mines, Dice, Roulette, Plinko, Wheel, Hi-Lo, and future games.

The platform should feel comparable in polish, responsiveness, and interaction quality to leading online casino products. The focus is on smooth animations, high responsiveness, and a cohesive design system. The backend is always authoritative for game outcomes.

=================================================
TECH STACK
=================================================

React 19
TypeScript
Vite
TailwindCSS

Framer Motion
Motion Layout Animations

TanStack Query

Zustand

React Hook Form

React Router

Howler.js (audio)

React Virtual

Floating UI

Heroicons or Lucide

=================================================
ARCHITECTURE
=================================================

Organize by feature.

src/

app/
components/
games/
hooks/
layouts/
pages/
services/
store/
styles/
types/
utils/

Each game owns its own components while sharing a common design system.

=================================================
DESIGN SYSTEM
=================================================

Premium dark casino aesthetic.

Floating cards

Soft shadows

Glassmorphism

Layered backgrounds

Subtle gradients

Animated glows

Rounded corners

High contrast

Responsive spacing

Consistent typography

Reusable component library

Button

Card

Modal

Dialog

Tooltip

Toast

Input

Slider

Tabs

Badge

Chip

Balance Display

Countdown

History Table

Statistics Card

Notification

Skeleton Loader

=================================================
ANIMATION PRINCIPLES
=================================================

Nothing changes instantly.

Every transition has motion.

Hover

scale 1.03

glow

Click

compress

spring back

Cards

lift

shadow expansion

Modals

fade

blur

scale

Pages

fade

slide

Balance

animated count

Numbers

rolling counter

History

stagger animation

Game Result

reveal animation

Win

confetti

coin rain

glow

Loss

small shake

quick fade

=================================================
FRAMER MOTION
=================================================

Use:

AnimatePresence

LayoutGroup

layout

layoutId

motion.div

variants

staggerChildren

spring transitions

GPU transforms only.

Never animate layout properties when transforms work.

=================================================
GAME STATE MACHINE
=================================================

Every game follows:

Idle

↓

Configuring Bet

↓

Waiting For Server

↓

Receiving Result

↓

Reveal Animation

↓

Celebration

↓

Finished

↓

Ready

Never skip transitions.

=================================================
SERVER COMMUNICATION
=================================================

Backend determines:

Result

Payout

Winning numbers

Cards

Draws

Multipliers

Jackpots

Frontend only visualizes.

Prevent duplicate requests.

Reconnect gracefully.

Resume interrupted games.

=================================================
LOADING EXPERIENCE
=================================================

Skeletons

Progress indicators

Animated dots

Shimmer

Button loading

No blank screens.

=================================================
SOUND
=================================================

Click

Hover

Countdown

Reveal

Win

Big Win

Jackpot

Cashout

Mute

Volume Slider

=================================================
PARTICLES
=================================================

Big wins

Sparkles

Coin rain

Fireworks

Floating glow

Dust

=================================================
PERFORMANCE
=================================================

Maintain 60fps.

Virtualize long lists.

Memoize expensive components.

Lazy load heavy assets.

Use sprites where useful.

Minimize rerenders.

GPU accelerated transforms.

=================================================
ACCESSIBILITY
=================================================

Keyboard navigation.

Screen reader labels.

High contrast mode.

Reduced motion support.

Focusable dialogs.

Visible focus states.

=================================================
RESPONSIVE
=================================================

Desktop

Tablet

Mobile

Landscape

Portrait

Touch optimized.

Large tap targets.

=================================================
COMMON COMPONENTS
=================================================

Top Navigation

Balance Widget

Wallet

Game History

Chat

Leaderboard

Settings

Notifications

Sound Controls

Bet Controls

Statistics

Countdown Timer

Footer

=================================================
VISUAL QUALITY
=================================================

Every interaction feels satisfying.

No abrupt UI updates.

Every win feels rewarding.

Every click gives feedback.

Every transition is polished.

The interface should feel alive but never distracting.

Code should be production-ready, modular, reusable, strongly typed, and easy to extend with additional games.