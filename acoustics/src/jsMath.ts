/**
 * Deterministic V8/fdlibm ports (Sun Microsystems, 1993; freely redistributable), matching
 * ios/DatumAcoustics/Sources/DatumAcoustics/FdlibmMath.swift and JSMath.swift jsHypot.
 * Platform Math.sin/exp/log/etc. can differ by 1 ulp across V8 versions, OS, and arch
 * (Apple libm, glibc, and ARM FMA in V8's C++ ieee754.cc). These JS ports are bit-identical
 * on any Node. Math.pow / ** is intentionally left on the host libm: V8 has no fdlibm pow,
 * goldens encode glibc / Node 24, and an fdlibm e_pow port differs on ~8.4% of inputs
 * (see JSMathTests.swift).
 */
const bits = new ArrayBuffer(8);
const f64 = new Float64Array(bits);
const u32 = new Uint32Array(bits);

function hi(x: number): number { f64[0] = x; return u32[1] | 0; }
function lo(x: number): number { f64[0] = x; return u32[0] >>> 0; }
function withHi(x: number, h: number): number { f64[0] = x; u32[1] = h >>> 0; return f64[0]; }
function fromHi(h: number): number { u32[0] = 0; u32[1] = h >>> 0; return f64[0]; }

export const nativeMath = {
  sin: Math.sin,
  cos: Math.cos,
  tanh: Math.tanh,
  exp: Math.exp,
  log: Math.log,
  log10: Math.log10,
  atan: Math.atan,
  atan2: Math.atan2,
  expm1: Math.expm1,
  hypot: Math.hypot,
};

/** V8 Math.exp (fdlibm e_exp.c plus V8's exp(1) = E special case). */
export function jsExp(xIn: number): number {
  let x = xIn;
  const one = 1.0, huge = 1.0e+300, twom1000 = 9.33263618503218878990e-302;
  const oThreshold = 7.09782712893383973096e+02, uThreshold = -7.45133219101941108420e+02;
  const ln2HI = [6.93147180369123816490e-01, -6.93147180369123816490e-01];
  const ln2LO = [1.90821492927058770002e-10, -1.90821492927058770002e-10];
  const halF = [0.5, -0.5];
  const invln2 = 1.44269504088896338700e+00;
  const P1 = 1.66666666666666019037e-01, P2 = -2.77777777770155933842e-03, P3 = 6.61375632143793436117e-05;
  const P4 = -1.65339022054652515390e-06, P5 = 4.13813679705723846039e-08;
  let hx = hi(x) >>> 0;
  const xsb = (hx >>> 31) & 1;
  hx &= 0x7fffffff;
  if (hx >= 0x40862e42) {
    if (hx >= 0x7ff00000) {
      if (((hx & 0xfffff) | lo(x)) !== 0) return x + x;
      return xsb === 0 ? x : 0.0;
    }
    if (x > oThreshold) return huge * huge;
    if (x < uThreshold) return twom1000 * twom1000;
  }
  let hiPart = 0.0, loPart = 0.0, k = 0;
  if (hx > 0x3fd62e42) {
    if (hx < 0x3ff0a2b2) {
      if (x === 1.0) return 2.718281828459045; // V8: Math.exp(1) === Math.E
      hiPart = x - ln2HI[xsb]!; loPart = ln2LO[xsb]!; k = 1 - xsb - xsb;
    } else {
      k = Math.trunc(invln2 * x + halF[xsb]!);
      const t = k;
      hiPart = x - t * ln2HI[0]!; loPart = t * ln2LO[0]!;
    }
    x = hiPart - loPart;
  } else if (hx < 0x3e300000) {
    if (huge + x > one) return one + x;
  } else { k = 0; }
  const t = x * x;
  const c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k === 0) return one - ((x * c) / (c - 2.0) - x);
  const y = one - ((loPart - (x * c) / (2.0 - c)) - hiPart);
  if (k >= -1021) {
    if (k === 1024) return y * 2.0 * fromHi(0x7fe00000);
    return y * fromHi(0x3ff00000 + (k << 20));
  }
  return y * fromHi(0x3ff00000 + ((k + 1000) << 20)) * twom1000;
}

