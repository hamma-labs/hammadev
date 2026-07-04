export default function Footer() {
  return (
    <footer className="border-t border-zinc-900 pt-24 pb-12 flex flex-col items-center text-center">
      <h2 className="text-3xl md:text-4xl font-bold mb-8">
        Try HammaDev locally in one minute.
      </h2>

      <div className="bg-[#0a0a0a] border border-zinc-800 rounded-xl p-6 font-mono text-sm w-full max-w-lg mb-10 shadow-xl text-left">
        <div className="flex gap-4">
          <span className="text-zinc-600 select-none">$</span>
          <span className="text-zinc-300">npm install -g hammadev@alpha</span>
        </div>
        <div className="flex gap-4 mt-2">
          <span className="text-zinc-600 select-none">$</span>
          <span className="text-zinc-300">hamma quickstart</span>
        </div>
      </div>

      <div className="flex gap-4 mb-24">
        <a href="https://github.com/xayrullonematov/hammadev" className="text-zinc-400 hover:text-white px-4 py-2 bg-zinc-900/50 rounded-lg transition-colors">GitHub</a>
        <a href="https://www.npmjs.com/package/hammadev" className="text-zinc-400 hover:text-white px-4 py-2 bg-zinc-900/50 rounded-lg transition-colors">npm</a>
        <a href="#" className="text-zinc-400 hover:text-white px-4 py-2 bg-zinc-900/50 rounded-lg transition-colors">Docs</a>
      </div>

      <div className="text-zinc-600 text-sm">
        <p className="font-semibold text-zinc-400 mb-1">HammaDev</p>
        <p>Local handoff layer for AI coding agents.</p>
        <p>Alpha software.</p>
      </div>
    </footer>
  );
}
