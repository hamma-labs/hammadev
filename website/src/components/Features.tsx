import { BadgeCheck, Fingerprint, GitCompareArrows, History, Network, RefreshCw } from 'lucide-react';

const features = [
  { icon: Network, title: 'Native lifecycle continuity', desc: 'Trusted PreCompact, SessionStart, and supported SessionEnd hooks checkpoint and restore project memory at real agent boundaries.', tone: 'violet', size: 'wide' },
  { icon: Fingerprint, title: 'Repository knowledge', desc: 'Keep a project default or named threads with decisions, constraints, discoveries, preferences, and provenance.', tone: 'coral', size: '' },
  { icon: RefreshCw, title: 'Exact Codex recovery', desc: 'Bind the launched process to its actual session, checkpoint on exit, and safely retry interrupted syncs at the next trusted start.', tone: 'blue', size: '' },
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
        <p>HammaDev stays quiet during normal work and becomes visible at the lifecycle boundaries you can review and trust.</p>
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
