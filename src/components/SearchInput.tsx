import { useId, type ComponentProps } from "react";
import { Icon } from "./Icon";

export function SearchInput({
  label,
  ...props
}: Omit<ComponentProps<"input">, "type" | "id"> & { label: string }) {
  const id = useId();
  return (
    <div className="ui-search">
      <label htmlFor={id}>{label}</label>
      <div>
        <Icon name="search" />
        <input {...props} id={id} type="search" />
      </div>
    </div>
  );
}
