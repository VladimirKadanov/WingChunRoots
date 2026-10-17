// A QR code as SVG (milestone M02: the TOTP setup). The modules are computed on the server
// (src/server/auth/totp.ts), so the QR encoder never ships to the browser. Ink on a paper slip in
// both themes (.theme-light): authenticator apps do not all read a light code on a dark ground.

import { cx } from '@/lib/cx';

export interface QrModules {
  /** SVG path of the dark modules, one unit per module. */
  path: string;
  /** Modules per side, border included. */
  size: number;
}

export function QrCode({ qr, label, className }: { qr: QrModules; label: string; className?: string }) {
  return (
    <div className={cx('theme-light w-fit justify-self-start rounded-sm border border-border-strong bg-surface-1 p-2 text-fg', className)}>
      <svg role="img" aria-label={label} viewBox={`0 0 ${qr.size} ${qr.size}`} width={200} height={200} shapeRendering="crispEdges" className="block size-[200px]">
        <path d={qr.path} fill="currentColor" />
      </svg>
    </div>
  );
}
