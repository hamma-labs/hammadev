import { ArrowUpRight, BadgeCheck, FileText, ListRestart, Sparkles } from 'lucide-react';

const updates = [
  {
    icon: BadgeCheck,
    label: 'Accurate completion',
    title: 'Finished work stays finished.',
    copy: 'Explicit implemented, automated, configured, fixed, resolved, and verified outcomes now stop continuation before another artifact is created.',
    command: 'hamma continue --to codex --explain',
  },
  {
    icon: FileText,
    label: 'Compact skill response',
    title: 'Decide with less context.',
    copy: 'Agent skills receive a one-line, transcript-free selection and preflight contract while the full JSON API remains backward compatible.',
    command: 'hamma continue --to codex --compact-json',
  },
  {
    icon: ListRestart,
    label: 'Black-box verified',
    title: 'Reality drives the release.',
    copy: 'A real Claude Code handoff exposed stale actionability and oversized command responses; alpha.7 corrects both paths with replay coverage.',
    command: 'hamma skill install --force',
  },
];

export default function Updates() {
  return (
    <section id="updates" className="section-shell" aria-labelledby="updates-heading">
      <div className="section-kicker"><Sparkles size={14} /> Updated in alpha.7</div>
      <div className="section-heading-row">
        <h2 id="updates-heading" className="section-title">Continuity you can inspect and trust.</h2>
        <p>Alpha.7 turns real handoff evidence into a faster, more accurate continuation path.</p>
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
