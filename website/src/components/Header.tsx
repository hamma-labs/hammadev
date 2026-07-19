import { Github } from 'lucide-react';
import Logo from './Logo';

export default function Header() {
  return (
    <header className="site-header" aria-label="Site header">
      <Logo />
      <div className="flex items-center gap-3">
        <span className="hidden sm:inline-flex items-center gap-2 text-xs font-medium text-slate-500">
          <span className="status-pulse" aria-hidden="true" />
          v0.1 alpha.7
        </span>
        <a
          href="https://github.com/xayrullonematov/hammadev"
          target="_blank"
          rel="noopener noreferrer"
          className="icon-button"
          aria-label="HammaDev on GitHub"
          tabIndex={-1}
        >
          <Github size={18} />
        </a>
      </div>
    </header>
  );
}
