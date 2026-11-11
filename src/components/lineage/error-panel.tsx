// The frame of an error state (plan §5.6; milestone M04), in a module of its own so that a client
// error boundary (src/app/people/[slug]/error.tsx) does not bring the rest of states.tsx with it.

import { AlertIcon } from '@/components/icons';
import { cx } from '@/lib/cx';

/** The frame of an error state: a danger rule, an alert icon and a title, never colour alone. */
export function ErrorPanel({
  title,
  children,
  className,
  ref,
  ...props
}: { title: string; children: React.ReactNode; className?: string; ref?: React.Ref<HTMLDivElement> } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      ref={ref}
      role="alert"
      className={cx('grid justify-items-start gap-3 rounded-sm border-l-4 border-danger bg-surface-2 px-4 py-4 outline-none', className)}
      {...props}
    >
      <p className="flex items-start gap-2 text-ui font-semibold">
        <AlertIcon size={18} className="mt-0.5 shrink-0 text-danger" />
        <span>{title}</span>
      </p>
      {children}
    </div>
  );
}
