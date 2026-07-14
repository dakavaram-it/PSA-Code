import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// Same helper the reference project uses: merge conditional classes so a
// caller's className always wins over a component's defaults.
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
