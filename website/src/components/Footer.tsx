import { ArrowUpRight, Github, Package } from 'lucide-react';
import Logo from './Logo';
import { PRODUCT_VERSION_LABEL } from '../product';

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-cta">
        <div>
          <span className="footer-eyebrow">Ready when your context isn’t.</span>
          <h2>Keep the work moving.</h2>
        </div>
        <a href="#install" className="footer-button">Install HammaDev <ArrowUpRight size={18} /></a>
      </div>

      <div className="footer-bottom">
        <div>
          <Logo />
          <p>The local continuity layer for AI coding agents.</p>
        </div>
        <nav aria-label="Footer links">
          <a href="https://github.com/xayrullonematov/hammadev" target="_blank" rel="noopener noreferrer"><Github size={16} /> GitHub</a>
          <a href="https://www.npmjs.com/package/hammadev" target="_blank" rel="noopener noreferrer"><Package size={16} /> npm</a>
          <a href="https://github.com/xayrullonematov/hammadev#readme" target="_blank" rel="noopener noreferrer">Docs <ArrowUpRight size={14} /></a>
        </nav>
      </div>
      <div className="footer-meta"><span>HammaDev {PRODUCT_VERSION_LABEL}</span><span>ISC License</span><span>Codex · Claude Code · Grok</span></div>
    </footer>
  );
}
