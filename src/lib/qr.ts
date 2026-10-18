// The modules of a QR code as one SVG path (milestone M02: the TOTP setup). Computed on the server
// (src/server/auth/totp.ts) and drawn by src/components/account/qr-code.tsx, so the encoder never
// ships to the browser; the type lives here, where both sides may import it.

export interface QrModules {
  /** SVG path of the dark modules, one unit per module. */
  path: string;
  /** Modules per side, border included. */
  size: number;
}
