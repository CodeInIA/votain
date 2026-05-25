import {
  BarChart as ReBarChart,
  Bar,
  XAxis,
  YAxis,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { cn } from '../../lib/utils';

interface TooltipPayload {
  value: number;
  payload: { label: string; value: number };
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="px-3 py-2 rounded-xl bg-surface-highest/90 backdrop-blur-sm border border-white/10 text-xs shadow-lg">
      <p className="font-semibold text-on-surface">{d.label}</p>
      <p className="text-on-surface-variant mt-0.5">{d.value.toLocaleString()}</p>
    </div>
  );
}

interface MiniBarChartProps {
  data: Array<{ label: string; value: number }>;
  height?: number;
  className?: string;
}

export function MiniBarChart({ data, height = 80, className }: MiniBarChartProps) {
  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ReBarChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#7c7f8e' }} axisLine={false} tickLine={false} />
          <YAxis hide />
          <Tooltip content={<CustomTooltip />} cursor={false} />
          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
            {data.map((_: { label: string; value: number }, i: number) => (
              <Cell key={i} fill="rgba(79,142,247,0.5)" />
            ))}
          </Bar>
        </ReBarChart>
      </ResponsiveContainer>
    </div>
  );
}
