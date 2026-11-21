/** 83456 ms -> "1:23.456". */
export function fmtTime(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '--:--.---';
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000), t = Math.floor(ms % 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(t).padStart(3, '0')}`;
}
/** gap in seconds -> "+1.3". */
export const fmtGap = (sec) => (sec == null || !Number.isFinite(sec) ? '' : '+' + (sec < 10 ? sec.toFixed(1) : Math.round(sec)));
export const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10 < 4 ? n % 10 : 0] || 'th');
