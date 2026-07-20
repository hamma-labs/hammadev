import { CheckCircle2, Copy, CornerDownRight } from 'lucide-react';

export default function TerminalDemo() {
  return (
    <section className="demo-section" aria-labelledby="demo-heading">
      <div className="demo-copy">
        <div className="section-kicker light">Repository memory, safe next step</div>
        <h2 id="demo-heading">One project thread. Any supported agent.</h2>
        <p>Attach durable project context with plain Markdown and JSON. Completed work stays available without running twice.</p>
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
          <div className="terminal-command"><span>$</span><code>hamma switch claude</code></div>
          <div className="terminal-log muted">Saving current Codex work…</div>
          <div className="terminal-log"><CheckCircle2 size={14} /> Repository drift: none detected</div>
          <div className="terminal-log"><CheckCircle2 size={14} /> Context prepared for Claude</div>
          <div className="terminal-result">
            <span>Latest trusted revision</span>
            <strong>.hamma/memories/build-week/revisions/…/</strong>
          </div>
          <div className="terminal-next">
            <CornerDownRight size={15} />
            <div><span>Next</span><code>Opening Claude…</code></div>
          </div>
          <span className="terminal-cursor" aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}
