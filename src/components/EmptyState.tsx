import React from 'react';
import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title?: string;
  message: string;
  detail?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ icon: Icon, title = 'No data available', message, detail }) => (
  <div role="status" className="flex min-h-[260px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-700 bg-slate-900/40 px-6 py-12 text-center">
    <span className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-slate-500">
      <Icon className="h-6 w-6" />
    </span>
    <p className="text-[13px] font-semibold text-slate-200">{title}</p>
    <p className="max-w-md text-[12px] leading-relaxed text-slate-400">{message}</p>
    {detail && <p className="max-w-md text-[11px] leading-relaxed text-slate-500">{detail}</p>}
  </div>
);
