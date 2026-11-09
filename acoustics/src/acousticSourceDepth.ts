/**
 * Effective acoustic source depth for image-source / Lloyd geometry.
 *
 * A surfaced (or flush-keel) contact does not radiate from zs = 0: the pressure-release
 * surface image would cancel the direct path (Urick; Jensen et al.). Real radiators are the
 * submerged hull volume and propeller — roughly half surfaced draught to prop depth
 * (several metres). Fictional teaching floor: max(2.5 m, 0.45 × draughtSurfacedM).
 *
 * Keel depth (Contact.depth) is unchanged for kinematics/display; only TL/Lloyd callers
 * should use this helper.
 */
export function acousticSourceDepthM(keelDepthM: number, draughtSurfacedM = 6): number {
  const keel = Math.max(0, keelDepthM);
  const draught = Math.max(2, draughtSurfacedM);
  const minZs = Math.max(2.5, draught * 0.45);
  return keel < minZs ? minZs : keel;
}