/** V8 Math.log (fdlibm e_log.c). */
export function jsLog(xIn: number): number {
  let x = xIn;
  const ln2_hi = 6.93147180369123816490e-01, ln2_lo = 1.90821492927058770002e-10, two54 = 1.80143985094819840000e+16;
  const Lg1 = 6.666666666666735130e-01, Lg2 = 3.999999999940941908e-01, Lg3 = 2.857142874366239149e-01;
  const Lg4 = 2.222219843214978396e-01, Lg5 = 1.818357216161805012e-01, Lg6 = 1.531383769920937332e-01, Lg7 = 1.479819860511658591e-01;
  let hx = hi(x);
  const lx = lo(x);
  let k = 0;
  if (hx < 0x00100000) {
    if (((hx & 0x7fffffff) | (lx | 0)) === 0) return -Infinity;
    if (hx < 0) return NaN;
    k -= 54; x *= two54; hx = hi(x);
  }
  if (hx >= 0x7ff00000) return x + x;
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  let i = ((hx + 0x95f64) | 0) & 0x100000;
  x = withHi(x, hx | (i ^ 0x3ff00000));
  k += (i >> 20);
  const f = x - 1.0;
  if ((0x000fffff & (2 + hx)) < 3) {
    if (f === 0) { if (k === 0) return 0; const dk = k; return dk * ln2_hi + dk * ln2_lo; }
    const R = f * f * (0.5 - 0.33333333333333333 * f);
    if (k === 0) return f - R;
    const dk = k; return dk * ln2_hi - ((R - dk * ln2_lo) - f);
  }
  const s = f / (2.0 + f), dk = k, z = s * s;
  i = (hx - 0x6147a) | 0;
  const w = z * z;
  const j = (0x6b851 - hx) | 0;
  const t1 = w * (Lg2 + w * (Lg4 + w * Lg6)), t2 = z * (Lg1 + w * (Lg3 + w * (Lg5 + w * Lg7)));
  i |= j;
  const R = t2 + t1;
  if (i > 0) {
    const hfsq = 0.5 * f * f;
    if (k === 0) return f - (hfsq - s * (hfsq + R));
    return dk * ln2_hi - ((hfsq - (s * (hfsq + R) + dk * ln2_lo)) - f);
  }
  if (k === 0) return f - s * (f - R);
  return dk * ln2_hi - ((s * (f - R) - dk * ln2_lo) - f);
}

function kernelSin(x: number, y: number, iy: number): number {
  const S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04;
  const S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;
  const ix = hi(x) & 0x7fffffff;
  if (ix < 0x3e400000) { if ((x | 0) === 0) return x; }
  const z = x * x, v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  if (iy === 0) return x + v * (S1 + z * r);
  const a = 0.5 * y - v * r;
  return x - ((z * a - y) - v * S1);
}

function kernelCos(x: number, y: number): number {
  const C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05;
  const C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;
  const ix = hi(x) & 0x7fffffff;
  if (ix < 0x3e400000) { if ((x | 0) === 0) return 1.0; }
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (ix < 0x3fd33333) return 1.0 - (0.5 * z - (z * r - x * y));
  const qx = ix > 0x3fe90000 ? 0.28125 : fromHi((ix - 0x00200000) >>> 0);
  const hz = 0.5 * z - qx, a = 1.0 - qx;
  return a - (hz - (z * r - x * y));
}

const npio2HW = [
  0x3FF921FB, 0x400921FB, 0x4012D97C, 0x401921FB, 0x401F6A7A, 0x4022D97C, 0x4025FDBB, 0x402921FB,
  0x402C463A, 0x402F6A7A, 0x4031475C, 0x4032D97C, 0x40346B9C, 0x4035FDBB, 0x40378FDB, 0x403921FB,
  0x403AB41B, 0x403C463A, 0x403DD85A, 0x403F6A7A, 0x40407E4C, 0x4041475C, 0x4042106C, 0x4042D97C,
  0x4043A28C, 0x40446B9C, 0x404534AC, 0x4045FDBB, 0x4046C6CB, 0x40478FDB, 0x404858EB, 0x404921FB,
];

