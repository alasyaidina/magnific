import React from 'react';

/**
 * Compact branding bar that lives in the app header on every tab so the
 * VibeTool.Club / PAK DOSEN credit is always visible.
 */
export function HeaderBranding() {
  return (
    <div className="hidden md:flex items-center gap-2 ml-2">
      <span className="vibe-badge">VibeTool.Club</span>
      <span className="text-[10px] uppercase tracking-wider text-gray-500">
        by{' '}
        <span className="text-gray-200 font-semibold">PAK DOSEN</span>
      </span>
    </div>
  );
}

/**
 * Persistent footer-bar shown at the bottom of every page. Kept very
 * lightweight so it doesn't compete with page content but is always
 * present as an unmistakable credit line.
 */
export function FooterBranding() {
  return (
    <footer className="mt-auto border-t border-white/5 bg-gradient-to-r from-fuchsia-950/30 via-violet-950/30 to-cyan-950/30">
      <div className="max-w-6xl mx-auto px-6 py-2.5 flex items-center justify-between gap-3 text-[11px]">
        <div className="flex items-center gap-2">
          <span className="vibe-badge animate-vibe-pulse">VibeTool.Club</span>
          <span className="text-gray-300">
            Power By{' '}
            <span className="vibe-gradient-text font-bold">VibeTool.Club</span>
            <span className="text-gray-500"> · </span>
            Created By{' '}
            <span className="vibe-gradient-text font-bold">PAK DOSEN</span>
          </span>
        </div>
        <div className="text-gray-500 uppercase tracking-widest hidden sm:block">
          Magnific Kling 2.6 · Motion Control
        </div>
      </div>
    </footer>
  );
}
