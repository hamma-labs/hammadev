import { ArrowUpRight, BadgeCheck, FileTerminal, Sparkles } from 'lucide-react';

const updates = [
  {
    icon: BadgeCheck,
    label: 'Simple save',
    title: 'Save the current session without knowing its ID.',
    copy: 'Hamma detects the active project agent and either creates project memory or checkpoints the open task.',
    command: 'hamma save',
  },
  {
    icon: BadgeCheck,
    label: 'Simple switch',
    title: 'Move live work with one readable command.',
    copy: 'Hamma hides exact sources, claims, Git checks, and launch prompts while retaining their safety guarantees.',
    command: 'hamma switch claude',
  },
  {
    icon: FileTerminal,
    label: 'Simple finish',
    title: 'Close the right task without cleanup commands.',
    copy: 'Hamma recovers the task claim automatically, saves the final session, and keeps completed work as searchable context.',
    command: 'hamma done',
  },
];

export default function Updates() {
  return (
    <section id="updates" className="section-shell" aria-labelledby="updates-heading">
      <div className="section-kicker"><Sparkles size={14} /> Updated in alpha.8</div>
      <div className="section-heading-row">
        <h2 id="updates-heading" className="section-title">Continuity you can inspect and trust.</h2>
        <p>Repository memory keeps durable knowledge across agents while preserving strict local safety and execution gates.</p>
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
