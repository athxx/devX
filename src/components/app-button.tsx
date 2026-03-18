import type { JSX, ParentComponent } from "solid-js";

type AppButtonProps = {
  variant?: "default" | "primary" | "success" | "danger";
  size?: "sm" | "md";
  class?: string;
  disabled?: boolean;
  onClick?: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>;
  type?: "button" | "submit" | "reset";
};

export const AppButton: ParentComponent<AppButtonProps> = (props) => {
  const variantClass = () => {
    switch (props.variant) {
      case "primary":
        return "theme-button-primary";
      case "success":
        return "bg-[#34c759] text-white";
      case "danger":
        return "bg-[#ff3b30] text-white";
      case "default":
      default:
        return "theme-control";
    }
  };

  const sizeClass = () => (props.size === "sm" ? "h-8 rounded-md px-3 py-1 text-sm font-medium" : "h-9 rounded-lg px-4 py-2 text-sm font-medium");

  return (
    <button
      type={props.type ?? "button"}
      class={`${variantClass()} ${sizeClass()} transition ${props.class ?? ""}`}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
};
