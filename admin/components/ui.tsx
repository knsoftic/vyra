'use client';

import React from 'react';
import { Icon, IconName } from './Icon';

/* ────────────────────────────── Page shell ────────────────────────────── */

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle ? <p className="text-muted text-xs mt-1 max-w-2xl">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({
  children,
  className = '',
  padded = true,
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={`bg-surface border border-border rounded-xl ${padded ? 'p-4' : ''} ${className}`}
    >
      {children}
    </div>
  );
}

export function SectionCard({
  title,
  description,
  action,
  children,
  className = '',
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-surface border border-border rounded-xl ${className}`}>
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border">
        <div>
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {description ? <p className="text-dim text-xs mt-0.5">{description}</p> : null}
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

/* ──────────────────────────────── Buttons ─────────────────────────────── */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';

export function Button({
  children,
  variant = 'secondary',
  icon,
  size = 'md',
  onClick,
  disabled,
  className = '',
  type = 'button',
}: {
  children?: React.ReactNode;
  variant?: ButtonVariant;
  icon?: IconName;
  size?: 'sm' | 'md';
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  type?: 'button' | 'submit';
}) {
  const variants: Record<ButtonVariant, string> = {
    primary: 'bg-brand text-white hover:bg-brand-dim border border-transparent',
    secondary: 'bg-surface-2 text-ink hover:bg-border border border-border',
    ghost: 'bg-transparent text-muted hover:text-ink hover:bg-surface-2 border border-transparent',
    danger: 'bg-danger/15 text-danger hover:bg-danger/25 border border-danger/30',
    outline: 'bg-transparent text-ink hover:bg-surface-2 border border-border-strong',
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none ${
        size === 'sm' ? 'text-xs px-2.5 py-1.5' : 'text-xs px-3 py-2'
      } ${variants[variant]} ${className}`}
    >
      {icon ? <Icon name={icon} size={14} /> : null}
      {children}
    </button>
  );
}

export function IconButton({
  icon,
  onClick,
  label,
  tone = 'default',
}: {
  icon: IconName;
  onClick?: () => void;
  label: string;
  tone?: 'default' | 'danger';
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`p-1.5 rounded-md transition-colors ${
        tone === 'danger'
          ? 'text-dim hover:text-danger hover:bg-danger/10'
          : 'text-dim hover:text-ink hover:bg-surface-2'
      }`}
    >
      <Icon name={icon} size={15} />
    </button>
  );
}

/* ──────────────────────────────── Badges ──────────────────────────────── */

export type Tone = 'neutral' | 'brand' | 'success' | 'warn' | 'danger' | 'info';

const toneClasses: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-muted border-border',
  brand: 'bg-brand/15 text-brand border-brand/25',
  success: 'bg-accent/15 text-accent border-accent/25',
  warn: 'bg-warn/15 text-warn border-warn/25',
  danger: 'bg-danger/15 text-danger border-danger/25',
  info: 'bg-info/15 text-info border-info/25',
};

export function Badge({
  children,
  tone = 'neutral',
  dot = false,
}: {
  children: React.ReactNode;
  tone?: Tone;
  dot?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap ${toneClasses[tone]}`}
    >
      {dot ? <span className="w-1.5 h-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

/* ──────────────────────────────── Stats ───────────────────────────────── */

export function Stat({
  label,
  value,
  delta,
  icon,
  tone = 'brand',
  hint,
}: {
  label: string;
  value: string;
  delta?: string;
  icon?: IconName;
  tone?: Tone;
  hint?: string;
}) {
  const positive = delta ? !delta.startsWith('-') : true;
  return (
    <div className="bg-surface border border-border rounded-xl p-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-dim text-[11px] uppercase tracking-wide">{label}</span>
        {icon ? (
          <span className={`${toneClasses[tone]} border rounded-md p-1`}>
            <Icon name={icon} size={12} />
          </span>
        ) : null}
      </div>
      <div className="mt-1.5 text-xl font-semibold tnum text-ink">{value}</div>
      <div className="flex items-center gap-2 mt-1">
        {delta ? (
          <span
            className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${
              positive ? 'text-accent' : 'text-danger'
            }`}
          >
            <Icon name={positive ? 'arrowUp' : 'arrowDown'} size={10} />
            {delta}
          </span>
        ) : null}
        {hint ? <span className="text-dim text-[11px]">{hint}</span> : null}
      </div>
    </div>
  );
}

