import { Lock } from 'lucide-react';

/**
 * A muted, locked-looking panel for a one-line status message — used wherever a
 * phase offers no action (e.g. "voting hasn't started yet", "election voided").
 */
export function StatusNotice({ message }: { message: string }) {
  return (
    <div className="bg-surface-low/30 backdrop-blur-xl rounded-3xl border border-white/5 p-5 flex items-center gap-3">
      <Lock className="w-5 h-5 text-on-surface-meta shrink-0" />
      <p className="text-sm text-on-surface-variant">{message}</p>
    </div>
  );
}
