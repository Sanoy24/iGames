import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { recordShot, buildTable, buildTuning, DEFAULT_PHYSICS } from '../lib/poolEngine';
import type { Ball, ShotInput, TableSpec } from '../lib/poolEngine';
import type { PoolMatchView, Seat } from '../lib/poolApi';

export interface PoolTableHandle {
  /** Animate a shot (deterministic replay) from the current displayed board. */
  enqueueShot: (input: ShotInput) => void;
}

interface Props {
  view: PoolMatchView;
  mySeat: Seat | null;
  canShoot: boolean;
  onSubmit: (input: ShotInput) => void;
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

interface Anim { frames: Array<Array<{ x: number; y: number; pocketed: boolean }>>; frameDt: number; i: number; acc: number; last: number; }

export const PoolTable = forwardRef<PoolTableHandle, Props>(function PoolTable(
  { view, mySeat, canShoot, onSubmit },
  ref,
) {
  const cv = useRef<HTMLCanvasElement>(null);
  const spinCv = useRef<HTMLCanvasElement>(null);

  // Live mutable state kept in refs so the animation loop never triggers re-renders.
  const table = useRef<TableSpec>(buildTable(DEFAULT_PHYSICS));
  const tuning = useRef(buildTuning(DEFAULT_PHYSICS));
  const balls = useRef<Ball[]>([]);
  const anim = useRef<Anim | null>(null);
  const queue = useRef<ShotInput[]>([]);
  const aim = useRef(0);
  const power = useRef(0);
  const spin = useRef({ side: 0, vertical: 0 });
  const dragging = useRef(false);
  const viewRef = useRef(view);
  const canShootRef = useRef(canShoot);

  const geom = useRef({ rail: 16, scale: 340 });

  // Keep refs in sync with props; snap to the authoritative board when idle.
  useEffect(() => {
    viewRef.current = view;
    canShootRef.current = canShoot;
    table.current = buildTable(view.physics ?? DEFAULT_PHYSICS);
    tuning.current = buildTuning(view.physics ?? DEFAULT_PHYSICS);
    if (!anim.current && queue.current.length === 0) {
      balls.current = view.board.map((b) => ({ ...b, pos: { ...b.pos }, vel: { ...b.vel }, spin: { ...b.spin } }));
    }
  }, [view, canShoot]);

  useImperativeHandle(ref, () => ({
    enqueueShot: (input: ShotInput) => {
      queue.current.push(input);
    },
  }), []);

  // ── one-time setup: sizing, render loop, pointer handlers ────────────────────
  useEffect(() => {
    const canvas = cv.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let raf = 0;

    const layout = () => {
      const cssW = canvas.clientWidth;
      const t = table.current;
      const rail = Math.round(cssW * 0.03);
      const playW = cssW - rail * 2;
      const scale = playW / t.width;
      const cssH = t.height * scale + rail * 2;
      canvas.style.height = `${cssH}px`;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      geom.current = { rail, scale };
    };

    const wx = (x: number) => geom.current.rail + x * geom.current.scale;
    const wy = (y: number) => geom.current.rail + y * geom.current.scale;
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
        ctx.beginPath(); ctx.arc(wx(p.x), wy(p.y), pr, 0, 7); ctx.fillStyle = '#080605'; ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = '#d9a441';
        ctx.beginPath(); ctx.arc(wx(p.x), wy(p.y), pr + 1.5, 0, 7); ctx.stroke();
      }
    };

    const drawBall = (b: Ball, radius: number) => {
      const cx = wx(b.pos.x), cy = wy(b.pos.y), r = radius;
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
      const cx = wx(cue.pos.x), cy = wy(cue.pos.y), r = br();
      const p = predict(cue);
      ctx.save();
      ctx.setLineDash([6, 6]); ctx.strokeStyle = 'rgba(244,239,228,0.55)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(cx, cy);
      const end = p ? { x: wx(p.contact.x), y: wy(p.contact.y) } : { x: cx + dir.x * 400, y: cy + dir.y * 400 };
      ctx.lineTo(end.x, end.y); ctx.stroke(); ctx.setLineDash([]);
      if (p && p.hit.kind === 'ball' && p.hit.ball) {
        ctx.strokeStyle = 'rgba(244,239,228,0.5)';
        ctx.beginPath(); ctx.arc(end.x, end.y, r, 0, 7); ctx.stroke();
        const ob = p.hit.ball;
        const odx = ob.pos.x - p.contact.x, ody = ob.pos.y - p.contact.y;
        const ol = Math.hypot(odx, ody) || 1;
        ctx.strokeStyle = 'rgba(217,164,65,0.85)'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(wx(ob.pos.x), wy(ob.pos.y));
        ctx.lineTo(wx(ob.pos.x) + (odx / ol) * 46, wy(ob.pos.y) + (ody / ol) * 46); ctx.stroke();
      }
      ctx.restore();
      // cue stick pulled back by power
      const pull = 14 + power.current * 90;
      const gap = r + 4;
      const bx = cx - dir.x * gap, by = cy - dir.y * gap;
      const ex = cx - dir.x * (gap + 150 + pull), ey = cy - dir.y * (gap + 150 + pull);
      const grd = ctx.createLinearGradient(bx, by, ex, ey);
      grd.addColorStop(0, '#e8d9b4'); grd.addColorStop(0.06, '#caa46a'); grd.addColorStop(1, '#6b4a24');
      ctx.strokeStyle = grd; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ex, ey); ctx.stroke();
    };

    const startNextAnim = () => {
      const input = queue.current.shift();
      if (!input) return;
      const rec = recordShot(balls.current, input, table.current, { tuning: tuning.current });
      anim.current = { frames: rec.frames, frameDt: rec.frameDt, i: 0, acc: 0, last: performance.now() };
      // settle to the recorded final positions when the animation ends
      (anim.current as Anim & { final?: Ball[] }).final = rec.result.balls;
    };

    const render = (now: number) => {
      // advance animation
      if (!anim.current && queue.current.length > 0) startNextAnim();
      if (anim.current) {
        const a = anim.current;
        const dtReal = Math.min(0.05, (now - a.last) / 1000);
        a.last = now; a.acc += dtReal;
        while (a.acc >= a.frameDt && a.i < a.frames.length - 1) { a.acc -= a.frameDt; a.i++; }
        const frame = a.frames[a.i];
        balls.current.forEach((b, idx) => {
          const f = frame[idx];
          if (f) { b.pos.x = f.x; b.pos.y = f.y; b.pocketed = f.pocketed; }
        });
        if (a.i >= a.frames.length - 1) {
          const final = (a as Anim & { final?: Ball[] }).final;
          if (final) balls.current = final.map((b) => ({ ...b, pos: { ...b.pos }, vel: { ...b.vel }, spin: { ...b.spin } }));
          anim.current = null;
          // if idle now, snap to authoritative board
          if (queue.current.length === 0) {
            balls.current = viewRef.current.board.map((b) => ({ ...b, pos: { ...b.pos }, vel: { ...b.vel }, spin: { ...b.spin } }));
          }
        }
      }

      drawTable();
      const r = br();
      const idle = !anim.current && queue.current.length === 0;
      const cue = balls.current.find((b) => b.number === 0);
      if (idle && canShootRef.current && cue && !cue.pocketed) drawAim(cue);
      for (const b of balls.current) { if (!b.pocketed) drawBall(b, r); }
      raf = requestAnimationFrame(render);
    };

    // ── pointer: drag back from the cue ball to aim + charge ───────────────────
    const toCanvas = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const toWorld = (px: number, py: number) => ({ x: (px - geom.current.rail) / geom.current.scale, y: (py - geom.current.rail) / geom.current.scale });
    const cueBall = () => balls.current.find((b) => b.number === 0);

    const onDown = (e: PointerEvent) => {
      if (!canShootRef.current || anim.current) return;
      canvas.setPointerCapture(e.pointerId);
      dragging.current = true;
      updateDrag(e);
    };
    const onMove = (e: PointerEvent) => {
      if (anim.current) return;
      const cue = cueBall();
      if (!cue || cue.pocketed) return;
      if (dragging.current) { updateDrag(e); return; }
      if (!canShootRef.current) return;
      const p = toCanvas(e); const w = toWorld(p.x, p.y);
      aim.current = Math.atan2(w.y - cue.pos.y, w.x - cue.pos.x);
    };
    const updateDrag = (e: PointerEvent) => {
      const cue = cueBall(); if (!cue || cue.pocketed) return;
      const p = toCanvas(e); const w = toWorld(p.x, p.y);
      const dx = w.x - cue.pos.x, dy = w.y - cue.pos.y;
      aim.current = Math.atan2(-dy, -dx);
      power.current = clamp(Math.hypot(dx, dy) / (table.current.width * 0.28), 0, 1);
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      if (!canShootRef.current || anim.current) { power.current = 0; return; }
      if (power.current > 0.04) {
        const input: ShotInput = { angle: aim.current, power: power.current, spin: { ...spin.current } };
        queue.current.push(input); // animate immediately (optimistic)
        onSubmit(input);
      }
      power.current = 0;
    };

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
  }, [onSubmit]);

  // ── spin pad ─────────────────────────────────────────────────────────────
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ background: 'linear-gradient(180deg,#5c3a22,#3b2416 12%,#3b2416 88%,#200f07)', borderRadius: 16, padding: 4, boxShadow: '0 20px 50px -24px rgba(0,0,0,.9)' }}>
        <canvas ref={cv} style={{ display: 'block', width: '100%', height: 'auto', borderRadius: 12, cursor: canShoot ? 'crosshair' : 'default', touchAction: 'none' }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <canvas ref={spinCv} width={88} height={88} style={{ borderRadius: '50%', touchAction: 'none', cursor: 'pointer' }} />
          <span style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Spin</span>
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>
          {canShoot
            ? 'Drag back from the cue ball to aim and set power, then release. Move the spin dot for follow / draw / english.'
            : 'Waiting for your turn…'}
        </p>
      </div>
    </div>
  );
});