/* ──────────────────────────────── Tables ──────────────────────────────── */

export function Table({
  columns,
  children,
  className = '',
}: {
  columns: (string | { label: string; align?: 'left' | 'right' | 'center'; width?: string })[];
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full text-xs border-collapse min-w-[640px]">
        <thead>
          <tr className="border-b border-border">
            {columns.map((column, index) => {
              const config = typeof column === 'string' ? { label: column } : column;
              return (
                <th
                  key={index}
                  style={config.width ? { width: config.width } : undefined}
                  className={`px-3 py-2 font-medium text-dim text-[11px] uppercase tracking-wide whitespace-nowrap ${
                    config.align === 'right'
                      ? 'text-right'
                      : config.align === 'center'
                        ? 'text-center'
                        : 'text-left'
                  }`}
                >
                  {config.label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Row({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <tr
      onClick={onClick}
      className={`border-b border-border/60 last:border-0 hover:bg-surface-2/60 transition-colors ${
        onClick ? 'cursor-pointer' : ''
      }`}
    >
      {children}
    </tr>
  );
}

export function Cell({
  children,
  align = 'left',
  className = '',
  mono = false,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
  mono?: boolean;
}) {
  return (
    <td
      className={`px-3 py-2.5 align-middle ${
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
      } ${mono ? 'tnum' : ''} ${className}`}
    >
      {children}
    </td>
  );
}

/* ──────────────────────────────── Inputs ──────────────────────────────── */

export function SearchInput({
  placeholder = 'Search',
  value,
  onChange,
  className = '',
}: {
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center gap-2 bg-surface-2 border border-border rounded-lg px-2.5 h-8 ${className}`}
    >
      <Icon name="search" size={13} className="text-dim shrink-0" />
      <input
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        placeholder={placeholder}
        className="bg-transparent outline-none text-xs w-full placeholder:text-dim"
      />
    </div>
  );
}

export function Select({
  value,
  onChange,
  options,
  className = '',
}: {
  value: string;
  onChange?: (value: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
      className={`bg-surface-2 border border-border rounded-lg px-2.5 h-8 text-xs outline-none focus:border-brand ${className}`}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} className="bg-surface">
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  type = 'text',
  multiline = false,
  suffix,
}: {
  label?: string;
  value?: string | number;
  onChange?: (value: string) => void;
  placeholder?: string;
  hint?: string;
  type?: string;
  multiline?: boolean;
  suffix?: string;
}) {
  return (
    <label className="block">
      {label ? <span className="block text-[11px] text-muted mb-1">{label}</span> : null}
      <div className="flex items-center gap-2">
        {multiline ? (
          <textarea
            value={value}
            onChange={(event) => onChange?.(event.target.value)}
            placeholder={placeholder}
            rows={3}
            className="w-full bg-surface-2 border border-border rounded-lg px-2.5 py-2 text-xs outline-none focus:border-brand placeholder:text-dim resize-y"
          />
        ) : (
          <input
            type={type}
            value={value}
            onChange={(event) => onChange?.(event.target.value)}
            placeholder={placeholder}
            className="w-full bg-surface-2 border border-border rounded-lg px-2.5 h-8 text-xs outline-none focus:border-brand placeholder:text-dim tnum"
          />
        )}
        {suffix ? <span className="text-dim text-xs whitespace-nowrap">{suffix}</span> : null}
      </div>
      {hint ? <span className="block text-[11px] text-dim mt-1">{hint}</span> : null}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange?: (next: boolean) => void;
  label?: string;
  description?: string;
}) {
  const control = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange?.(!checked)}
      className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${
        checked ? 'bg-brand' : 'bg-border-strong'
      }`}
    >
      <span
        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  );

  if (!label) return control;

  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="min-w-0">
        <div className="text-xs text-ink">{label}</div>
        {description ? <div className="text-[11px] text-dim mt-0.5">{description}</div> : null}
      </div>
      {control}
    </div>
  );
}

export function Slider({
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  label,
  suffix,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange?: (value: number) => void;
  label?: string;
  suffix?: string;
}) {
  return (
    <div>
      {label ? (
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-muted">{label}</span>
          <span className="text-xs text-ink tnum font-medium">
            {value}
            {suffix}
          </span>
        </div>
      ) : null}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange?.(Number(event.target.value))}
        className="w-full accent-brand h-1 cursor-pointer"
      />
    </div>
  );
}

/* ──────────────────────────────── Tabs ────────────────────────────────── */

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex items-center gap-1 bg-surface-2 border border-border rounded-lg p-1 overflow-x-auto">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`px-3 py-1.5 rounded-md text-xs whitespace-nowrap transition-colors ${
            value === tab.id ? 'bg-brand text-white font-medium' : 'text-muted hover:text-ink'
          }`}
        >
          {tab.label}
          {tab.count !== undefined ? (
            <span className={`ml-1.5 tnum ${value === tab.id ? 'text-white/70' : 'text-dim'}`}>
              {tab.count}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/* ──────────────────────────────── Charts ──────────────────────────────── */

export function BarChart({
  data,
  height = 120,
  accent = 'var(--color-brand)',
}: {
  data: { label: string; value: number }[];
  height?: number;
  accent?: string;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div>
      <div className="flex items-end gap-1.5" style={{ height }}>
        {data.map((point) => (
          <div key={point.label} className="flex-1 flex flex-col justify-end group relative">
            <div
              className="w-full rounded-t transition-all"
              style={{
                height: `${Math.max(3, (point.value / max) * 100)}%`,
                // color-mix keeps this valid when `accent` is a CSS variable —
                // appending a hex alpha to var() would not parse.
                background: `linear-gradient(to top, color-mix(in srgb, ${accent} 25%, transparent), ${accent})`,
              }}
            />
            <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] tnum text-ink opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
              {point.value.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 mt-1.5">
        {data.map((point) => (
          <span key={point.label} className="flex-1 text-center text-[10px] text-dim truncate">
            {point.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function ProgressBar({
  percent,
  tone = 'brand',
  showLabel = false,
}: {
  percent: number;
  tone?: Tone;
  showLabel?: boolean;
}) {
  const colors: Record<Tone, string> = {
    brand: 'bg-brand',
    success: 'bg-accent',
    warn: 'bg-warn',
    danger: 'bg-danger',
    info: 'bg-info',
    neutral: 'bg-border-strong',
  };
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-surface-2 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${colors[tone]}`}
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
      {showLabel ? (
        <span className="text-[11px] text-muted tnum w-8 text-right">{Math.round(percent)}%</span>
      ) : null}
    </div>
  );
}

