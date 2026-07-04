export default function Limitations() {
  const limitations = [
    "Codex and Claude Code session formats may change.",
    "Redaction is best-effort.",
    "Handoffs are local markdown/json files, not a hosted workspace.",
    "No team sync yet.",
    "No dashboard yet.",
    "Currently focused on Codex and Claude Code."
  ];

  return (
    <section className="bg-red-950/20 border border-red-900/30 rounded-2xl p-8 md:p-12">
      <h2 className="text-2xl font-semibold mb-6 text-red-100">Current alpha limitations.</h2>
      <ul className="grid sm:grid-cols-2 gap-4">
        {limitations.map((limitation, i) => (
          <li key={i} className="flex items-start gap-3 text-zinc-300">
            <div className="w-1.5 h-1.5 rounded-full bg-red-800 mt-2 shrink-0"></div>
            <span>{limitation}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
