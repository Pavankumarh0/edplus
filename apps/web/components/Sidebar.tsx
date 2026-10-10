'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cx } from './ui';

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
}

/* Inline SVGs rather than an icon package: six icons is not worth a dependency,
   and these stay crisp against the black rail at 20px. */
const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const NAV: NavItem[] = [
  {
    href: '/overview',
    label: 'Overview',
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" {...stroke}>
        <rect x="3" y="3" width="8" height="8" rx="2" />
        <rect x="13" y="3" width="8" height="5" rx="2" />
        <rect x="13" y="10" width="8" height="11" rx="2" />
        <rect x="3" y="13" width="8" height="8" rx="2" />
      </svg>
    ),
  },
  {
    href: '/students',
    label: 'Students',
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" {...stroke}>
        <circle cx="9" cy="8" r="3.2" />
        <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
        <path d="M16 11.2A3 3 0 0 0 16 5.3" />
        <path d="M18 20c0-2.5-1-4.6-2.6-5.6" />
      </svg>
    ),
  },
  {
    href: '/upload',
    label: 'Upload',
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" {...stroke}>
        <path d="M12 16V4" />
        <path d="m7.5 8.5 4.5-4.5 4.5 4.5" />
        <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
      </svg>
    ),
  },
  {
    href: '/interventions',
    label: 'Interventions',
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" {...stroke}>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M8 4v16M16 4v16" />
        <path d="M5 9h1M5 13h1M11 9h2M11 14h2M18 9h1" />
      </svg>
    ),
  },
  {
    href: '/calls',
    label: 'Parent calls',
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" {...stroke}>
        <path d="M6.5 3.5h2l1.5 4-2 1.5a11 11 0 0 0 5.5 5.5l1.5-2 4 1.5v2A2.5 2.5 0 0 1 16.5 21C9.6 21 3 14.4 3 6.5A2.5 2.5 0 0 1 6.5 3.5Z" />
      </svg>
    ),
  },
  {
    href: '/connectors',
    label: 'Connectors',
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" {...stroke}>
        <path d="M9 7V4.5a2.5 2.5 0 0 1 5 0V7" />
        <rect x="4" y="7" width="15" height="6" rx="2" />
        <path d="M11.5 13v3.5a4 4 0 0 1-4 4H6" />
        <circle cx="18" cy="18" r="2.5" />
      </svg>
    ),
  },
  {
    href: '/rules',
    label: 'Risk rules',
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" {...stroke}>
        <path d="M5 7h14M5 12h14M5 17h14" />
        <circle cx="9" cy="7" r="2" />
        <circle cx="15" cy="12" r="2" />
        <circle cx="8" cy="17" r="2" />
      </svg>
    ),
  },
];

export function Sidebar({ userLabel }: { userLabel: string }) {
  const pathname = usePathname();

  const isActive = (href: string) => pathname.startsWith(href);

  return (
    <nav
      aria-label="Main"
      className={cx(
        'bg-ink text-canvas',
        // Desktop: fixed 72px rail. Mobile: a bottom bar.
        'fixed inset-x-0 bottom-0 z-40 flex h-16 flex-row items-center justify-around px-2',
        'md:inset-y-0 md:left-0 md:right-auto md:h-auto md:w-[72px] md:flex-col md:justify-start md:gap-1 md:px-0 md:py-4',
      )}
    >
      <Link
        href="/overview"
        className="hidden md:mb-4 md:flex md:size-10 md:items-center md:justify-center"
        aria-label="EduPlus AI — Overview"
      >
        <span className="bg-lime text-ink flex size-8 items-center justify-center rounded-[var(--radius-control)] text-[15px] font-bold">
          E
        </span>
      </Link>

      {NAV.map((item) => {
        const active = isActive(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            title={item.label}
            className={cx(
              'group relative flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[var(--radius-control)] transition-colors duration-150',
              active ? 'bg-lime text-ink' : 'text-canvas/65 hover:bg-white/10 hover:text-canvas',
            )}
          >
            {item.icon}
            <span className="sr-only">{item.label}</span>
            {/* Tooltip, desktop only. */}
            <span
              role="presentation"
              className="bg-ink text-canvas pointer-events-none absolute left-full z-50 ml-2 hidden whitespace-nowrap rounded-[var(--radius-control)] px-2 py-1 text-[12px] opacity-0 transition-opacity duration-150 md:block group-hover:opacity-100"
            >
              {item.label}
            </span>
          </Link>
        );
      })}

      <form
        action="/api/session/logout"
        method="post"
        className="md:mt-auto md:flex md:justify-center"
      >
        <button
          type="submit"
          title={`Sign out — ${userLabel}`}
          className="text-canvas/65 hover:bg-white/10 hover:text-canvas flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[var(--radius-control)] transition-colors duration-150"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" {...stroke}>
            <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
            <path d="M10 17l-5-5 5-5" />
            <path d="M5 12h9" />
          </svg>
          <span className="sr-only">Sign out</span>
        </button>
      </form>
    </nav>
  );
}
