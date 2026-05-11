import React from 'react';

export default function About() {
  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-fuchsia-900/40 via-violet-900/40 to-cyan-900/40 p-10 vibe-glow">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-24 w-80 h-80 rounded-full vibe-gradient-bg opacity-30 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-24 -left-24 w-80 h-80 rounded-full vibe-gradient-bg opacity-20 blur-3xl"
        />

        <div className="relative z-10 flex flex-col items-center text-center gap-4">
          <span className="vibe-badge animate-vibe-pulse">
            VibeTool.Club Production
          </span>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold leading-tight tracking-tight">
            <span className="block text-gray-300 text-sm sm:text-base font-semibold uppercase tracking-[0.4em] mb-2">
              Power By
            </span>
            <span className="vibe-gradient-text drop-shadow">
              VibeTool.Club
            </span>
          </h1>

          <div className="mt-2 flex flex-col items-center gap-2">
            <span className="text-xs sm:text-sm uppercase tracking-[0.5em] text-gray-400">
              Created By
            </span>
            <div className="text-3xl sm:text-4xl font-black vibe-gradient-text">
              PAK DOSEN
            </div>
          </div>

          <p className="mt-4 max-w-2xl text-sm sm:text-base text-gray-300/90 leading-relaxed">
            Aplikasi desktop untuk produksi video AI Magnific Kling 2.6 Motion
            Control — multi API key paralel, antrian otomatis, dan
            auto-download ke folder pilihan Anda. Dibangun dengan cinta untuk
            komunitas{' '}
            <span className="font-semibold text-white">VibeTool.Club</span>.
          </p>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <FeatureCard
          title="Multi-Key Parallel"
          body="Setiap API key Magnific menjadi satu slot generate. 10 key = 10 video paralel. Sisanya antri otomatis."
        />
        <FeatureCard
          title="Auto Habis Detection"
          body="Key yang kehabisan kredit otomatis ditandai Habis dan di-skip oleh scheduler. Tinggal top-up & klik Mark available."
        />
        <FeatureCard
          title="Auto Download"
          body="Set folder sekali, video langsung tersimpan otomatis tiap selesai. Tidak perlu klik Download lagi."
        />
      </section>

      <section className="card space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-lg font-semibold">Tentang Aplikasi</h2>
            <p className="text-xs text-gray-400 mt-1">
              Magnific Kling 2.6 Motion Control · Desktop Edition
            </p>
          </div>
          <span className="vibe-badge">VibeTool.Club</span>
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <Row label="Versi">1.0.0</Row>
          <Row label="Stack">Electron 28 · React 18 · Vite · Tailwind v3</Row>
          <Row label="Model">
            Kling 2.6 Motion Control (Pro 1080p / Standard 720p)
          </Row>
          <Row label="Penyimpanan">electron-store (lokal)</Row>
          <Row label="Penyedia API">
            <a
              href="https://docs.magnific.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              docs.magnific.com
            </a>
          </Row>
          <Row label="Komunitas">
            <a
              href="https://vibetool.club"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              vibetool.club
            </a>
          </Row>
        </dl>
      </section>

      <section className="card text-center space-y-2">
        <p className="text-xs uppercase tracking-[0.4em] text-gray-500">
          Dibuat dengan kopi & ketekunan oleh
        </p>
        <p className="text-2xl font-black vibe-gradient-text">PAK DOSEN</p>
        <p className="text-xs text-gray-400">
          Untuk komunitas{' '}
          <span className="vibe-gradient-text font-semibold">
            VibeTool.Club
          </span>
        </p>
      </section>
    </div>
  );
}

function FeatureCard({ title, body }) {
  return (
    <div className="rounded-xl border border-white/10 bg-card p-4 hover:border-fuchsia-500/40 transition-colors">
      <div className="vibe-gradient-text text-sm font-bold uppercase tracking-wide">
        {title}
      </div>
      <p className="text-sm text-gray-300 mt-2 leading-relaxed">{body}</p>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[10px] uppercase tracking-widest text-gray-500">
        {label}
      </dt>
      <dd className="text-gray-200">{children}</dd>
    </div>
  );
}
