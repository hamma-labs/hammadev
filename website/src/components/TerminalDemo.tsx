import { CheckCircle2, Copy, CornerDownRight } from 'lucide-react';

export default function TerminalDemo() {
  return (
    <section className="demo-section" aria-labelledby="demo-heading">
      <div className="demo-copy">
        <div className="section-kicker light">Named memory, clear next step</div>
        <h2 id="demo-heading">One project thread. Any supported agent.</h2>
        <p>Resume a trusted project memory with plain Markdown and JSON—no opaque sync layer or hosted dashboard.</p>
        <div className="demo-stat">
          <strong>READY</strong>
          <span>explainable readiness from evidence and live Git state</span>
        </div>
      </div>

      <div className="terminal-window">
        <div className="terminal-bar">
          <div className="traffic-lights"><span /><span /><span /></div>
          <span>~/project — hamma</span>
          <Copy size={14} />
        </div>
        <div className="terminal-body">
          <div className="terminal-command"><span>$</span><code>hamma memory resume build-week --to claude</code></div>
          <div className="terminal-log muted">Loading memory:build-week…</div>
          <div className="terminal-log"><CheckCircle2 size={14} /> Repository drift: none detected</div>
          <div className="terminal-log"><CheckCircle2 size={14} /> Handoff readiness: READY</div>
          <div className="terminal-result">
            <span>Latest trusted revision</span>
            <strong>.hamma/memories/build-week/revisions/…/</strong>
          </div>
          <div className="terminal-next">
            <CornerDownRight size={15} />
            <div><span>Next</span><code>claude “Read handoff.md, reconcile the repository, and continue.”</code></div>
          </div>
          <span className="terminal-cursor" aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}
