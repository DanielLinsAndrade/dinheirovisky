import type { ComponentProps } from "react";

export function Button({
  variant = "secondary",
  className = "",
  type = "button",
  ...props
}: ComponentProps<"button"> & { variant?: "primary" | "secondary" | "quiet" }) {
  return (
    <button
      type={type}
      className={`action ui-button ${variant === "primary" ? "primary" : variant === "quiet" ? "ui-quiet" : ""} ${className}`}
      {...props}
    />
  );
}

export function IconButton({
  label,
  ...props
}: Omit<ComponentProps<typeof Button>, "aria-label"> & { label: string }) {
  return (
    <Button
      {...props}
      className={`ui-icon-button ${props.className ?? ""}`}
      aria-label={label}
      title={label}
    />
  );
}
