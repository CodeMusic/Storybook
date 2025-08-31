import * as React from "react";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
};

export const Button: React.FC<ButtonProps> = ({ variant = "primary", className = "", ...props }) =>
{
  const base = "inline-flex items-center justify-center rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-60 disabled:pointer-events-none";
  const variants: Record<string, string> = {
    primary: "bg-amber-600 text-white hover:bg-amber-700",
    secondary: "bg-amber-100 text-amber-900 hover:bg-amber-200",
    ghost: "bg-transparent hover:bg-amber-100 text-amber-900",
  };
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
};


