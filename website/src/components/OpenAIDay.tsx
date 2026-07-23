import { ArrowUpRight, CheckCircle2, Code2, Sparkles } from 'lucide-react';

const buildWeekAdditions = [
  'Cross-agent session selection',
  'Git drift and evidence provenance',
  'Explainable handoff readiness',
  'Persistent named project memory',
];

export default function OpenAIDay() {
  return (
    <section id="openai-day" className="openai-day" aria-labelledby="openai-day-heading">
      <div className="openai-day-heading">
        <div className="section-kicker">
          <Sparkles size={14} /> OpenAI Day · July 23, 2026
        </div>
        <h2 id="openai-day-heading">
          Hardened with GPT-5.6.<br />
          <span>Local at runtime.</span>
        </h2>
        <p>
          HammaDev entered Build Week as a working cross-agent handoff prototype.
          During the sprint, GPT-5.6 inside Codex helped challenge the evidence
          model, find false continuations, and turn the prototype into durable
          project memory.
        </p>
        <a
          href="https://github.com/hamma-labs/hammadev/blob/main/docs/build-week-2026.md"
          target="_blank"
          rel="noopener noreferrer"
          className="text-link openai-day-link"
        >
          Read the engineering log <ArrowUpRight size={16} />
        </a>
      </div>

      <div className="openai-day-proof" aria-label="OpenAI Build Week contribution">
        <div className="openai-day-runtime">
          <Code2 size={18} />
          <div>
            <strong>No model lock-in</strong>
            <span>The shipped CLI needs no HammaDev account, API key, or cloud backend.</span>
          </div>
        </div>
        <ul>
          {buildWeekAdditions.map((addition) => (
            <li key={addition}>
              <CheckCircle2 size={17} />
              <span>{addition}</span>
            </li>
          ))}
        </ul>
        <div className="openai-day-footnote">
          Built with Codex and GPT-5.6 · shipped as a free open-source beta
        </div>
      </div>
    </section>
  );
}
