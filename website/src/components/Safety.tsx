export default function Safety() {
  return (
    <section className="bg-[#0f0f11] border border-zinc-800/50 rounded-2xl p-8 md:p-12 my-8">
      <div className="max-w-3xl">
        <h2 className="text-3xl font-semibold mb-6">Local-first by design.</h2>
        <p className="text-lg text-zinc-400 mb-6">
          HammaDev does not upload your sessions anywhere. It reads local coding-agent session files and writes local .hamma handoff artifacts inside your project.
        </p>

        <div className="bg-orange-950/30 border border-orange-900/50 text-orange-200/90 rounded-lg p-4 mb-8 text-sm">
          <strong>Important:</strong> Redaction is best-effort, not a privacy guarantee. Review handoff.md before sharing it outside your machine.
        </div>

        <ul className="grid sm:grid-cols-2 gap-4 text-zinc-300">
          {[
            'No backend',
            'No account',
            'No cloud sync',
            'No telemetry in alpha',
            'Writes to .hamma/',
            'Redacts common secrets best-effort'
          ].map((bullet, i) => (
            <li key={i} className="flex items-center gap-3">
              <div className="w-1.5 h-1.5 rounded-full bg-zinc-600"></div>
              {bullet}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
