// USDC has 6 decimals on Base. All on-chain amounts in this app are USDC.
export const USDC_DECIMALS = 6;

export function formatUsdc(v: bigint | undefined | null, opts?: { dp?: number }) {
  if (v === undefined || v === null) return "—";
  const dp = opts?.dp ?? 2;
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(USDC_DECIMALS);
  const whole = abs / base;
  const frac = abs % base;
  const fracStr = frac.toString().padStart(USDC_DECIMALS, "0").slice(0, dp);
  const wholeWithCommas = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}$${wholeWithCommas}${dp > 0 ? "." + fracStr : ""}`;
}

// Bigint USDC -> plain number (for ratios/sliders). Safe for the small amounts in this app.
export function usdcToNumber(v: bigint | undefined | null) {
  if (v === undefined || v === null) return 0;
  return Number(v) / 10 ** USDC_DECIMALS;
}

export function shortAddr(a?: string) {
  if (!a) return "";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

// "0x7a2f..9c41" — the design's two-dot address style (mono, used on cards/detail/verify).
export function dotAddr(a?: string) {
  if (!a) return "";
  return `${a.slice(0, 6)}..${a.slice(-4)}`;
}

// Megapot jackpot headline: whole-dollar with thousands separators, e.g. 250776_123456n -> "$250,776".
export function jackpotUsd(v: bigint | undefined | null) {
  if (v === undefined || v === null) return "$—";
  const whole = v / 10n ** BigInt(USDC_DECIMALS);
  return `$${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

// "HH:MM:SS" countdown to a unix-seconds deadline; clamps at 0. For the jackpot / drawing timer.
export function hms(deadline: bigint | undefined | null, nowMs: number) {
  if (!deadline || deadline === 0n) return "00:00:00";
  const diff = Math.max(0, Number(deadline) - Math.floor(nowMs / 1000));
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  return [h, m, s].map((n) => n.toString().padStart(2, "0")).join(":");
}

// "in 6h 12m 03s" / "closed 0h 04m ago" — for the Megapot drawing time.
export function countdown(deadline: bigint | undefined | null, now: number) {
  if (!deadline || deadline === 0n) return { label: "—", ended: true };
  const dl = Number(deadline);
  const diff = dl - Math.floor(now / 1000);
  const ended = diff <= 0;
  const a = Math.abs(diff);
  const h = Math.floor(a / 3600);
  const m = Math.floor((a % 3600) / 60);
  const s = a % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  const body = `${h}h ${pad(m)}m ${pad(s)}s`;
  return { label: ended ? `closed ${body} ago` : `in ${body}`, ended };
}

// Sell-through percentage (0..100) from sold / forSale, clamped.
export function pct(sold: bigint, forSale: bigint): number {
  if (forSale === 0n) return 0;
  const p = Number((sold * 10000n) / forSale) / 100;
  return Math.max(0, Math.min(100, p));
}

// reserveBps (basis points) -> human percent string, e.g. 250 -> "2.5%".
export function reservePct(bps: number | bigint): string {
  const n = Number(bps) / 100;
  return `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
}
