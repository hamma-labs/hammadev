import { ArrowRight, Check, Database, Download, ShieldCheck } from 'lucide-react';
import { PRODUCT_COMMANDS } from '../product';

export default function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-heading">
      <div className="hero-copy">
        <div className="eyebrow"><span /> Native continuity · local by design</div>
        <h1 id="hero-heading">
          Your agents remember <span>where the work stopped.</span>
        </h1>
        <p>
          Hamma is the local continuity layer for Codex, Claude Code, and Grok.
          Run one command, choose an agent, and continue with exact project context.
        </p>
        <div className="hero-command-row" aria-label="HammaDev workflow commands">
          <code>{PRODUCT_COMMANDS.start}</code><span>→</span><strong>choose an agent</strong><span>→</span><strong>continue</strong>
        </div>

        <div className="hero-actions">
          <a
            href="https://www.npmjs.com/package/hammadev"
            target="_blank"
            rel="noopener noreferrer"
            className="primary-button"
            aria-label="npm install HammaDev beta"
          >
            <Download size={18} />
            Install the beta
          </a>
          <a
            href="https://github.com/hamma-labs/hammadev"
            target="_blank"
            rel="noopener noreferrer"
            className="secondary-button"
          >
            View GitHub
            <ArrowRight size={18} />
          </a>
        </div>

        <div className="hero-proof">
          <span><ShieldCheck size={15} /> Local-only</span>
          <span><Check size={15} /> Trusted native hooks</span>
          <span className="agent-pill">Codex · Claude · Grok</span>
        </div>
      </div>

      <div className="hero-visual" aria-label="HammaDev handoff preview">
        <div className="orbit orbit-one" aria-hidden="true" />
        <div className="orbit orbit-two" aria-hidden="true" />
        <div className="agent-card codex-card">
          <div className="agent-symbol">C</div>
          <div><span>PreCompact · exit</span><strong>Codex</strong></div>
          <i className="live-dot" />
        </div>
        <div className="transfer-path" aria-hidden="true"><span className="transfer-dot" /></div>
        <div className="handoff-card">
          <div className="handoff-topline"><Database size={16} /> memory:build-week <span>RECOVERABLE</span></div>
          <div className="document-lines">
            <span className="w-2/3" /><span className="w-full" /><span className="w-5/6" />
          </div>
          <div className="task-row"><Check size={14} /> SessionStart context ready</div>
          <div className="task-row"><Check size={14} /> Exact-session checkpoint</div>
          <div className="artifact-stack">
            <span>bootstrap.md</span><span>runtime</span><span>recall</span>
          </div>
        </div>
        <div className="agent-card claude-card">
          <div className="agent-symbol agent-symbol-warm">A</div>
          <div><span>Start · compact · end</span><strong>Claude Code</strong></div>
          <ArrowRight size={16} />
        </div>
        <div className="agent-card grok-card">
          <div className="agent-symbol agent-symbol-green">G</div>
          <div><span>Compact · end</span><strong>Grok</strong></div>
          <Check size={16} />
        </div>
        <div className="privacy-chip"><ShieldCheck size={14} /> trusted hooks · local files</div>
      </div>
    </section>
  );
}
