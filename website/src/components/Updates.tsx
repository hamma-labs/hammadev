import { ArrowUpRight, BadgeCheck, FolderArchive, ScanSearch, Sparkles } from 'lucide-react';

const updates = [
  {
    icon: BadgeCheck,
    label: 'Agent skill',
    title: 'Ask Codex to continue from Claude',
    copy: 'Install the bundled handoff skill once, then use natural language to select, validate, and resume the right project session.',
    command: 'hamma skill install',
  },
  {
    icon: ScanSearch,
    label: 'Smarter selection',
    title: 'Project-scoped session matching',
    copy: 'Hamma ranks Claude sessions by resumability and skips trivial or failed sessions before creating a handoff.',
    command: 'claude:project → codex',
  },
  {
    icon: FolderArchive,
    label: 'Better memory',
    title: 'Six focused local artifacts',
    copy: 'Every handoff includes a concise brief, structured state, timeline, command summary, session archive, and redaction report.',
    command: '.hamma/tasks/<handoff>/',
  },
];

export default function Updates() {
  return (
    <section id="updates" className="section-shell" aria-labelledby="updates-heading">
      <div className="section-kicker"><Sparkles size={14} /> Updated in alpha.3</div>
      <div className="section-heading-row">
        <h2 id="updates-heading" className="section-title">The handoff layer is getting smarter.</h2>
        <p>Recent releases move beyond file conversion into reliable project-aware continuation.</p>
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
