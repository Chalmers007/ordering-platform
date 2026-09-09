import { cn } from '@/lib/cn';

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-lg border border-neutral-200 bg-white shadow-sm', className)}
      {...props}
    />
  );
}
