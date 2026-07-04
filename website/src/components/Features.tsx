export default function Features() {
  const cards = [
    { title: "Local-first", desc: "Reads and writes on your machine. No cloud required." },
    { title: "Agent handoff", desc: "Move work between Codex and Claude Code." },
    { title: "Clean task memory", desc: "Captures completed work, remaining work, risks, verification, and repo state." },
    { title: "Safe default commands", desc: "quickstart, status, log, and show avoid raw transcripts." },
    { title: "Best-effort redaction", desc: "Common tokens and secrets are redacted from generated artifacts." },
    { title: "Project history", desc: "Use hamma log and hamma show to review previous handoffs." },
  ];

  return (
    <section className="border-t border-zinc-900 pt-24">
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {cards.map((card, i) => (
          <div key={i} className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl p-6 hover:bg-zinc-900/60 transition-colors">
            <h3 className="text-lg font-medium mb-2 text-zinc-100">{card.title}</h3>
            <p className="text-zinc-400 text-sm leading-relaxed">{card.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
