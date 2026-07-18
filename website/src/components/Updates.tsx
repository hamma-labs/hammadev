import { ArrowUpRight, BadgeCheck, GitCompareArrows, History, Sparkles } from 'lucide-react';

const updates = [
  {
    icon: History,
    label: 'Named project memory',
    title: 'Sessions change. The project thread persists.',
    copy: 'Create a stable name once, then append immutable revisions as work moves between supported coding agents.',
    command: 'hamma memory start build-week',
  },
  {
    icon: GitCompareArrows,
    label: 'Repository awareness',
    title: 'Detect drift before another agent edits.',
    copy: 'Recorded Git metadata and relevant-file digests expose branch, HEAD, working-tree, and task-file differences.',
    command: 'hamma show latest --check-drift',
  },
  {
    icon: BadgeCheck,
    label: 'Explainable readiness',
    title: 'Know when a handoff needs review.',
    copy: 'Observable evidence, verification outcomes, task clarity, and repository consistency produce signals—not false certainty.',
    command: 'hamma show latest --readiness',
  },
];

export default function Updates() {
  return (
    <section id="updates" className="section-shell" aria-labelledby="updates-heading">
      <div className="section-kicker"><Sparkles size={14} /> Updated in alpha.4</div>
      <div className="section-heading-row">
        <h2 id="updates-heading" className="section-title">Continuity you can inspect and trust.</h2>
        <p>Alpha.4 turns one-off handoffs into durable, Git-aware project memory with explainable readiness.</p>
      </div>
      <div className="update-list">
        {updates.map(({ icon: Icon, label, title, copy, command }, index) => (
          <article className="update-row" key={title}>
            <div className="update-index">0{index + 1}</div>
            <div className="update-icon"><Icon size={20} /></div>
            <div className="update-copy">
              <span>{label}</span>
              <h3>{title}</h3>
              <p>{copy}</p>
            </div>
            <code>{command}</code>
          </article>
        ))}
      </div>
      <a href="https://github.com/xayrullonematov/hammadev#current-alpha-capabilities" target="_blank" rel="noopener noreferrer" className="text-link mt-8">
        Read the release capabilities <ArrowUpRight size={16} />
      </a>
    </section>
  );
}
