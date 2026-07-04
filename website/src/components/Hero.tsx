import { Terminal, Download, ArrowRight } from 'lucide-react';

export default function Hero() {
  return (
    <section className="flex flex-col items-center text-center mt-12 md:mt-24">
      <div className="flex flex-wrap justify-center gap-2 mb-8">
        {['Local-first', 'No account', 'Alpha', 'Codex ↔ Claude'].map((label) => (
          <span key={label} className="px-3 py-1 text-xs font-mono uppercase tracking-wider bg-zinc-900 border border-zinc-800 text-zinc-400 rounded-full">
            {label}
          </span>
        ))}
      </div>

      <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-white mb-8 max-w-4xl">
        Switch AI coding agents <br className="hidden md:block"/> without losing context.
      </h1>

      <p className="text-xl md:text-2xl text-zinc-400 mb-12 max-w-3xl leading-relaxed">
        HammaDev is a local handoff layer for Codex, Claude Code, and other agentic coding CLIs.
        It turns messy local agent sessions into clean task memory your next agent can continue from.
      </p>

      <div className="flex flex-col sm:flex-row items-center gap-4 mb-16">
        <a
          href="https://www.npmjs.com/package/hammadev"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 bg-white text-black px-6 py-3 rounded-lg font-medium hover:bg-zinc-200 transition-colors"
        >
          <Download size={18} />
          npm install -g hammadev@alpha
        </a>
        <a
          href="https://github.com/xayrullonematov/hammadev"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 bg-zinc-900 text-white border border-zinc-800 px-6 py-3 rounded-lg font-medium hover:bg-zinc-800 transition-colors"
        >
          View GitHub
          <ArrowRight size={18} />
        </a>
      </div>

      <div className="w-full max-w-2xl bg-[#0d0d0d] border border-zinc-800 rounded-xl overflow-hidden shadow-2xl">
        <div className="flex items-center px-4 py-3 border-b border-zinc-800/50 bg-[#141414]">
          <div className="flex gap-2">
            <div className="w-3 h-3 rounded-full bg-zinc-700"></div>
            <div className="w-3 h-3 rounded-full bg-zinc-700"></div>
            <div className="w-3 h-3 rounded-full bg-zinc-700"></div>
          </div>
          <div className="mx-auto text-xs font-mono text-zinc-500">Terminal</div>
        </div>
        <div className="p-6 text-left font-mono text-sm sm:text-base leading-relaxed overflow-x-auto">
          <div className="flex gap-4">
            <span className="text-zinc-500 shrink-0">$</span>
            <span className="text-zinc-200">npm install -g hammadev@alpha</span>
          </div>
          <div className="flex gap-4 mt-2">
            <span className="text-zinc-500 shrink-0">$</span>
            <span className="text-zinc-200">hamma quickstart</span>
          </div>
        </div>
      </div>
    </section>
  );
}
