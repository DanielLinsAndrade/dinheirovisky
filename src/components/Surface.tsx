import type { ComponentProps, ReactNode } from "react";
import { Icon } from "./Icon";

export function Surface({
  className = "",
  ...props
}: ComponentProps<"section">) {
  return <section className={`ui-surface ${className}`} {...props} />;
}

export function Metric({
  label,
  value,
  tone = "neutral",
  icon,
  children,
  testId,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative" | "neutral" | "brand";
  icon: ComponentProps<typeof Icon>["name"];
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <Surface className={`metric metric-${tone}`} aria-label={label}>
      <span className="metric-symbol">
        <Icon name={icon} />
      </span>
      <div className="metric-body">
        <h2>{label}</h2>
        <strong data-testid={testId}>{value}</strong>
        <div className="metric-footnote">{children}</div>
      </div>
    </Surface>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "positive" | "negative" | "neutral" | "warning";
}) {
  return <span className={`ui-badge badge-${tone}`}>{children}</span>;
}