/** fdlibm __ieee754_rem_pio2 for |x| ≤ 2^19·π/2. Returns null for larger |x|. */
const remScratch = { n: 0, y0: 0, y1: 0 };
function remPio2(x: number): typeof remScratch | null {
  const invpio2 = 6.36619772367581382433e-01, pio2_1 = 1.57079632673412561417e+00, pio2_1t = 6.07710050650619224932e-11;
  const pio2_2 = 6.07710050630396597660e-11, pio2_2t = 2.02226624879595063154e-21;
  const pio2_3 = 2.02226624871116645580e-21, pio2_3t = 8.47842766036889956997e-32;
  const hx = hi(x), ix = hx & 0x7fffffff;
  if (ix <= 0x3fe921fb) { remScratch.n = 0; remScratch.y0 = x; remScratch.y1 = 0; return remScratch; }
  if (ix < 0x4002d97c) {
    if (hx > 0) {
      let z = x - pio2_1;
      if (ix !== 0x3ff921fb) { const y0 = z - pio2_1t; remScratch.n = 1; remScratch.y0 = y0; remScratch.y1 = (z - y0) - pio2_1t; return remScratch; }
      z -= pio2_2; const y0 = z - pio2_2t; remScratch.n = 1; remScratch.y0 = y0; remScratch.y1 = (z - y0) - pio2_2t; return remScratch;
    } else {
      let z = x + pio2_1;
      if (ix !== 0x3ff921fb) { const y0 = z + pio2_1t; remScratch.n = -1; remScratch.y0 = y0; remScratch.y1 = (z - y0) + pio2_1t; return remScratch; }
      z += pio2_2; const y0 = z + pio2_2t; remScratch.n = -1; remScratch.y0 = y0; remScratch.y1 = (z - y0) + pio2_2t; return remScratch;
    }
  }
  if (ix > 0x413921fb) return null;
  const t0 = Math.abs(x);
  const n = Math.trunc(t0 * invpio2 + 0.5) | 0;
  const fn = n;
  let r = t0 - fn * pio2_1;
  let w = fn * pio2_1t;
  let y0: number;
  if (n < 32 && ix !== npio2HW[n - 1]) {
    y0 = r - w;
  } else {
    const j = ix >> 20;
    y0 = r - w;
    let i = j - ((hi(y0) >> 20) & 0x7ff);
    if (i > 16) {
      let t = r; w = fn * pio2_2; r = t - w; w = fn * pio2_2t - ((t - r) - w); y0 = r - w;
      i = j - ((hi(y0) >> 20) & 0x7ff);
      if (i > 49) { t = r; w = fn * pio2_3; r = t - w; w = fn * pio2_3t - ((t - r) - w); y0 = r - w; }
    }
  }
  const y1 = (r - y0) - w;
  if (hx < 0) { remScratch.n = -n; remScratch.y0 = -y0; remScratch.y1 = -y1; return remScratch; }
  remScratch.n = n; remScratch.y0 = y0; remScratch.y1 = y1; return remScratch;
}