export function Breakdown({
  items,
  accent = 'brand',
}: {
  items: { label: string; percent: number }[];
  accent?: Tone;
}) {
  return (
    <div className="space-y-2.5">
      {items.map((item) => (
        <div key={item.label}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-ink truncate">{item.label}</span>
            <span className="text-xs text-muted tnum">{item.percent}%</span>
          </div>
          <ProgressBar percent={item.percent} tone={accent} />
        </div>
      ))}
    </div>
  );
}

/* ──────────────────────────────── Misc ────────────────────────────────── */

export function Avatar({
  src,
  name,
  size = 28,
}: {
  src?: string;
  name?: string;
  size?: number;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <span
      className="inline-flex items-center justify-center rounded-full bg-surface-2 border border-border overflow-hidden shrink-0 text-[10px] text-muted"
      style={{ width: size, height: size }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name ?? ''} width={size} height={size} className="object-cover w-full h-full" />
      ) : (
        (name ?? '?').slice(0, 1).toUpperCase()
      )}
    </span>
  );
}

export function EmptyState({
  icon = 'info',
  title,
  description,
}: {
  icon?: IconName;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <span className="p-2.5 rounded-lg bg-surface-2 border border-border text-dim mb-3">
        <Icon name={icon} size={18} />
      </span>
      <p className="text-sm text-ink font-medium">{title}</p>
      {description ? <p className="text-xs text-dim mt-1 max-w-sm">{description}</p> : null}
    </div>
  );
}

export function Notice({
  tone = 'info',
  icon = 'info',
  title,
  children,
}: {
  tone?: Tone;
  icon?: IconName;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-xs ${toneClasses[tone]}`}>
      <Icon name={icon} size={14} className="mt-0.5 shrink-0" />
      <div className="leading-relaxed">
        {title ? <div className="font-semibold mb-0.5">{title}</div> : null}
        {children}
      </div>
    </div>
  );
}

export function KeyValue({ rows }: { rows: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="divide-y divide-border">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center justify-between gap-4 py-2">
          <dt className="text-xs text-muted">{row.label}</dt>
          <dd className="text-xs text-ink text-right">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
