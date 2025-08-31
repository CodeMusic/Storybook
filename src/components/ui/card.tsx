import * as React from "react";

export const Card: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className = "", ...props }) =>
{
  return <div className={`rounded-2xl border bg-white ${className}`} {...props} />;
};

export const CardHeader: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className = "", ...props }) =>
{
  return <div className={`px-4 py-3 border-b ${className}`} {...props} />;
};

export const CardTitle: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className = "", ...props }) =>
{
  return <div className={`text-lg font-semibold ${className}`} {...props} />;
};

export const CardContent: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className = "", ...props }) =>
{
  return <div className={`px-4 py-3 ${className}`} {...props} />;
};


