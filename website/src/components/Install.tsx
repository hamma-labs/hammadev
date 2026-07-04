export default function Install() {
  return (
    <section className="flex flex-col md:flex-row gap-12 items-start justify-between border-t border-zinc-900 pt-24">
      <div className="md:w-1/3">
        <h2 className="text-3xl font-semibold mb-4">Install the alpha.</h2>
        <div className="text-sm text-zinc-500 mb-6">
          <p>Requires Node.js 22.12+</p>
          <p>Node 24 recommended</p>
        </div>
        <p className="text-sm text-zinc-400">
          The npm package is <code className="bg-zinc-900 px-1 py-0.5 rounded text-zinc-300">hammadev</code>.
          The CLI command is <code className="bg-zinc-900 px-1 py-0.5 rounded text-zinc-300">hamma</code>.
        </p>
      </div>

      <div className="md:w-2/3 w-full flex flex-col gap-6">
        <div className="bg-[#0a0a0a] border border-zinc-800 rounded-xl p-6 font-mono text-sm shadow-xl">
          <div className="flex gap-4">
            <span className="text-zinc-600 select-none">$</span>
            <span className="text-zinc-300">npm install -g hammadev@alpha</span>
          </div>
        </div>

        <div className="bg-[#0a0a0a] border border-zinc-800 rounded-xl p-6 font-mono text-sm shadow-xl">
          <div className="text-zinc-500 mb-3 text-xs uppercase tracking-wider">Smoke test</div>
          <div className="flex gap-4">
            <span className="text-zinc-600 select-none">$</span>
            <span className="text-zinc-300">hamma --version</span>
          </div>
          <div className="flex gap-4 mt-2">
            <span className="text-zinc-600 select-none">$</span>
            <span className="text-zinc-300">hamma quickstart</span>
          </div>
          <div className="flex gap-4 mt-2">
            <span className="text-zinc-600 select-none">$</span>
            <span className="text-zinc-300">hamma doctor</span>
          </div>
          <div className="flex gap-4 mt-2">
            <span className="text-zinc-600 select-none">$</span>
            <span className="text-zinc-300">hamma status</span>
          </div>
        </div>
      </div>
    </section>
  );
}
