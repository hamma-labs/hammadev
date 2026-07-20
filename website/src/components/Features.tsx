import { BadgeCheck, FileClock, Fingerprint, GitCompareArrows, History, Network } from 'lucide-react';

const features = [
  { icon: Network, title: 'One-command switching', desc: 'Run hamma switch claude, codex, or grok. Session detection and task ownership stay behind the CLI.', tone: 'violet', size: 'wide' },
  { icon: Fingerprint, title: 'Repository knowledge', desc: 'Keep a project default or named threads with decisions, constraints, discoveries, preferences, and provenance.', tone: 'coral', size: '' },
  { icon: FileClock, title: 'Evidence-backed state', desc: 'Separate agent claims from commands, repository signals, tools, and user confirmation.', tone: 'blue', size: '' },
  { icon: GitCompareArrows, title: 'Git drift detection', desc: 'Compare the handoff snapshot with the live branch, HEAD, working tree, and relevant files.', tone: 'ink', size: '' },
  { icon: BadgeCheck, title: 'Readiness assessment', desc: 'Surface strong signals, warnings, and blockers before the receiving agent continues.', tone: 'green', size: 'wide' },
  { icon: History, title: 'Local recall', desc: 'Search immutable epochs, structured facts, file paths, and sanitized messages without network calls.', tone: 'amber', size: '' },
];

export default function Features() {
  return (
    <section className="section-shell" aria-labelledby="features-heading">
      <div className="section-kicker">Built for real repositories</div>
      <div className="section-heading-row">
        <h2 id="features-heading" className="section-title">Small tool. Serious continuity.</h2>
        <p>HammaDev stays out of the way until you need to switch agents, recover context, or audit what happened.</p>
      </div>
      <div className="feature-grid">
        {features.map(({ icon: Icon, title, desc, tone, size }) => (
          <article key={title} className={`feature-tile ${size}`}>
            <div className={`feature-icon ${tone}`}><Icon size={20} /></div>
            <h3>{title}</h3>
            <p>{desc}</p>
            <span className="tile-corner" aria-hidden="true" />
          </article>
        ))}
      </div>
    </section>
  );
}
