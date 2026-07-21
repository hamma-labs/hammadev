import { CheckCircle2, Copy, CornerDownRight } from 'lucide-react';
import { PRODUCT_COMMANDS } from '../product';

export default function TerminalDemo() {
  return (
    <section className="demo-section" aria-labelledby="demo-heading">
      <div className="demo-copy">
        <div className="section-kicker light">Native where the agents allow it</div>
        <h2 id="demo-heading">One local continuity loop.</h2>
        <p>Reviewable agent hooks checkpoint before compaction and load bounded context at session start. Codex gets an exact process-exit boundary too.</p>
        <div className="demo-stat">
          <strong>EXACT</strong>
          <span>session identity is bound, never guessed from the newest file</span>
        </div>
      </div>

      <div className="terminal-window">
        <div className="terminal-bar">
          <div className="traffic-lights"><span /><span /><span /></div>
          <span>~/project — hamma</span>
          <Copy size={14} />
        </div>
          <div className="terminal-body">
          <div className="terminal-command"><span>$</span><code>{PRODUCT_COMMANDS.hooksInstallCodex}</code></div>
          <div className="terminal-log"><CheckCircle2 size={14} /> codex hooks installed: .codex/hooks.json</div>
          <div className="terminal-log"><CheckCircle2 size={14} /> PreCompact · SessionStart</div>
          <div className="terminal-log muted">Review and trust project hooks with /hooks</div>
          <div className="terminal-result">
            <span>Reliable Codex exit</span>
            <strong>{PRODUCT_COMMANDS.codexModel}</strong>
          </div>
          <div className="terminal-next">
            <CornerDownRight size={15} />
            <div><span>Lifecycle</span><code>PreCompact → checkpoint · SessionStart → context · Exit → exact sync</code></div>
          </div>
          <span className="terminal-cursor" aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}
