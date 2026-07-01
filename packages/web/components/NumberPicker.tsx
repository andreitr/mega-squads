"use client";

import { useEffect, useState } from "react";
import { type Ticket, randomTicket, isCompleteTicket, NORMALS_COUNT, pad2 } from "@/lib/tickets";

export function NumberPicker({
  open,
  ticket,
  ballMax,
  bonusballMax,
  onSave,
  onClose,
}: {
  open: boolean;
  ticket: Ticket | null;
  ballMax: number;
  bonusballMax: number;
  onSave: (t: Ticket) => void;
  onClose: () => void;
}) {
  const [normals, setNormals] = useState<number[]>([]);
  const [bonus, setBonus] = useState<number | null>(null);

  // Seed the draft from the incoming ticket each time the picker opens.
  useEffect(() => {
    if (open && ticket) {
      setNormals([...ticket.normals]);
      setBonus(ticket.bonusball ?? null);
    }
  }, [open, ticket]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const draft: Ticket = { normals, bonusball: bonus ?? 0 };
  const complete = isCompleteTicket(draft, ballMax, bonusballMax);

  const toggleNormal = (n: number) => {
    setNormals((prev) => {
      if (prev.includes(n)) return prev.filter((x) => x !== n);
      // At the cap: drop the most recently selected number and take this one instead.
      if (prev.length >= NORMALS_COUNT) return [...prev.slice(0, NORMALS_COUNT - 1), n];
      return [...prev, n];
    });
  };

  const shuffle = () => {
    const t = randomTicket(ballMax, bonusballMax);
    setNormals(t.normals);
    setBonus(t.bonusball);
  };

  const clear = () => {
    setNormals([]);
    setBonus(null);
  };

  const done = () => {
    if (!complete) return;
    onSave({ normals: [...normals].sort((a, b) => a - b), bonusball: bonus as number });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Pick ticket numbers"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-[460px] overflow-y-auto rounded-t-card border border-white/[0.08] bg-surface p-5 sm:rounded-card"
      >
        {/* Numbers */}
        <Section
          title="Numbers"
          countLabel={`${normals.length} of ${NORMALS_COUNT}`}
          onShuffle={shuffle}
          onClear={clear}
        >
          <Grid max={ballMax}>
            {(n) => (
              <Cell key={n} selected={normals.includes(n)} onClick={() => toggleNormal(n)}>
                {pad2(n)}
              </Cell>
            )}
          </Grid>
        </Section>

        {/* Bonus */}
        <div className="mt-5">
          <Section title="Bonus" countLabel={`${bonus ? 1 : 0} of 1`}>
            <Grid max={bonusballMax}>
              {(n) => (
                <Cell key={n} selected={bonus === n} onClick={() => setBonus(bonus === n ? null : n)}>
                  {pad2(n)}
                </Cell>
              )}
            </Grid>
          </Section>
        </div>

        {/* Footer */}
        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-btn border border-white/[0.1] py-3 text-[14px] font-semibold text-txt-muted hover:text-txt"
          >
            Cancel
          </button>
          <button
            onClick={done}
            disabled={!complete}
            className="flex-1 rounded-btn bg-accent py-3 text-[14px] font-semibold text-bg disabled:bg-inset disabled:text-txt-faint disabled:opacity-60"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  countLabel,
  onShuffle,
  onClear,
  children,
}: {
  title: string;
  countLabel: string;
  onShuffle?: () => void;
  onClear?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <span className="text-[20px] font-bold text-txt">{title}</span>
          <span className="text-[15px] font-medium text-txt-faint">{countLabel}</span>
        </div>
        {(onShuffle || onClear) && (
          <div className="flex items-center gap-4">
            {onShuffle && (
              <button
                onClick={onShuffle}
                className="flex items-center gap-1.5 text-[14px] font-semibold text-txt-muted hover:text-txt"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
                </svg>
                Shuffle
              </button>
            )}
            {onClear && (
              <button
                onClick={onClear}
                className="flex items-center gap-1.5 text-[14px] font-semibold text-txt-muted hover:text-txt"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 20H7L3 12l4-8h13M18 9l-6 6M12 9l6 6" />
                </svg>
                Clear
              </button>
            )}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

function Grid({ max, children }: { max: number; children: (n: number) => React.ReactNode }) {
  return (
    <div className="grid grid-cols-8 gap-2">
      {Array.from({ length: max }, (_, i) => children(i + 1))}
    </div>
  );
}

function Cell({
  children,
  selected,
  onClick,
}: {
  children: React.ReactNode;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex aspect-square items-center justify-center rounded-full font-mono text-[13px] transition-colors ${
        selected ? "bg-accent text-bg shadow-ball" : "bg-inset text-txt hover:bg-raised"
      }`}
    >
      {children}
    </button>
  );
}
