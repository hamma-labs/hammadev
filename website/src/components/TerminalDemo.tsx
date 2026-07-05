import { CheckCircle2, Copy, CornerDownRight } from 'lucide-react';

export default function TerminalDemo() {
  return (
    <section className="demo-section" aria-labelledby="demo-heading">
      <div className="demo-copy">
        <div className="section-kicker light">One command, clear next step</div>
        <h2 id="demo-heading">A handoff you can actually inspect.</h2>
        <p>Plain Markdown and JSON. No opaque sync layer, no account, no new dashboard to maintain.</p>
        <div className="demo-stat">
          <strong>~15 KB</strong>
          <span>target size for a focused handoff brief</span>
        </div>
      </div>

      <div className="terminal-window">
        <div className="terminal-bar">
          <div className="traffic-lights"><span /><span /><span /></div>
          <span>~/project — hamma</span>
          <Copy size={14} />
        </div>
        <div className="terminal-body">
          <div className="terminal-command"><span>$</span><code>hamma handoff codex:last --to claude</code></div>
          <div className="terminal-log muted">Reading latest Codex session…</div>
          <div className="terminal-log"><CheckCircle2 size={14} /> Session matched to ~/project</div>
          <div className="terminal-log"><CheckCircle2 size={14} /> Secrets redacted (best-effort)</div>
          <div className="terminal-result">
            <span>Created handoff</span>
            <strong>.hamma/tasks/…-codex-to-claude/</strong>
          </div>
          <div className="terminal-next">
            <CornerDownRight size={15} />
            <div><span>Next</span><code>claude “Read handoff.md and continue.”</code></div>
          </div>
          <span className="terminal-cursor" aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}
