import { ArrowRight } from 'lucide-react';

const roadmapItems = [
  ['Now', 'Richer task-ledger extraction', 'Fewer parser warnings and better deduplication.'],
  ['Next', 'More agent adapters', 'Gemini CLI, opencode, and Antigravity.'],
  ['Later', 'Team continuity', 'Optional encrypted sync and shared handoff memory.'],
];

export default function Roadmap() {
  return (
    <section className="roadmap-section" aria-labelledby="roadmap-heading">
      <div className="section-heading-row">
        <div>
          <div className="section-kicker">On the path</div>
          <h2 id="roadmap-heading" className="section-title">What comes next.</h2>
        </div>
        <p>The alpha stays local and auditable while the handoff model gets deeper.</p>
      </div>
      <div className="roadmap-track">
        {roadmapItems.map(([phase, title, copy], index) => (
          <article key={title}>
            <div className="roadmap-marker"><span>{index + 1}</span></div>
            <small>{phase}</small>
            <h3>{title}</h3>
            <p>{copy}</p>
            {index < roadmapItems.length - 1 && <ArrowRight aria-hidden="true" />}
          </article>
        ))}
      </div>
    </section>
  );
}
