import { ArrowUpRight, RefreshCw, ShieldCheck, Sparkles, Webhook } from 'lucide-react';
import { PRODUCT_COMMANDS, PRODUCT_VERSION } from '../product';

const updates = [
  {
    icon: Webhook,
    label: 'Native lifecycle',
    title: 'Install reviewable hooks instead of relying on reminders.',
    copy: 'PreCompact checkpoints active memory. SessionStart restores bounded context where the agent supports it. Claude Code and Grok also checkpoint at session end.',
    command: PRODUCT_COMMANDS.hooksInstall,
  },
  {
    icon: ShieldCheck,
    label: 'Exact Codex exit',
    title: 'Checkpoint the session that actually exited.',
    copy: 'The Codex wrapper binds a launch to its native SessionStart ID, forwards terminal signals, and never guesses from the newest transcript.',
    command: PRODUCT_COMMANDS.codex,
  },
  {
    icon: RefreshCw,
    label: 'Crash recovery',
    title: 'Leave interrupted checkpoints safe to retry.',
    copy: 'Atomic launch records survive wrapper failure. The next trusted Codex or Claude Code start—or opt-in Grok SessionStart—retries ended work while skipping live concurrent sessions.',
    command: 'SessionStart → recover',
  },
];

export default function Updates() {
  return (
    <section id="updates" className="section-shell" aria-labelledby="updates-heading">
      <div className="section-kicker"><Sparkles size={14} /> Updated in {PRODUCT_VERSION}</div>
      <div className="section-heading-row">
        <h2 id="updates-heading" className="section-title">Continuity that follows real lifecycle events.</h2>
        <p>The automatic path now uses native hooks where they exist and a narrow process wrapper where Codex has no session-end event.</p>
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
      <a href="https://github.com/hamma-labs/hammadev#current-beta-boundaries" target="_blank" rel="noopener noreferrer" className="text-link mt-8">
        Read the release capabilities <ArrowUpRight size={16} />
      </a>
    </section>
  );
}
