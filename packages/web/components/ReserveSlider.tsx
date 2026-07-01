"use client";

// Reserve = the % of the pool the host keeps and does not sell. 0..99, step 0.5 (-> reserveBps × 100).
export function ReserveSlider({
  value,
  onChange,
}: {
  value: number; // percent, 0..99
  onChange: (v: number) => void;
}) {
  const fillPct = (value / 99) * 100;

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-[13px] text-txt-muted">Your reserve</div>
          <div className="text-[11px] text-txt-faint">The slice of the pool you keep</div>
        </div>
        <div className="font-mono text-[42px] font-bold tracking-[-1.5px] text-accent">
          {value % 1 === 0 ? value : value.toFixed(1)}%
        </div>
      </div>

      <input
        type="range"
        min={0}
        max={99}
        step={0.5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mp-range mt-3"
        style={{ ["--fill" as string]: `${fillPct}%` }}
        aria-label="Reserve percentage"
      />

      <div className="mt-4 space-y-3 rounded-box border border-white/[0.06] bg-inset p-[14px]">
        <Bullet lead="Your stake:">
          {value === 0
            ? "you keep none of the pool. It's all for sale to friends."
            : `you keep ${value % 1 === 0 ? value : value.toFixed(1)}% of the pool. The rest is for sale to friends.`}
        </Bullet>
        <Bullet lead="Your money back:">as friends buy in, you get repaid.</Bullet>
        <Bullet lead="The fees:">
          the pool earns a 10% referral fee. Sell out and it's split among shareholders; fall short and you keep it.
        </Bullet>
        <Bullet lead="If it wins:">you keep 10% of the prize, on top of your stake&apos;s share.</Bullet>
      </div>
    </div>
  );
}

function Bullet({ lead, children }: { lead: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-[12px] text-txt-muted">
      <span className="mt-[6px] h-[6px] w-[6px] shrink-0 rounded-full bg-accent" />
      <span>
        <span className="font-semibold text-txt">{lead}</span> {children}
      </span>
    </div>
  );
}
