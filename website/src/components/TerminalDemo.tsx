export default function TerminalDemo() {
  return (
    <section className="flex flex-col gap-8">
      <h2 className="text-3xl font-semibold mb-2">A handoff in one command.</h2>

      <div className="w-full bg-[#0a0a0a] border border-zinc-800 rounded-xl overflow-hidden shadow-2xl">
        <div className="flex items-center px-4 py-3 border-b border-zinc-800/50 bg-[#121212]">
          <div className="flex gap-2">
            <div className="w-3 h-3 rounded-full bg-zinc-700"></div>
            <div className="w-3 h-3 rounded-full bg-zinc-700"></div>
            <div className="w-3 h-3 rounded-full bg-zinc-700"></div>
          </div>
        </div>
        <div className="p-6 font-mono text-sm leading-relaxed overflow-x-auto whitespace-pre">
          <div className="flex gap-4">
            <span className="text-zinc-600 select-none">$</span>
            <span className="text-zinc-300">hamma quickstart</span>
          </div>
          <div className="flex gap-4 mt-1">
            <span className="text-zinc-600 select-none">$</span>
            <span className="text-zinc-300">hamma status</span>
          </div>
          <div className="flex gap-4 mt-1">
            <span className="text-zinc-600 select-none">$</span>
            <span className="text-zinc-300">hamma handoff codex:last --to claude</span>
          </div>
          <div className="mt-6 text-zinc-400">
            Created handoff:<br/>
            <span className="text-blue-400">.hamma/tasks/2026-07-02T...-codex-to-claude/handoff.md</span>
          </div>
          <div className="mt-6 text-zinc-400">
            Next:<br/>
            <span className="text-green-400">claude</span> "Read .hamma/tasks/.../handoff.md and continue from the current repo state."
          </div>
        </div>
      </div>
    </section>
  );
}