/** V8 Math.sin (fdlibm). |x| > 2^19·π/2 falls back to the platform libm. */
export function jsSin(x: number): number {
  const ix = hi(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernelSin(x, 0, 0);
  if (ix >= 0x7ff00000) return x - x;
  const rem = remPio2(x);
  if (!rem) return nativeMath.sin(x);
  switch (rem.n & 3) {
    case 0: return kernelSin(rem.y0, rem.y1, 1);
    case 1: return kernelCos(rem.y0, rem.y1);
    case 2: return -kernelSin(rem.y0, rem.y1, 1);
    default: return -kernelCos(rem.y0, rem.y1);
  }
}

/** V8 Math.cos (fdlibm). */
export function jsCos(x: number): number {
  const ix = hi(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernelCos(x, 0);
  if (ix >= 0x7ff00000) return x - x;
  const rem = remPio2(x);
  if (!rem) return nativeMath.cos(x);
  switch (rem.n & 3) {
    case 0: return kernelCos(rem.y0, rem.y1);
    case 1: return -kernelSin(rem.y0, rem.y1, 1);
    case 2: return -kernelCos(rem.y0, rem.y1);
    default: return kernelSin(rem.y0, rem.y1, 1);
  }
}

/** V8 Math.atan (fdlibm s_atan.c). */
export function jsAtan(xIn: number): number {
  const atanhi = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
  const atanlo = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
  const aT = [3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01, -1.11111104054623557880e-01,
    9.09088713343650656196e-02, -7.69187620504482999495e-02, 6.66107313738753120669e-02, -5.83357013379057348645e-02,
    4.97687799461593236017e-02, -3.65315727442169155270e-02, 1.62858201153657823623e-02];
  let x = xIn;
  const hx = hi(x), ix = hx & 0x7fffffff;
  let id = -1;
  if (ix >= 0x44100000) {
    if (ix > 0x7ff00000 || (ix === 0x7ff00000 && lo(x) !== 0)) return x + x;
    return hx > 0 ? atanhi[3]! + atanlo[3]! : -atanhi[3]! - atanlo[3]!;
  }
  if (ix < 0x3fdc0000) {
    if (ix < 0x3e400000) return x;
  } else {
    x = Math.abs(x);
    if (ix < 0x3ff30000) {
      if (ix < 0x3fe60000) { id = 0; x = (2.0 * x - 1.0) / (2.0 + x); } else { id = 1; x = (x - 1.0) / (x + 1.0); }
    } else {
      if (ix < 0x40038000) { id = 2; x = (x - 1.5) / (1.0 + 1.5 * x); } else { id = 3; x = -1.0 / x; }
    }
  }
  const z = x * x, w = z * z;
  const s1 = z * (aT[0]! + w * (aT[2]! + w * (aT[4]! + w * (aT[6]! + w * (aT[8]! + w * aT[10]!)))));
  const s2 = w * (aT[1]! + w * (aT[3]! + w * (aT[5]! + w * (aT[7]! + w * aT[9]!))));
  if (id < 0) return x - x * (s1 + s2);
  const zz = atanhi[id]! - ((x * (s1 + s2) - atanlo[id]!) - x);
  return hx < 0 ? -zz : zz;
}

/** V8 Math.atan2 (fdlibm e_atan2.c). */
export function jsAtan2(y: number, x: number): number {
  const tiny = 1.0e-300, pi_o_4 = 7.8539816339744827900E-01, pi_o_2 = 1.5707963267948965580E+00;
  const pi = 3.1415926535897931160E+00, pi_lo = 1.2246467991473531772E-16;
  if (Number.isNaN(x) || Number.isNaN(y)) return x + y;
  const hx = hi(x), lx = lo(x), ix = hx & 0x7fffffff, hy = hi(y), ly = lo(y), iy = hy & 0x7fffffff;
  if (((hx - 0x3ff00000) | 0) === 0 && lx === 0) return jsAtan(y);
  let m = ((hy >> 31) & 1) | ((hx >> 30) & 2);
  if (iy === 0 && ly === 0) {
    switch (m) { case 0: case 1: return y; case 2: return pi + tiny; default: return -pi - tiny; }
  }
  if (ix === 0 && lx === 0) return hy < 0 ? -pi_o_2 - tiny : pi_o_2 + tiny;
  if (ix === 0x7ff00000) {
    if (iy === 0x7ff00000) {
      switch (m) { case 0: return pi_o_4 + tiny; case 1: return -pi_o_4 - tiny; case 2: return 3.0 * pi_o_4 + tiny; default: return -3.0 * pi_o_4 - tiny; }
    } else {
      switch (m) { case 0: return 0; case 1: return -0.0; case 2: return pi + tiny; default: return -pi - tiny; }
    }
  }
  if (iy === 0x7ff00000) return hy < 0 ? -pi_o_2 - tiny : pi_o_2 + tiny;
  const k = (iy - ix) >> 20;
  let z: number;
  if (k > 60) { z = pi_o_2 + 0.5 * pi_lo; m &= 1; } else if (hx < 0 && k < -60) { z = 0; } else { z = jsAtan(Math.abs(y / x)); }
  switch (m) {
    case 0: return z;
    case 1: return -z;
    case 2: return pi - (z - pi_lo);
    default: return (z - pi_lo) - pi;
  }
}

/** V8 Math.log10 (FreeBSD msun e_log10.c on top of ieee754 log). */
export function jsLog10(xIn: number): number {
  const two54 = 1.80143985094819840000e+16, ivln10 = 4.34294481903251816668e-01;
  const log10_2hi = 3.01029995663611771306e-01, log10_2lo = 3.69423907715893078616e-13;
  let x = xIn;
  let hx = hi(x);
  const lx = lo(x);
  let k = 0;
  if (hx < 0x00100000) {
    if (((hx & 0x7fffffff) | (lx | 0)) === 0) return -Infinity;
    if (hx < 0) return NaN;
    k -= 54; x *= two54; hx = hi(x);
  }
  if (hx >= 0x7ff00000) return x + x;
  if (hx === 0x3ff00000 && lx === 0) return 0;
  k += (hx >> 20) - 1023;
  const i = ((k >>> 0) & 0x80000000) >>> 31;
  hx = (hx & 0x000fffff) | ((0x3ff - i) << 20);
  const y = k + i;
  x = withHi(x, hx);
  const z = y * log10_2lo + ivln10 * jsLog(x);
  return z + y * log10_2hi;
}

/** fdlibm expm1 (V8 ieee754::expm1), used by jsTanh. */
export function jsExpm1(xIn: number): number {
  let x = xIn;
  const huge = 1.0e+300, tiny = 1.0e-300, o_threshold = 7.09782712893383973096e+02;
  const ln2_hi = 6.93147180369123816490e-01, ln2_lo = 1.90821492927058770002e-10, invln2 = 1.44269504088896338700e+00;
  const Q1 = -3.33333333333331316428e-02, Q2 = 1.58730158725481460165e-03, Q3 = -7.93650757867487942473e-05;
  const Q4 = 4.00821782732936239552e-06, Q5 = -2.01099218183624371326e-07;
  const hxFull = hi(x) >>> 0;
  const negative = (hxFull & 0x80000000) !== 0;
  const hx = hxFull & 0x7fffffff;
  if (hx >= 0x4043687A) {
    if (hx >= 0x40862E42) {
      if (hx >= 0x7ff00000) { if (Number.isNaN(x)) return x + x; return negative ? -1.0 : x; }
      if (x > o_threshold) return Infinity;
    }
    if (negative && x + tiny < 0.0) return tiny - 1.0;
  }
  let k = 0;
  let c = 0.0;
  if (hx > 0x3FD62E42) {
    let hiP: number, loP: number;
    if (hx < 0x3FF0A2B2) {
      if (!negative) { hiP = x - ln2_hi; loP = ln2_lo; k = 1; } else { hiP = x + ln2_hi; loP = -ln2_lo; k = -1; }
    } else {
      k = Math.trunc(invln2 * x + (negative ? -0.5 : 0.5));
      const t = k;
      hiP = x - t * ln2_hi; loP = t * ln2_lo;
    }
    x = hiP - loP;
    c = (hiP - x) - loP;
  } else if (hx < 0x3C900000) {
    const t = huge + x; return x - (t - (huge + x));
  }
  const hfx = 0.5 * x, hxs = x * hfx;
  const r1 = 1.0 + hxs * (Q1 + hxs * (Q2 + hxs * (Q3 + hxs * (Q4 + hxs * Q5))));
  let t = 3.0 - r1 * hfx;
  let e = hxs * ((r1 - t) / (6.0 - x * t));
  if (k === 0) return x - (x * e - hxs);
  const twopk = fromHi((0x3ff00000 + (k << 20)) >>> 0);
  e = (x * (e - c) - c);
  e -= hxs;
  if (k === -1) return 0.5 * (x - e) - 0.5;
  if (k === 1) { if (x < -0.25) return -2.0 * (e - (x + 0.5)); else return 1.0 + 2.0 * (x - e); }
  if (k <= -2 || k > 56) {
    let y = 1.0 - (e - x);
    if (k === 1024) y = y * 2.0 * 8.98846567431157953865e+307; else y = y * twopk;
    return y - 1.0;
  }
  let y: number;
  if (k < 20) {
    t = fromHi((0x3ff00000 - (0x200000 >> k)) >>> 0);
    y = t - (e - x); y = y * twopk;
  } else {
    t = fromHi(((0x3ff - k) << 20) >>> 0);
    y = x - (e + t); y += 1.0; y = y * twopk;
  }
  return y;
}

/** V8 Math.tanh (fdlibm s_tanh.c). */
export function jsTanh(x: number): number {
  const jx = hi(x), ix = jx & 0x7fffffff;
  if (ix >= 0x7ff00000) { if (Number.isNaN(x)) return x; return jx >= 0 ? 1.0 : -1.0; }
  let z: number;
  if (ix < 0x40360000) {
    if (ix < 0x3E300000) return x;
    if (ix >= 0x3FF00000) { const t = jsExpm1(2.0 * Math.abs(x)); z = 1.0 - 2.0 / (t + 2.0); }
    else { const t = jsExpm1(-2.0 * Math.abs(x)); z = -t / (t + 2.0); }
  } else { z = 1.0 - 1.0e-300; }
  return jx >= 0 ? z : -z;
}

/** V8 Math.hypot (Kahan-compensated, max-scaled) for two arguments. */
export function jsHypot(a: number, b: number): number {
  const x = Math.abs(a), y = Math.abs(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    if (x === Infinity || y === Infinity) return Infinity;
    return NaN;
  }
  const m = Math.max(x, y);
  if (m === 0) return 0;
  let n = x / m, s = n * n, sum = s, comp = (sum - s);
  n = y / m; s = n * n - comp; const p = sum + s; comp = (p - sum) - s; sum = p;
  return Math.sqrt(sum) * m;
}

/** V8 Math.hypot for three arguments. */
export function jsHypot3(a: number, b: number, c: number): number {
  const x = Math.abs(a), y = Math.abs(b), z = Math.abs(c);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    if (x === Infinity || y === Infinity || z === Infinity) return Infinity;
    return NaN;
  }
  const m = Math.max(x, Math.max(y, z));
  if (m === 0) return 0;
  let n = x / m, s = n * n, sum = s, comp = (sum - s);
  n = y / m; s = n * n - comp; let p = sum + s; comp = (p - sum) - s; sum = p;
  n = z / m; s = n * n - comp; p = sum + s; comp = (p - sum) - s; sum = p;
  return Math.sqrt(sum) * m;
}

function jsHypotN(a: number, b?: number, c?: number): number {
  const n = arguments.length;
  if (n === 2) return jsHypot(a, b!);
  if (n === 3) return jsHypot3(a, b!, c!);
  return nativeMath.hypot.apply(Math, arguments as unknown as number[]);
}

let installed = false;

/** Replace Math.sin/cos/exp/log/log10/atan/atan2/tanh/expm1/hypot with the fdlibm ports. Not pow. */
export function installJsMath(): void {
  if (installed) return;
  Math.sin = jsSin;
  Math.cos = jsCos;
  Math.tanh = jsTanh;
  Math.exp = jsExp;
  Math.log = jsLog;
  Math.log10 = jsLog10;
  Math.atan = jsAtan;
  Math.atan2 = jsAtan2;
  Math.expm1 = jsExpm1;
  Math.hypot = jsHypotN;
  installed = true;
}

installJsMath();
