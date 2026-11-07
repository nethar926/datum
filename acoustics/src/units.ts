/** SI internally; pressure/power dB conventions: Kinsler & Frey, Fundamentals of Acoustics. */
export const C = 1500;
export const knotsToMps = (knots: number): number => knots * 0.5144444444444445;
export const mpsToKnots = (mps: number): number => mps / 0.5144444444444445;
export const dbToPower = (db: number): number => 10 ** (Math.max(-300, Math.min(300, db)) / 10);
export const powerToDb = (power: number): number => 10 * Math.log10(Math.max(1e-30, power));
export const amplitudeToDb = (a: number): number => 20 * Math.log10(Math.max(1e-15, Math.abs(a)));
export const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
/** Mackenzie (1981), JASA 70:807, nine-term equation. Inputs clamped to published domain
 * T -2..30 °C, S 30..40 ppt, D 0..8000 m; output m/s, not an ocean profile solver. */
export function soundSpeed(T: number, S: number, D: number): number {
  T = clamp(T, -2, 30); S = clamp(S, 30, 40); D = clamp(D, 0, 8000);
  return 1448.96 + 4.591*T - .05304*T*T + .0002374*T*T*T + 1.34*(S-35)
    + .0163*D + 1.675e-7*D*D - .01025*T*(S-35) - 7.139e-13*T*D*D*D;
}

/** Saturation vapour pressure of pure water (Pa), Buck 1981 / public fit. T in °C. */
export function vapourPressurePa(T:number):number{T=clamp(T,-2,40);return 611.21*Math.exp((18.678-T/234.5)*(T/(257.14+T)));}
/** Seawater density kg/m³ — linear teaching fit about 35 ppt, 15 °C (not TEOS-10). */
export function seawaterDensity(T:number,S:number):number{T=clamp(T,-2,40);S=clamp(S,0,42);return 1027.0-.07*(T-15)+.78*(S-35);}

/** Cavitation-number inception speed (kn). V_i = V_i0 · √((P_a−P_v)/(P_0−P_v0)).
 * P_a = P_atm + ρ(T,S) g d; P_v Buck (1981). Defaults T=15 °C, S=35 ppt. */
export function cavitationInceptionSpeedKn(
 surfaceInceptionKn:number,_depthCoefficient:number,depthM:number,temperatureC=15,salinityPsu=35,
):number{
 const g=9.80665,Patm=101325,d=Math.max(0,depthM),rho=seawaterDensity(temperatureC,salinityPsu);
 const Pa=Patm+rho*g*d,Pv=vapourPressurePa(temperatureC),P0=Patm,Pv0=vapourPressurePa(15);
 return surfaceInceptionKn*Math.sqrt(Math.max(1e-6,(Pa-Pv)/(P0-Pv0)));
}
