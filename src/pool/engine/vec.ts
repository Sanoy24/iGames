/**
 * Minimal 2D/3D vector helpers for the pool physics engine.
 *
 * Kept dependency-free and side-effect-free so this engine can be shared
 * verbatim between the NestJS backend (authoritative simulation) and the
 * browser client (local prediction / rendering). Every function is pure.
 */

export interface Vec2 {
    x: number;
    y: number;
}

export interface Vec3 {
    x: number;
    y: number;
    z: number;
}

export const v2 = (x: number, y: number): Vec2 => ({ x, y });

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });

export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const lenSq = (a: Vec2): number => a.x * a.x + a.y * a.y;

/** Unit vector, or the zero vector if `a` has (near) zero length. */
export const normalize = (a: Vec2): Vec2 => {
    const l = len(a);
    return l < 1e-12 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
};

/** ẑ × v  rotates a planar vector 90° counter-clockwise. Used for roll spin. */
export const zCross = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });
