/** Constant-velocity Cartesian tracks: textbook relative motion (Urick, Principles of Underwater Sound).
 * x east, y north, depth positive down; course radians clockwise from north; speed m/s. */
import './jsMath.js';
export interface Track { x: number; y: number; depth: number; course: number; speed: number }
export interface Geometry { range: number; horizontal: number; bearing: number; rangeRate: number; sourceRadial: number; receiverRadial: number; cpaTime: number; cpaRange: number }
export const createGeometry = (): Geometry => ({range:0,horizontal:0,bearing:0,rangeRate:0,sourceRadial:0,receiverRadial:0,cpaTime:0,cpaRange:0});
export function advance(t: Track, dt: number): void { t.x += Math.sin(t.course)*t.speed*dt; t.y += Math.cos(t.course)*t.speed*dt; }
export function geometry(source: Track, receiver: Track, out: Geometry): Geometry {
  const x=source.x-receiver.x, y=source.y-receiver.y, z=source.depth-receiver.depth;
  const sx=Math.sin(source.course)*source.speed, sy=Math.cos(source.course)*source.speed;
  const rx=Math.sin(receiver.course)*receiver.speed, ry=Math.cos(receiver.course)*receiver.speed;
  const vx=sx-rx, vy=sy-ry, r=Math.hypot(x,y,z), v2=vx*vx+vy*vy;
  out.range=r; out.horizontal=Math.hypot(x,y); out.bearing=(Math.atan2(x,y)+2*Math.PI)%(2*Math.PI);
  out.sourceRadial=r>1e-9 ? -(sx*x+sy*y)/r : 0;
  out.receiverRadial=r>1e-9 ? (rx*x+ry*y)/r : 0;
  out.rangeRate=-(out.sourceRadial+out.receiverRadial);
  out.cpaTime=v2>1e-18 ? -(x*vx+y*vy)/v2 : 0;
  out.cpaRange=Math.hypot(x+vx*out.cpaTime,y+vy*out.cpaTime,z); return out;
}
