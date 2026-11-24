import { KeyRoundIcon, ShieldCheckIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { VersionBadge } from '@shared/app-version';

/**
 * Composes the split KeePort sign-in screen around the supplied account flow.
 * @param props - The application area, theme action, and sign-in or setup content to render.
 */
export function AuthLayout({
  area,
  themeAction,
  children
}: {
  area: 'Vault' | 'Admin';
  themeAction: ReactNode;
  children: ReactNode;
}) {
  const admin = area === 'Admin';
  return (
    <main className="relative grid min-h-svh place-items-center bg-muted/35 px-4 py-16 sm:px-8">
      <div className="absolute end-4 top-4 sm:end-6 sm:top-6">{themeAction}</div>
      <Card className="grid w-full max-w-4xl gap-0 overflow-hidden p-0 md:grid-cols-2">
        <CardContent className="flex flex-col justify-center p-6 sm:p-10 lg:p-12">
          <div className="mb-8 flex items-center gap-2.5 text-sm font-semibold">
            <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
              <KeyRoundIcon className="size-4" />
            </span>
            KeePort <span className="font-normal text-muted-foreground">/ {area}</span>
            <VersionBadge className="ms-1" />
          </div>
          {children}
        </CardContent>
        <div className="relative hidden min-h-110 overflow-hidden border-s bg-muted/65 md:flex md:flex-col md:justify-between">
          <svg
            aria-hidden="true"
            viewBox="0 0 420 420"
            preserveAspectRatio="xMidYMid slice"
            className="absolute inset-0 size-full text-foreground/10"
            fill="none"
          >
            <defs>
              <pattern id="keeport-grid" width="28" height="28" patternUnits="userSpaceOnUse">
                <path d="M0 28V0H28" stroke="currentColor" />
              </pattern>
            </defs>
            <rect width="420" height="420" fill="url(#keeport-grid)" />
            <circle cx="210" cy="191" r="64" stroke="currentColor" />
            <circle cx="210" cy="191" r="93" stroke="currentColor" />
            <circle cx="210" cy="191" r="122" stroke="currentColor" />
          </svg>
          <div className="relative flex items-center gap-2 p-7 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            <span className="size-1.5 rounded-full bg-emerald-500" /> Self-hosted workspace
          </div>
          <div className="absolute inset-0 grid -translate-y-5 place-items-center" aria-hidden="true">
            <div className="grid size-24 place-items-center rounded-3xl border bg-card shadow-sm">
              <ShieldCheckIcon strokeWidth={1.25} className="size-11" />
            </div>
          </div>
          <div className="relative space-y-2 bg-linear-to-t from-muted via-muted/90 to-transparent px-8 pt-10 pb-8">
            <p className="text-xl font-semibold tracking-tight">
              {admin ? 'Your vaults. Your server.' : 'Your secrets stay yours.'}
            </p>
            <p className="max-w-72 text-sm leading-relaxed text-muted-foreground">
              {admin
                ? 'Manage vault files, user access and WebDAV from one secure console.'
                : 'Your KeePass vault unlocks in this browser. KeePort never receives your master password.'}
            </p>
          </div>
        </div>
      </Card>
    </main>
  );
}
