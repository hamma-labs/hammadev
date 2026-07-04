export default function Roadmap() {
  const roadmapItems = [
    "Better onboarding",
    "More agent adapters",
    "Search across handoffs",
    "Local web dashboard",
    "Optional encrypted sync",
    "Team handoff workflows"
  ];

  return (
    <section className="border-t border-zinc-900 pt-24 pb-12">
      <h2 className="text-3xl font-semibold mb-8">What comes next.</h2>
      <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
        {roadmapItems.map((item, i) => (
          <div key={i} className="bg-zinc-900/20 border border-zinc-800/50 rounded-lg p-4 text-zinc-300 flex items-center gap-3">
            <div className="w-2 h-2 border border-zinc-600 rounded-sm"></div>
            {item}
          </div>
        ))}
      </div>
    </section>
  );
}
