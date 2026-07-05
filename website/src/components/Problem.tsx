import { ArrowDownRight } from 'lucide-react';

export default function Problem() {
  return (
    <section className="problem-strip" aria-labelledby="problem-heading">
      <div className="problem-label"><span>01</span> The context gap</div>
      <h2 id="problem-heading">Your code persists.<br />The reasoning doesn’t.</h2>
      <div className="problem-copy">
        <p>
          Switching agents should not mean retelling the entire story. HammaDev preserves the decisions, verification, risks, and next action—not the noise.
        </p>
        <a href="#workflow">See the handoff flow <ArrowDownRight size={17} /></a>
      </div>
    </section>
  );
}
