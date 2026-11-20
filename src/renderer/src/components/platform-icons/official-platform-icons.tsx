import type { SVGProps } from "react";

export interface PlatformIconProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

/**
 * Official Apple logo silhouette for macOS.
 */
export function MacOSLogoIcon({
  size = 18,
  ...props
}: Readonly<PlatformIconProps>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.96 6.32c.64-.78 1.08-1.86.96-2.94-.93.04-2.06.62-2.72 1.4-.58.68-1.1 1.78-.96 2.84 1.04.08 2.09-.52 2.72-1.3z" />
    </svg>
  );
}

/**
 * Official Apple iPhone + iPad duo icon (SF Symbols `ipad.and.iphone` style) for iOS / iPadOS.
 */
export function IosIpadOsIcon({
  size = 18,
  ...props
}: Readonly<PlatformIconProps>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {/* iPad (back-left) */}
      <path d="M13 19.5H4.8A1.8 1.8 0 0 1 3 17.7V5.3A1.8 1.8 0 0 1 4.8 3.5h9.9a1.8 1.8 0 0 1 1.8 1.8V8" />
      <line x1="8.2" y1="17" x2="10.8" y2="17" />
      {/* iPhone (front-right) */}
      <rect x="13.5" y="8.5" width="7.5" height="12.5" rx="1.8" />
      <line x1="16.2" y1="10.6" x2="18.3" y2="10.6" />
      <line x1="16" y1="18.8" x2="18.5" y2="18.8" />
    </svg>
  );
}

/**
 * Official Android robot head silhouette (with antennae and eye cutouts).
 */
export function AndroidOfficialIcon({
  size = 18,
  ...props
}: Readonly<PlatformIconProps>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M16.92 8.21l1.52-2.63a.55.55 0 0 0-.2-.75.55.55 0 0 0-.75.2l-1.56 2.7A9.47 9.47 0 0 0 12 6.9c-1.42 0-2.75.3-3.93.83L6.51 5.03a.55.55 0 0 0-.75-.2.55.55 0 0 0-.2.75l1.52 2.63C4.47 9.65 2.7 12.33 2.5 15.5h19c-.2-3.17-1.97-5.85-4.58-7.29zM8.5 13a1.1 1.1 0 1 1 0-2.2 1.1 1.1 0 0 1 0 2.2zm7 0a1.1 1.1 0 1 1 0-2.2 1.1 1.1 0 0 1 0 2.2z"
      />
    </svg>
  );
}

/**
 * Official Windows 4-pane logo.
 */
export function WindowsLogoIcon({
  size = 18,
  ...props
}: Readonly<PlatformIconProps>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M3 4.5l7.5-1.1v7.4H3V4.5zm8.7-1.27L21 2v8.8h-9.3V3.23zM3 12h7.5v7.4L3 18.3V12zm8.7 0H21v8.8l-9.3-1.23V12z" />
    </svg>
  );
}
