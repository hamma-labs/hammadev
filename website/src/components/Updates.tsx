import { ArrowUpRight, BadgeCheck, FileTerminal, Sparkles } from 'lucide-react';

const updates = [
  {
    icon: BadgeCheck,
    label: 'Resume preflight',
    title: 'Finished sessions stop before handoff.',
    copy: 'Resume skills can inspect an explicit prior session through a compact, read-only preflight and avoid creating an unnecessary artifact.',
    command: 'hamma handoff claude:previous --to claude --preflight',
  },
  {
    icon: BadgeCheck,
    label: 'Installation completion',
    title: 'Installed means complete.',
    copy: 'Successful installed and available outcomes are recognized as completion while unresolved failures still override optimistic claims.',
    command: '/hamma-resume',
  },
  {
    icon: FileTerminal,
    label: 'Claude command evidence',
    title: 'Evidence without tool-output leakage.',
    copy: 'Claude sessions retain redacted, capped Bash command metadata while tool outputs, thinking, and file-read payloads stay excluded.',
    command: 'hamma continue --to codex --compact-json',
  },
];

export default function Updates() {
  return (
    <section id="updates" className="section-shell" aria-labelledby="updates-heading">
      <div className="section-kicker"><Sparkles size={14} /> Updated in alpha.8</div>
      <div className="section-heading-row">
        <h2 id="updates-heading" className="section-title">Continuity you can inspect and trust.</h2>
        <p>Alpha.8 makes same-agent resume faster, safer, and more faithful to the work already finished.</p>
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
