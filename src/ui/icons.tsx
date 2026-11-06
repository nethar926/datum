/**
 * DATUM line icons. Drawn in-house on a 24-unit grid in an SF-like style (1.75 stroke, round caps/joins, optical
 * centring); not SF Symbols glyphs and no Apple assets. currentColor, aria-hidden, sized by CSS (default 22 px).
 */
import type { ReactNode } from 'react'

const S = ({ children, size = 22, className }: { children: ReactNode; size?: number; className?: string }) => (
  <svg className={`ic${className ? ' ' + className : ''}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">{children}</svg>
)
type P = { size?: number; className?: string }

/** Live: waterfall rows with a spectral line. */
export const IcLive = (p: P) => <S {...p}><rect x="3.5" y="4" width="17" height="16" rx="3.5" /><path d="M7 8.5h3M12.5 8.5h4.5M7 12h6M15.5 12H17M7 15.5h2M11.5 15.5h5.5" /><path d="M13.6 5.2v13.6" strokeWidth={1.4} strokeDasharray="1.2 2" /></S>
/** Cuts: a clip / frame stack. */
export const IcCuts = (p: P) => <S {...p}><rect x="4" y="7" width="13" height="13" rx="3" /><path d="M7.5 4h9.5a3 3 0 0 1 3 3v9.5" /><path d="M8.5 11.5 12.5 13.5 8.5 15.5z" fill="currentColor" strokeWidth={1.2} /></S>
/** Plot: range rings with a contact. */
export const IcPlot = (p: P) => <S {...p}><circle cx="12" cy="12" r="8.25" /><circle cx="12" cy="12" r="4.25" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" /><circle cx="15.2" cy="8.8" r="1.2" fill="currentColor" stroke="none" /></S>
/** Settings: gear. */
export const IcGear = (p: P) => <S {...p}><circle cx="12" cy="12" r="3" /><path d="M12 3.2l1.5 2.1 2.5-.6.6 2.5 2.4 1-.9 2.4 1.6 2-2 1.6.9 2.4-2.4 1-.6 2.5-2.5-.6L12 20.8l-1.5-2.1-2.5.6-.6-2.5-2.4-1 .9-2.4L4.3 12l1.6-1.6L5 8l2.4-1L8 4.5l2.5.6z" /></S>
export const IcPlay = (p: P) => <S {...p}><path d="M8 5.5v13l10.5-6.5z" fill="currentColor" strokeWidth={1.4} /></S>
export const IcPause = (p: P) => <S {...p}><rect x="6.5" y="5.5" width="3.6" height="13" rx="1.2" fill="currentColor" stroke="none" /><rect x="13.9" y="5.5" width="3.6" height="13" rx="1.2" fill="currentColor" stroke="none" /></S>
export const IcRestart = (p: P) => <S {...p}><path d="M7.2 7.2A6.8 6.8 0 1 1 5.5 12" /><path d="M5 4.8v4.2h4.2" /></S>
/** Refresh / reload: circular arrow (drawn in-house; not an SF Symbol). */
export const IcRefresh = (p: P) => <S {...p}><path d="M19.2 12a7.2 7.2 0 1 1-2.1-5.1" /><path d="M19.2 4.5v5.2h-5.2" /></S>
export const IcBack = (p: P) => <S {...p}><path d="M14.5 6l-6 6 6 6" /></S>
export const IcChevron = (p: P) => <S {...p}><path d="M9.5 6l6 6-6 6" /></S>
export const IcClose = (p: P) => <S {...p}><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" /></S>
export const IcInfo = (p: P) => <S {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5" /><circle cx="12" cy="7.8" r=".9" fill="currentColor" stroke="none" /></S>
export const IcLayers = (p: P) => <S {...p}><path d="M12 4l8.5 4.5L12 13 3.5 8.5z" /><path d="M3.5 12.5 12 17l8.5-4.5" /><path d="M3.5 16.2 12 20.7l8.5-4.5" opacity=".6" /></S>
/** Tools */
export const IcDop = (p: P) => <S {...p}><path d="M5 4.5c0 6 2.5 7.5 7 7.5s7 1.5 7 7.5" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="6.3" cy="7.5" r="1.1" /><circle cx="17.7" cy="16.5" r="1.1" /></S>
export const IcHarm = (p: P) => <S {...p}><path d="M5 5v14M10 5v14M15 5v14M20 5v14" strokeDasharray="2.2 1.8" /><path d="M3 12h2M8 12h4M13 12h4" opacity="0" /></S>
export const IcHorz = (p: P) => <S {...p}><path d="M3 12h18" /><path d="M12 4.5v4M12 15.5v4" opacity=".55" /><circle cx="12" cy="12" r="2" /></S>
export const IcLm = (p: P) => <S {...p}><path d="M4 5c3 2.5 3 11.5 0 14M9 5c2.4 2.5 2.4 11.5 0 14M14 5c1.8 2.5 1.8 11.5 0 14M19 5c1.2 2.5 1.2 11.5 0 14" /></S>
export const IcBrg = (p: P) => <S {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 12l4.5-6.5" /><path d="M12 3.5v1.6M20.5 12h-1.6M12 20.5v-1.6M3.5 12h1.6" opacity=".6" /><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" /></S>
/** FIX: crossed bearings with a fix mark. */
export const IcFix = (p: P) => <S {...p}><path d="M4 20L12 4M20 20L12 4" /><circle cx="12" cy="11.5" r="2.2" /><path d="M12 13.7v4.8" opacity=".55" /></S>
export const IcContrast = (p: P) => <S {...p}><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none" /></S>
export const IcTarget = (p: P) => <S {...p}><circle cx="12" cy="12" r="7" /><path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5" /></S>
export const IcTrash = (p: P) => <S {...p}><path d="M5 7h14M10 4h4M7 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h5.4a1.5 1.5 0 0 0 1.5-1.4L17 7" /></S>
export const IcUndo = (p: P) => <S {...p}><path d="M9 7H5v4" /><path d="M5 11a7 7 0 1 0 2-4.9" /></S>
export const IcProbe = (p: P) => <S {...p}><path d="M12 3.5v17" strokeDasharray="2 2" /><path d="M7 9l5-5 5 5" /></S>
export const IcLink = (p: P) => <S {...p}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></S>
export const IcSparkle = (p: P) => <S {...p}><path d="M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8z" /></S>
/** Speaker (listen on). */
export const IcSpeaker = (p: P) => <S {...p}><path d="M4.5 9.5v5h3.2L12.5 18V6L7.7 9.5z" /><path d="M15.2 9.2a3.2 3.2 0 0 1 0 5.6" /><path d="M17.4 7a5.6 5.6 0 0 1 0 10" opacity=".7" /></S>
/** Speaker muted (listen off). */
export const IcSpeakerMute = (p: P) => <S {...p}><path d="M4.5 9.5v5h3.2L12.5 18V6L7.7 9.5z" /><path d="M16 9.5l4 5M20 9.5l-4 5" /></S>
/** Share (iOS): rounded square with an up arrow. */
export const IcShare = (p: P) => <S {...p}><path d="M12 14.5V4.5" /><path d="M8.5 7.5 12 4l3.5 3.5" /><path d="M6.5 10.5v6.2A2.3 2.3 0 0 0 8.8 19h6.4a2.3 2.3 0 0 0 2.3-2.3v-6.2" /></S>
/** Plus-in-box (Add to Home Screen). */
export const IcPlusBox = (p: P) => <S {...p}><rect x="4" y="4" width="16" height="16" rx="3.5" /><path d="M12 8.5v7M8.5 12h7" /></S>
/** Overflow / Android menu: three vertical dots. */
export const IcMore = (p: P) => <S {...p}><circle cx="12" cy="5.5" r="1.35" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.35" fill="currentColor" stroke="none" /><circle cx="12" cy="18.5" r="1.35" fill="currentColor" stroke="none" /></S>
