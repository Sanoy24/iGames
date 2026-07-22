import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { recordShot, buildTable, buildTuning, DEFAULT_PHYSICS } from '../lib/poolEngine';
import type { Ball, ShotEvent, ShotInput, TableSpec } from '../lib/poolEngine';
import type { PoolMatchView, Seat } from '../lib/poolApi';
import { resumeAudio, ballClick, cushionHit, pocketDrop, cueStrike } from '../lib/poolSfx';

export interface PoolTableHandle {
  /** Animate a shot (deterministic replay) from the current displayed board. */
  enqueueShot: (input: ShotInput) => void;
}

interface Props {
  view: PoolMatchView;
  mySeat: Seat | null;
  canShoot: boolean;
  onSubmit: (input: ShotInput) => void;
  /** 'portrait' renders the table vertically (long axis down-screen) so it fills a phone. */
  orientation?: 'portrait' | 'landscape';
  /** True when the shooter must call a pocket before shooting (on the 8, or strict mode). */
  mustCall?: boolean;
}

const BALL_COLORS: Record<number, string> = {
  1: '#e6b422', 2: '#1f4fa0', 3: '#c62828', 4: '#6a3d9a', 5: '#e2711d',
  6: '#1f7a3f', 7: '#7a2418', 8: '#141414',
  9: '#e6b422', 10: '#1f4fa0', 11: '#c62828', 12: '#6a3d9a', 13: '#e2711d', 14: '#1f7a3f', 15: '#7a2418',
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const hexToRgb = (h: string) => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const lighten = (h: string, a: number) => { const [r, g, b] = hexToRgb(h); return `rgb(${(r + (255 - r) * a) | 0},${(g + (255 - g) * a) | 0},${(b + (255 - b) * a) | 0})`; };
const darken = (h: string, a: number) => { const [r, g, b] = hexToRgb(h); return `rgb(${(r * (1 - a)) | 0},${(g * (1 - a)) | 0},${(b * (1 - a)) | 0})`; };

const NUDGE_STEP = 0.006; // radians (~0.34°) per fine-aim tick

interface Anim {
  frames: Array<Array<{ x: number; y: number; pocketed: boolean }>>;
  frameDt: number;
  time: number;   // playback time in seconds (matches event.t at 1x)
  last: number;   // performance.now() of the previous frame
  events: ShotEvent[];
  firedIdx: number;
  vel: Array<{ x: number; y: number }>; // per-ball speed for motion trails
  final?: Ball[];
}
interface Ring { pocketIndex: number; start: number; }

export const PoolTable = forwardRef<PoolTableHandle, Props>(function PoolTable(
  { view, canShoot, onSubmit, orientation = 'portrait', mustCall = false },
  ref,
) {
  const cv = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const spinCv = useRef<HTMLCanvasElement>(null);
  const powerRef = useRef<HTMLDivElement>(null);

  // Live mutable state kept in refs so the animation loop never triggers re-renders.
  const table = useRef<TableSpec>(buildTable(DEFAULT_PHYSICS));
  const tuning = useRef(buildTuning(DEFAULT_PHYSICS));
  const balls = useRef<Ball[]>([]);
  const anim = useRef<Anim | null>(null);
  // `preroll` shows an aim + pull-back before the strike — used for the opponent/AI
  // so their stroke is visible; our own shots (already aimed + charged) skip it.
  const queue = useRef<{ input: ShotInput; preroll: boolean }[]>([]);
  const preShot = useRef<{ input: ShotInput; start: number; from: { x: number; y: number } } | null>(null);
  const rings = useRef<Ring[]>([]); // pocket-drop flashes
  const aim = useRef(0);
  const power = useRef(0);
  const spin = useRef({ side: 0, vertical: 0 });
  const aiming = useRef(false);
  const charging = useRef(false);
  const viewRef = useRef(view);
  const canShootRef = useRef(canShoot);
  const onSubmitRef = useRef(onSubmit);
  // Ball-in-hand: drag the cue ball to a legal spot; it rides along as `cuePos`.
  const bihActive = useRef(false);
  const placing = useRef(false);
  const placedCue = useRef<{ x: number; y: number } | null>(null);
  // Call-shot: the player must tap a pocket to call it before shooting.
  const mustCallRef = useRef(false);
  const calledPocket = useRef<number | null>(null);

  const geom = useRef({ rail: 16, scale: 340, rotated: false });

  // Power slider is DOM, so its fill/knob need a little React state to repaint.
  const [powerPct, setPowerPct] = useState(0);
  const [calledPocketUI, setCalledPocketUI] = useState<number | null>(null);

  useEffect(() => { onSubmitRef.current = onSubmit; });
  useEffect(() => {
    mustCallRef.current = mustCall;
    if (!mustCall) { calledPocket.current = null; setCalledPocketUI(null); }
  }, [mustCall]);

  // Keep refs in sync with props; snap to the authoritative board when idle.
  useEffect(() => {
    viewRef.current = view;
    canShootRef.current = canShoot;
    bihActive.current = canShoot && view.ballInHand;
    table.current = buildTable(view.physics ?? DEFAULT_PHYSICS);
    tuning.current = buildTuning(view.physics ?? DEFAULT_PHYSICS);
    if (!anim.current && queue.current.length === 0) {
      balls.current = view.board.map((b) => ({ ...b, pos: { ...b.pos }, vel: { ...b.vel }, spin: { ...b.spin } }));
      placedCue.current = null;
    }
  }, [view, canShoot]);

  useImperativeHandle(ref, () => ({
    enqueueShot: (input: ShotInput) => {
      queue.current.push({ input, preroll: true }); // opponent/AI — show the stroke
    },
  }), []);

  // Fire the current aim+power+spin as a shot (called on power-slider release).
  const fireShot = (p: number) => {
    if (!canShootRef.current || anim.current) return;
    const input: ShotInput = { angle: aim.current, power: p, spin: { ...spin.current } };
    if (placedCue.current) input.cuePos = { ...placedCue.current };
    if (mustCallRef.current && calledPocket.current != null) input.calledPocket = calledPocket.current;
    queue.current.push({ input, preroll: false }); // mine — already aimed, strike now
    onSubmitRef.current(input);
    placedCue.current = null;
  };

  // ── main canvas: table render + drag-to-aim + ball-in-hand placement ─────────
  useEffect(() => {
    const canvas = cv.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rotated = orientation === 'portrait';
    let raf = 0;

    // World→screen. In portrait we transpose (world width → screen vertical) so the
    // long side of the table runs down the phone, making it much bigger.
    const px = (pt: { x: number; y: number }) => geom.current.rail + (rotated ? pt.y : pt.x) * geom.current.scale;
    const py = (pt: { x: number; y: number }) => geom.current.rail + (rotated ? pt.x : pt.y) * geom.current.scale;
    // World direction → screen direction (transpose swaps the axes).
    const sdir = (dx: number, dy: number) => (rotated ? { x: dy, y: dx } : { x: dx, y: dy });

    const layout = () => {
      const wrap = wrapRef.current;
      const availW = wrap?.clientWidth ?? canvas.clientWidth;
      const availH = wrap?.clientHeight ?? availW;
      const t = table.current;
      const tw = rotated ? t.height : t.width;   // table extent along screen-x (world units)
      const th = rotated ? t.width : t.height;   // table extent along screen-y
      const rail = Math.max(8, Math.round(Math.min(availW, availH) * 0.035));
      const scale = Math.max(1, Math.min((availW - rail * 2) / tw, (availH - rail * 2) / th));
      const cssW = tw * scale + rail * 2;
      const cssH = th * scale + rail * 2;
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      geom.current = { rail, scale, rotated };
    };

    const br = () => table.current.ballRadius * geom.current.scale;

    const roundRect = (x: number, y: number, w: number, h: number, r: number) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    };

    const drawTable = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight, t = table.current;
      const { rail } = geom.current;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#3b2416';
      roundRect(0, 0, w, h, 14); ctx.fill();
      const g = ctx.createRadialGradient(w / 2, h / 2, 40, w / 2, h / 2, Math.max(w, h) * 0.62);
      g.addColorStop(0, '#1a8a63'); g.addColorStop(0.7, '#157a58'); g.addColorStop(1, '#0e5c42');
      ctx.fillStyle = g;
      roundRect(rail * 0.5, rail * 0.5, w - rail, h - rail, 8); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = 3;
      roundRect(rail, rail, w - rail * 2, h - rail * 2, 4); ctx.stroke();
      for (const p of t.pockets) {
        const pr = t.pocketRadius * geom.current.scale * 1.05;
        ctx.beginPath(); ctx.arc(px(p), py(p), pr, 0, 7); ctx.fillStyle = '#080605'; ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = '#d9a441';
        ctx.beginPath(); ctx.arc(px(p), py(p), pr + 1.5, 0, 7); ctx.stroke();
      }
    };

    const drawBall = (b: Ball, radius: number) => {
      const cx = px(b.pos), cy = py(b.pos), r = radius;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(cx + r * 0.28, cy + r * 0.42, r * 0.98, r * 0.7, 0, 0, 7); ctx.fill();
      const base = b.number === 0 ? '#f4efe4' : BALL_COLORS[b.number] || '#ccc';
      const body = b.kind === 'stripe' ? '#f2ecdf' : base;
      const grad = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.15, cx, cy, r);
      grad.addColorStop(0, lighten(body, 0.5)); grad.addColorStop(0.55, body); grad.addColorStop(1, darken(body, 0.32));
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill();
      if (b.kind === 'stripe') {
        ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.clip();
        ctx.fillStyle = base; ctx.fillRect(cx - r, cy - r * 0.5, r * 2, r); ctx.restore();
      }
      if (b.number !== 0) {
        ctx.fillStyle = '#fbf7ee'; ctx.beginPath(); ctx.arc(cx, cy, r * 0.42, 0, 7); ctx.fill();
        ctx.fillStyle = '#1a1712';
        ctx.font = `600 ${Math.max(7, r * 0.6)}px ui-monospace, monospace`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(b.number), cx, cy + r * 0.03);
      }
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath(); ctx.ellipse(cx - r * 0.34, cy - r * 0.4, r * 0.26, r * 0.18, -0.6, 0, 7); ctx.fill();
    };

    // Predict first contact (ball or rail) purely in world space.
    const predict = (cue: Ball) => {
      const t = table.current, R = t.ballRadius;
      const dir = { x: Math.cos(aim.current), y: Math.sin(aim.current) };
      let best = Infinity, hit: { kind: 'ball' | 'rail'; ball?: Ball } | null = null;
      for (const b of balls.current) {
        if (b.pocketed || b.number === 0) continue;
        const fx = cue.pos.x - b.pos.x, fy = cue.pos.y - b.pos.y;
        const bq = dir.x * fx + dir.y * fy;
        const cq = fx * fx + fy * fy - (2 * R) * (2 * R);
        const disc = bq * bq - cq;
        if (disc < 0) continue;
        const tt = -bq - Math.sqrt(disc);
        if (tt > 1e-4 && tt < best) { best = tt; hit = { kind: 'ball', ball: b }; }
      }
      const rails = [
        dir.x < 0 ? (R - cue.pos.x) / dir.x : Infinity,
        dir.x > 0 ? (t.width - R - cue.pos.x) / dir.x : Infinity,
        dir.y < 0 ? (R - cue.pos.y) / dir.y : Infinity,
        dir.y > 0 ? (t.height - R - cue.pos.y) / dir.y : Infinity,
      ];
      for (const tt of rails) if (tt > 1e-4 && tt < best) { best = tt; hit = { kind: 'rail' }; }
      if (!hit) return null;
      return { dir, contact: { x: cue.pos.x + dir.x * best, y: cue.pos.y + dir.y * best }, hit };
    };

    const drawAim = (cue: Ball) => {
      const dir = { x: Math.cos(aim.current), y: Math.sin(aim.current) };
      const sd = sdir(dir.x, dir.y);
      const cx = px(cue.pos), cy = py(cue.pos), r = br();
      const p = predict(cue);
      ctx.save();
      ctx.setLineDash([6, 6]); ctx.strokeStyle = 'rgba(244,239,228,0.6)'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(cx, cy);
      const end = p ? { x: px(p.contact), y: py(p.contact) } : { x: cx + sd.x * 800, y: cy + sd.y * 800 };
      ctx.lineTo(end.x, end.y); ctx.stroke(); ctx.setLineDash([]);
      if (p && p.hit.kind === 'ball' && p.hit.ball) {
        ctx.strokeStyle = 'rgba(244,239,228,0.55)';
        ctx.beginPath(); ctx.arc(end.x, end.y, r, 0, 7); ctx.stroke();
        const ob = p.hit.ball;
        const odx = ob.pos.x - p.contact.x, ody = ob.pos.y - p.contact.y;
        const ol = Math.hypot(odx, ody) || 1;
        const od = sdir(odx / ol, ody / ol);
        ctx.strokeStyle = 'rgba(217,164,65,0.9)'; ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.moveTo(px(ob.pos), py(ob.pos));
        ctx.lineTo(px(ob.pos) + od.x * 52, py(ob.pos) + od.y * 52); ctx.stroke();
      }
      ctx.restore();
      // cue stick, pulled back by the charged power
      const pull = 14 + power.current * 90;
      const gap = r + 4;
      const bx = cx - sd.x * gap, by = cy - sd.y * gap;
      const ex = cx - sd.x * (gap + 150 + pull), ey = cy - sd.y * (gap + 150 + pull);
      const grd = ctx.createLinearGradient(bx, by, ex, ey);
      grd.addColorStop(0, '#e8d9b4'); grd.addColorStop(0.06, '#caa46a'); grd.addColorStop(1, '#6b4a24');
      ctx.strokeStyle = grd; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ex, ey); ctx.stroke();
    };

    const drawPlacementHint = (cue: Ball) => {
      const cx = px(cue.pos), cy = py(cue.pos), r = br();
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 400);
      ctx.save();
      ctx.setLineDash([4, 5]);
      ctx.strokeStyle = `rgba(110,231,183,${0.45 + 0.4 * pulse})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, r + 5 + pulse * 2, 0, 7); ctx.stroke();
      ctx.restore();
    };

    // On the 8: mark each pocket as a call target; the chosen one glows gold.
    const drawPocketTargets = () => {
      const t = table.current;
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 350);
      for (let i = 0; i < t.pockets.length; i++) {
        const pk = t.pockets[i];
        const cx = px(pk), cy = py(pk);
        const rad = t.pocketRadius * geom.current.scale * 1.5;
        const chosen = calledPocket.current === i;
        ctx.save();
        ctx.lineWidth = chosen ? 4 : 2.5;
        ctx.strokeStyle = chosen ? '#f6c945' : `rgba(246,201,69,${0.35 + 0.35 * pulse})`;
        ctx.beginPath(); ctx.arc(cx, cy, rad, 0, 7); ctx.stroke();
        if (chosen) {
          ctx.fillStyle = 'rgba(246,201,69,0.18)';
          ctx.beginPath(); ctx.arc(cx, cy, rad, 0, 7); ctx.fill();
          ctx.fillStyle = '#f6c945';
          ctx.font = '700 12px ui-sans-serif, system-ui';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('★', cx, cy);
        }
        ctx.restore();
      }
    };

    const PRE_MS = 480; // aim + pull-back shown before a queued shot strikes
    const PLACE_FRAC = 0.45; // first part of the pre-roll glides the cue to its ball-in-hand spot

    // A little hand marker shown while the AI slides the cue ball into place.
    const drawHand = (cue: Ball) => {
      const cx = px(cue.pos), cy = py(cue.pos), r = br();
      ctx.save();
      ctx.font = `${Math.max(14, r * 1.7)}px serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('✋', cx + r * 1.1, cy - r * 1.1);
      ctx.restore();
    };

    const strike = (input: ShotInput) => {
      power.current = 0;
      const rec = recordShot(balls.current, input, table.current, { tuning: tuning.current });
      resumeAudio();
      cueStrike(input.power);
      anim.current = {
        frames: rec.frames,
        frameDt: rec.frameDt,
        time: 0,
        last: performance.now(),
        events: rec.result.events,
        firedIdx: 0,
        vel: balls.current.map(() => ({ x: 0, y: 0 })),
        final: rec.result.balls,
      };
    };

    // Play a shot event's sound + trigger a pocket flash.
    const playEvent = (e: ShotEvent) => {
      if (e.type === 'ball-ball') ballClick(1);
      else if (e.type === 'ball-cushion') cushionHit(1);
      else if (e.type === 'pocket' || e.type === 'scratch') {
        pocketDrop();
        if (e.pocketIndex != null) rings.current.push({ pocketIndex: e.pocketIndex, start: performance.now() });
      }
    };

    const drawFrame = (now: number) => {
      // Pop the next queued shot: opponent shots get a pre-roll (glide the cue into
      // place if ball-in-hand, then pull back); ours strike immediately.
      if (!anim.current && !preShot.current && queue.current.length > 0) {
        const { input, preroll } = queue.current.shift()!;
        const c = balls.current.find((b) => b.number === 0);
        const from = c ? { x: c.pos.x, y: c.pos.y } : { x: 0, y: 0 };
        aim.current = input.angle;
        if (preroll) {
          preShot.current = { input, start: now, from };
        } else {
          if (input.cuePos && c) { c.pos.x = input.cuePos.x; c.pos.y = input.cuePos.y; }
          strike(input);
        }
      }
      // Pull-back done → strike.
      if (preShot.current && now - preShot.current.start >= PRE_MS) {
        const input = preShot.current.input;
        preShot.current = null;
        strike(input);
      }

      if (anim.current) {
        const a = anim.current;
        const dtReal = Math.min(0.05, (now - a.last) / 1000);
        a.last = now; a.time += dtReal;
        const total = (a.frames.length - 1) * a.frameDt;
        // A malformed/degenerate recording (fewer than 2 frames, or a non-finite
        // duration) must not stall on a stale frame forever — treat it as done so
        // we snap back to the authoritative board instead of freezing the table.
        const done = a.frames.length < 2 || !Number.isFinite(total) || a.time >= total;
        const clamped = Number.isFinite(total) ? Math.min(a.time, total) : 0;
        // Interpolate between the two nearest recorded frames for buttery motion.
        const fpRaw = clamped / a.frameDt;
        const fp = Number.isFinite(fpRaw) ? fpRaw : 0;
        const lo = Math.min(Math.max(0, Math.floor(fp)), a.frames.length - 1);
        const hi = Math.min(lo + 1, a.frames.length - 1);
        const frac = fp - lo;
        const f0 = a.frames[lo], f1 = a.frames[hi];
        if (f0 && f1) {
          balls.current.forEach((b, idx) => {
            const p0 = f0[idx], p1 = f1[idx];
            if (!p0 || !p1) return;
            const nx = p0.x + (p1.x - p0.x) * frac;
            const ny = p0.y + (p1.y - p0.y) * frac;
            // Never write a non-finite position: it would throw inside the canvas
            // gradient/arc calls below and kill the entire render loop.
            if (!Number.isFinite(nx) || !Number.isFinite(ny)) return;
            a.vel[idx] = { x: (p1.x - p0.x) / a.frameDt, y: (p1.y - p0.y) / a.frameDt };
            b.pos.x = nx; b.pos.y = ny; b.pocketed = p1.pocketed;
          });
        }
        // Fire sounds for events reached by the current playback time.
        while (a.firedIdx < a.events.length && a.events[a.firedIdx].t <= a.time) {
          playEvent(a.events[a.firedIdx]); a.firedIdx++;
        }
        if (done) {
          if (a.final) balls.current = a.final.map((b) => ({ ...b, pos: { ...b.pos }, vel: { ...b.vel }, spin: { ...b.spin } }));
          anim.current = null;
          if (queue.current.length === 0) {
            balls.current = viewRef.current.board.map((b) => ({ ...b, pos: { ...b.pos }, vel: { ...b.vel }, spin: { ...b.spin } }));
          }
        }
      }

      drawTable();
      const r = br();
      const cue = balls.current.find((b) => b.number === 0);
      if (preShot.current && cue && !cue.pocketed) {
        const ps = preShot.current;
        const prog = Math.min(1, (now - ps.start) / PRE_MS);
        let pullStart = 0;
        if (ps.input.cuePos) {
          // First: slide the cue ball from where it was to the placement spot.
          const placeProg = Math.min(1, prog / PLACE_FRAC);
          cue.pos.x = ps.from.x + (ps.input.cuePos.x - ps.from.x) * placeProg;
          cue.pos.y = ps.from.y + (ps.input.cuePos.y - ps.from.y) * placeProg;
          if (placeProg < 1) drawHand(cue);
          pullStart = PLACE_FRAC;
        }
        // Then: pull the cue back proportional to power.
        const pullProg = Math.max(0, Math.min(1, (prog - pullStart) / (1 - pullStart)));
        power.current = ps.input.power * pullProg;
        drawAim(cue);
      } else if (!anim.current && queue.current.length === 0 && canShootRef.current && cue && !cue.pocketed) {
        if (mustCallRef.current) drawPocketTargets();
        if (bihActive.current) drawPlacementHint(cue);
        drawAim(cue);
      }

      // Motion trails: a soft streak behind each fast-moving ball.
      const a = anim.current;
      if (a) {
        ctx.save();
        ctx.lineCap = 'round';
        balls.current.forEach((b, idx) => {
          if (b.pocketed) return;
          const v = a.vel[idx]; if (!v) return;
          const spd = Math.hypot(v.x, v.y);
          if (spd < 0.25) return;
          const len = Math.min(r * 2.6, spd * 0.02 * geom.current.scale);
          const ux = v.x / spd, uy = v.y / spd;
          const sd = sdir(ux, uy);
          const cx = px(b.pos), cy = py(b.pos);
          const grad = ctx.createLinearGradient(cx - sd.x * len, cy - sd.y * len, cx, cy);
          const col = b.number === 0 ? '255,255,255' : '255,240,200';
          grad.addColorStop(0, `rgba(${col},0)`);
          grad.addColorStop(1, `rgba(${col},0.28)`);
          ctx.strokeStyle = grad;
          ctx.lineWidth = r * 1.5;
          ctx.beginPath(); ctx.moveTo(cx - sd.x * len, cy - sd.y * len); ctx.lineTo(cx, cy); ctx.stroke();
        });
        ctx.restore();
      }

      for (const b of balls.current) { if (!b.pocketed) drawBall(b, r); }

      // Pocket-drop flashes: an expanding fading ring at the pocket.
      if (rings.current.length > 0) {
        const RING_MS = 360;
        ctx.save();
        rings.current = rings.current.filter((ring) => {
          const age = now - ring.start;
          if (age > RING_MS) return false;
          const p = age / RING_MS;
          const pk = table.current.pockets[ring.pocketIndex];
          if (!pk) return false;
          const rad = table.current.pocketRadius * geom.current.scale * (1.1 + p * 1.6);
          ctx.strokeStyle = `rgba(246,201,69,${0.5 * (1 - p)})`;
          ctx.lineWidth = 3 * (1 - p) + 0.5;
          ctx.beginPath(); ctx.arc(px(pk), py(pk), rad, 0, 7); ctx.stroke();
          return true;
        });
        ctx.restore();
      }
    };

    // The render loop must survive a bad frame. `render` only reschedules itself
    // at its own tail, so a single uncaught throw inside `drawFrame` (e.g. a
    // canvas call fed a non-finite value) would silently kill the loop and freeze
    // the whole table while React keeps updating turns/score around it. Instead we
    // catch, log once, drop transient animation state, and snap to the server's
    // authoritative board — the game stays live and correct, just skips one shot's
    // animation. The console error is intentionally preserved to surface the cause.
    let errorLogged = false;
    const render = (now: number) => {
      try {
        drawFrame(now);
      } catch (e) {
        if (!errorLogged) {
          errorLogged = true;
          console.error('[pool] render frame failed — recovering to authoritative board', e);
        }
        anim.current = null;
        preShot.current = null;
        queue.current = [];
        try {
          balls.current = viewRef.current.board.map(
            (b) => ({ ...b, pos: { ...b.pos }, vel: { ...b.vel }, spin: { ...b.spin } }),
          );
        } catch { /* board unavailable — keep the last good frame */ }
      }
      raf = requestAnimationFrame(render);
    };

    // ── pointer: drag on the table to aim; grab the cue ball to place it ────────
    const toCanvas = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const toWorld = (sxv: number, syv: number) => {
      const { rail, scale } = geom.current;
      return rotated
        ? { x: (syv - rail) / scale, y: (sxv - rail) / scale }
        : { x: (sxv - rail) / scale, y: (syv - rail) / scale };
    };
    const cueBall = () => balls.current.find((b) => b.number === 0);

    const updatePlace = (e: PointerEvent) => {
      const cue = cueBall(); if (!cue || cue.pocketed) return;
      const t = table.current, R = t.ballRadius;
      const p = toCanvas(e); const w = toWorld(p.x, p.y);
      const cx = clamp(w.x, R, t.width - R);
      const cy = clamp(w.y, R, t.height - R);
      const clash = balls.current.some(
        (b) => b.number !== 0 && !b.pocketed && Math.hypot(b.pos.x - cx, b.pos.y - cy) < 2 * R,
      );
      if (clash) return;
      cue.pos.x = cx; cue.pos.y = cy;
      placedCue.current = { x: cx, y: cy };
    };

    // Point the cue from the ball toward the touch point (absolute aim).
    const updateAim = (e: PointerEvent) => {
      const cue = cueBall(); if (!cue || cue.pocketed) return;
      const p = toCanvas(e); const w = toWorld(p.x, p.y);
      const dx = w.x - cue.pos.x, dy = w.y - cue.pos.y;
      if (Math.hypot(dx, dy) < table.current.ballRadius * 0.6) return; // ignore taps on the ball
      aim.current = Math.atan2(dy, dx);
    };

    const onDown = (e: PointerEvent) => {
      resumeAudio();
      if (!canShootRef.current || anim.current) return;
      const cue = cueBall();
      if (bihActive.current && cue && !cue.pocketed) {
        const p = toCanvas(e); const w = toWorld(p.x, p.y);
        if (Math.hypot(w.x - cue.pos.x, w.y - cue.pos.y) <= 2.4 * table.current.ballRadius) {
          canvas.setPointerCapture(e.pointerId);
          placing.current = true;
          updatePlace(e);
          return;
        }
      }
      // Call-shot: tapping near a pocket calls it (rather than aiming).
      if (mustCallRef.current) {
        const p = toCanvas(e); const w = toWorld(p.x, p.y);
        const t = table.current;
        for (let i = 0; i < t.pockets.length; i++) {
          const pk = t.pockets[i];
          if (Math.hypot(w.x - pk.x, w.y - pk.y) <= t.pocketRadius * 2.6) {
            calledPocket.current = i;
            setCalledPocketUI(i);
            return;
          }
        }
      }
      canvas.setPointerCapture(e.pointerId);
      aiming.current = true;
      updateAim(e);
    };
    const onMove = (e: PointerEvent) => {
      if (anim.current) return;
      if (placing.current) { updatePlace(e); return; }
      if (aiming.current) updateAim(e);
    };
    const onUp = () => { placing.current = false; aiming.current = false; };

    layout();
    const onResize = () => layout();
    window.addEventListener('resize', onResize);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    raf = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
    };
  }, [orientation]);

  // ── spin pad ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const c = spinCv.current; if (!c) return;
    const ctx = c.getContext('2d')!;
    const S = 88;
    const draw = () => {
      ctx.clearRect(0, 0, S, S);
      const cx = S / 2, cy = S / 2, R = S / 2 - 4;
      const g = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
      g.addColorStop(0, '#fff'); g.addColorStop(0.6, '#efe9dc'); g.addColorStop(1, '#c9c1b0');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
      ctx.fillStyle = '#3f7cad';
      ctx.beginPath(); ctx.arc(cx + spin.current.side * R * 0.82, cy - spin.current.vertical * R * 0.82, 7, 0, 7); ctx.fill();
    };
    const set = (e: PointerEvent) => {
      const rect = c.getBoundingClientRect();
      const cx = S / 2, cy = S / 2, R = S / 2 - 4;
      let sx = ((e.clientX - rect.left) / rect.width * S - cx) / (R * 0.82);
      let sy = -(((e.clientY - rect.top) / rect.height * S) - cy) / (R * 0.82);
      const m = Math.hypot(sx, sy); if (m > 1) { sx /= m; sy /= m; }
      spin.current = { side: +sx.toFixed(2), vertical: +sy.toFixed(2) };
      draw();
    };
    const down = (e: PointerEvent) => { c.setPointerCapture(e.pointerId); set(e); };
    const move = (e: PointerEvent) => { if (e.buttons) set(e); };
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    draw();
    return () => { c.removeEventListener('pointerdown', down); c.removeEventListener('pointermove', move); };
  }, []);

  // ── power meter (DOM): drag up to charge, release to shoot ───────────────────
  const setPowerFromEvent = (clientY: number) => {
    const el = powerRef.current; if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = clamp(1 - (clientY - rect.top) / rect.height, 0, 1);
    power.current = ratio;
    setPowerPct(ratio);
  };
  const needsCall = mustCall && calledPocketUI == null;
  const onPowerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    resumeAudio();
    if (!canShoot || anim.current || needsCall) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    charging.current = true;
    setPowerFromEvent(e.clientY);
  };
  const onPowerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!charging.current) return;
    setPowerFromEvent(e.clientY);
  };
  const onPowerUp = () => {
    if (!charging.current) return;
    charging.current = false;
    const p = power.current;
    if (p > 0.05) fireShot(p);
    power.current = 0;
    setPowerPct(0);
  };

  // ── fine-aim nudge (press & hold) ────────────────────────────────────────────
  const nudgeTimer = useRef<number | null>(null);
  const startNudge = (dir: 1 | -1) => {
    if (!canShoot) return;
    const step = () => { aim.current += dir * NUDGE_STEP; };
    step();
    nudgeTimer.current = window.setInterval(step, 55);
  };
  const stopNudge = () => {
    if (nudgeTimer.current != null) { clearInterval(nudgeTimer.current); nudgeTimer.current = null; }
  };
  useEffect(() => () => stopNudge(), []);

  const isLandscape = orientation === 'landscape';
  const containerHeight = isLandscape ? '100%' : '74vh';
  const colW = isLandscape ? 118 : 74;
  const SEG = 20; // power-meter segments
  const litSegs = Math.round(powerPct * SEG);
  const segColor = (i: number) => {
    const t = i / (SEG - 1); // 0 green → 1 red (bottom → top)
    if (t < 0.45) return '#3ecf6a';
    if (t < 0.7) return '#e6c229';
    if (t < 0.87) return '#e2801d';
    return '#e0403c';
  };
  const aimBtn = (dir: 1 | -1, label: string, icon: ReactNode) => (
    <button
      className="pool-ctl-btn"
      disabled={!canShoot}
      onPointerDown={() => startNudge(dir)}
      onPointerUp={stopNudge}
      onPointerLeave={stopNudge}
      onPointerCancel={stopNudge}
      aria-label={label}
    >
      {icon}
    </button>
  );

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', height: containerHeight, width: '100%' }}>
      {/* Table (fills the space left of the controls) */}
      <div
        ref={wrapRef}
        style={{
          flex: 1, minWidth: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'linear-gradient(180deg,#5c3a22,#3b2416 12%,#3b2416 88%,#200f07)',
          borderRadius: 16, padding: 4, boxShadow: '0 20px 50px -24px rgba(0,0,0,.9)',
        }}
      >
        <canvas ref={cv} style={{ display: 'block', borderRadius: 10, cursor: canShoot ? 'crosshair' : 'default', touchAction: 'none' }} />
      </div>

      {/* ── Right vertical control column ── */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, width: colW }}>
        {/* Vertical segmented power meter — drag up to charge, release to shoot */}
        <span style={{ fontSize: 8, letterSpacing: '0.1em', textTransform: 'uppercase', color: needsCall ? '#f6c945' : 'var(--text-muted)', fontWeight: 700, textAlign: 'center' }}>
          {needsCall ? 'Call' : 'Power'}
        </span>
        <div
          ref={powerRef}
          onPointerDown={onPowerDown}
          onPointerMove={onPowerMove}
          onPointerUp={onPowerUp}
          onPointerCancel={onPowerUp}
          style={{
            position: 'relative', flex: 1, minHeight: 120, width: isLandscape ? 46 : 38,
            borderRadius: 10, background: '#171b21', border: `2px solid ${needsCall ? '#f6c945' : '#333c48'}`,
            display: 'flex', flexDirection: 'column-reverse', gap: 2, padding: 3, touchAction: 'none',
            cursor: canShoot && !needsCall ? 'ns-resize' : 'not-allowed',
            opacity: canShoot ? (needsCall ? 0.65 : 1) : 0.4,
          }}
        >
          {Array.from({ length: SEG }, (_, i) => (
            <div
              key={i}
              style={{
                flex: 1, borderRadius: 2,
                background: i < litSegs ? segColor(i) : 'rgba(255,255,255,0.06)',
                boxShadow: i < litSegs ? `0 0 6px ${segColor(i)}66` : 'none',
                transition: charging.current ? 'none' : 'background 0.1s',
              }}
            />
          ))}
          <span style={{ position: 'absolute', bottom: 4, left: 0, right: 0, textAlign: 'center', fontSize: 10, fontWeight: 800, color: '#fff', pointerEvents: 'none', textShadow: '0 1px 3px #000' }}>
            {Math.round(powerPct * 100)}
          </span>
        </div>

        {/* Fine aim */}
        <div style={{ display: 'flex', gap: 6 }}>
          {aimBtn(-1, 'Aim left', <ChevronLeft size={16} />)}
          {aimBtn(1, 'Aim right', <ChevronRight size={16} />)}
        </div>

        {/* Spin — where the cue strikes the ball */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          <canvas ref={spinCv} width={88} height={88} style={{ width: isLandscape ? 74 : 58, height: isLandscape ? 74 : 58, borderRadius: '50%', touchAction: 'none', cursor: 'pointer' }} />
          <span style={{ fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Spin</span>
        </div>
      </div>
    </div>
  );
});
