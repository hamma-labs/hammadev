import { ArrowUpRight, BadgeCheck, FileText, ListRestart, Sparkles } from 'lucide-react';

const updates = [
  {
    icon: FileText,
    label: 'Bounded initial context',
    title: 'Load the brief, not the archive.',
    copy: 'The receiving agent starts with handoff.md alone. Structured state and bounded diagnostics stay available only when needed.',
    command: 'hamma benchmark latest',
  },
  {
    icon: ListRestart,
    label: 'Current task epoch',
    title: 'Resume the current objective—not old session noise.',
    copy: 'Task reconstruction scopes goals, evidence, risks, and next actions to the latest substantive development objective.',
    command: 'hamma continue --to codex --explain',
  },
  {
    icon: BadgeCheck,
    label: 'No-op preflight',
    title: 'Finished work does not launch another agent.',
    copy: 'Completed, blocked, ambiguous, or unsafe state returns an explainable recommendation before any continuation artifact is written.',
    command: 'hamma continue --to codex',
  },
];

export default function Updates() {
  return (
    <section id="updates" className="section-shell" aria-labelledby="updates-heading">
      <div className="section-kicker"><Sparkles size={14} /> Updated in alpha.6</div>
      <div className="section-heading-row">
        <h2 id="updates-heading" className="section-title">Continuity you can inspect and trust.</h2>
        <p>Alpha.6 makes continuation smaller and more honest: bounded context, current-task reconstruction, and no-op preflight.</p>
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
