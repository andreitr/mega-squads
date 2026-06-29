"use client";

// "Pool referral fees" unlock progress — fills with sell-through; unlocks (solid accent) at 100%.
export function FeeUnlockBar({ feesUsdc, pct }: { feesUsdc: string; pct: number }) {
  const unlocked = pct >= 100;
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-txt-muted">Pool referral fees</span>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[13px] font-semibold text-txt">{feesUsdc}</span>
          <span
            className="flex items-center gap-[5px] font-mono text-[9px] uppercase tracking-[0.6px]"
            style={{ color: unlocked ? "#c6ff3a" : "#645e54" }}
          >
            <span className="h-[5px] w-[5px] rounded-full" style={{ background: unlocked ? "#c6ff3a" : "#645e54" }} />
            {unlocked ? "Unlocked" : "Locked"}
          </span>
        </div>
      </div>
      <div className="mt-2 h-[7px] overflow-hidden rounded-[5px] border border-white/[0.06] bg-inset">
        <div
          className="mp-fill h-full rounded-[5px]"
          style={{ width: `${pct}%`, background: unlocked ? "#c6ff3a" : "rgba(198,255,58,0.55)" }}
        />
      </div>
      <div className="mt-1 font-mono text-[11px] text-txt-faint">
        {unlocked ? "Paid out to shareholders" : `${Math.floor(pct)}% sold · unlocks at 100%`}
      </div>
    </div>
  );
}
