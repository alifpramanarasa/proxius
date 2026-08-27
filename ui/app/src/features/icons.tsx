import type { SVGProps } from "react";

// Ikon garis minimal (monokrom, currentColor). Bukan emoji, tanpa library.
// Ukuran default 1em → mengikuti font-size elemen pemanggil.

function Base({ children, ...p }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      {children}
    </svg>
  );
}

export const IconSettings = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <line x1="4" y1="7" x2="20" y2="7" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="17" x2="20" y2="17" />
    <circle cx="9" cy="7" r="2" />
    <circle cx="15" cy="12" r="2" />
    <circle cx="9" cy="17" r="2" />
  </Base>
);

export const IconRealtime = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M3 12h4l3 8 4-16 3 8h4" />
  </Base>
);

export const IconKey = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <circle cx="7.5" cy="15.5" r="4.5" />
    <path d="M10.5 12.5 21 2" />
    <path d="m16.5 6.5 2.5 2.5" />
  </Base>
);

export const IconFolderPlus = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M4 20V6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
    <path d="M12 11v6M9 14h6" />
  </Base>
);

export const IconFolder = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M4 20V6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
  </Base>
);

export const IconRun = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p} fill="currentColor" stroke="none">
    <path d="M8 5v14l11-7z" />
  </Base>
);

export const IconDownload = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M12 3v12" />
    <path d="m7 11 5 5 5-5" />
    <path d="M5 21h14" />
  </Base>
);

export const IconPlus = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M12 5v14M5 12h14" />
  </Base>
);

export const IconSearch = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Base>
);

export const IconInbox = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M3 12h5l2 3h4l2-3h5" />
    <path d="M5 5h14l2 7v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z" />
  </Base>
);

export const IconBraces = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M8 4c-2 0-2 2-2 4s0 4-2 4c2 0 2 2 2 4s0 4 2 4" />
    <path d="M16 4c2 0 2 2 2 4s0 4 2 4c-2 0-2 2-2 4s0 4-2 4" />
  </Base>
);

export const IconSun = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Base>
);

export const IconMoon = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </Base>
);
