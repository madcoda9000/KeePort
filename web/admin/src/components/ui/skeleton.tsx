import { cn } from "cn"

/**
 * Shows a loading placeholder.
 * @param props - CSS class overrides, the remaining Skeleton attributes forwarded to its element.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
