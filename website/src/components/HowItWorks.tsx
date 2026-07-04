import { ArrowRight, FileText, Terminal, Bot } from 'lucide-react';

export default function HowItWorks() {
  return (
    <section className="flex flex-col gap-16">
      <div className="text-center">
        <h2 className="text-3xl font-semibold mb-4">How it works</h2>
      </div>

      <div className="grid md:grid-cols-3 gap-8">
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-8 relative">
          <div className="text-sm font-mono text-zinc-500 mb-4">Step 1</div>
          <h3 className="text-xl font-medium mb-3">Read local agent sessions</h3>
          <p className="text-zinc-400">Codex and Claude Code session files stay on your machine.</p>
        </div>

        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-8">
          <div className="text-sm font-mono text-zinc-500 mb-4">Step 2</div>
          <h3 className="text-xl font-medium mb-3">Create clean task memory</h3>
          <p className="text-zinc-400">HammaDev extracts completed work, remaining tasks, verification, risks, and repo state.</p>
        </div>

        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-8">
          <div className="text-sm font-mono text-zinc-500 mb-4">Step 3</div>
          <h3 className="text-xl font-medium mb-3">Continue in another agent</h3>
          <p className="text-zinc-400">Open the generated handoff.md in your next coding agent.</p>
        </div>
      </div>

      <div className="bg-zinc-900/30 border border-zinc-800/50 p-8 rounded-xl overflow-hidden mt-8">
        <div className="flex flex-col gap-8 font-mono text-sm sm:text-base items-center">

          <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-8 w-full justify-center">
            <div className="flex flex-col items-center gap-2 text-zinc-400">
              <Bot size={32} className="text-blue-400" />
              <span>Codex session</span>
            </div>
            <ArrowRight className="text-zinc-600 hidden sm:block" />
            <div className="flex flex-col items-center gap-2 text-white font-bold px-6 py-3 bg-zinc-800 rounded-lg">
              <Terminal size={24} />
              <span>HammaDev</span>
            </div>
            <ArrowRight className="text-zinc-600 hidden sm:block" />
            <div className="flex flex-col items-center gap-2 text-zinc-300">
              <FileText size={28} />
              <span>handoff.md</span>
            </div>
            <ArrowRight className="text-zinc-600 hidden sm:block" />
            <div className="flex flex-col items-center gap-2 text-zinc-400">
              <Bot size={32} className="text-orange-400" />
              <span>Claude Code continues</span>
            </div>
          </div>

          <div className="h-px w-full max-w-xl bg-zinc-800/50 mx-auto"></div>

          <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-8 w-full justify-center opacity-70">
            <div className="flex flex-col items-center gap-2 text-zinc-400">
              <Bot size={32} className="text-orange-400" />
              <span>Claude Code</span>
            </div>
            <ArrowRight className="text-zinc-600 hidden sm:block" />
            <div className="flex flex-col items-center gap-2 text-white font-bold px-6 py-2 border border-zinc-700 rounded-lg">
              <span>HammaDev</span>
            </div>
            <ArrowRight className="text-zinc-600 hidden sm:block" />
            <div className="flex flex-col items-center gap-2 text-zinc-400">
              <Bot size={32} className="text-blue-400" />
              <span>Codex continues</span>
            </div>
          </div>

        </div>
      </div>
    </section>
  );
}
