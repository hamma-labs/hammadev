export default function Problem() {
  return (
    <section className="flex flex-col md:flex-row gap-12 items-start justify-between border-t border-zinc-900 pt-24">
      <div className="md:w-1/2">
        <h2 className="text-3xl md:text-4xl font-semibold mb-6">
          AI agents forget what the last agent did.
        </h2>
      </div>
      <div className="md:w-1/2 flex flex-col gap-6 text-lg text-zinc-400">
        <p>
          You start a task in Codex, switch to Claude Code, and suddenly you have to explain everything again: what changed, what passed, what failed, what files matter, and what is still unfinished.
        </p>
        <p className="text-zinc-200">
          HammaDev creates a clean local handoff package so the next agent can continue from the current repo state.
        </p>
      </div>
    </section>
  );
}
