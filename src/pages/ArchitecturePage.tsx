import { useState } from 'react';
import {
  Cloud, Database, Server, HardDrive, Network,
  Globe, Code, Layers, Zap, ArrowRight, Boxes, Workflow
} from 'lucide-react';
import { useReveal } from '../hooks/useReveal';
import { navigateTo } from '../router';
import { VIZ, viz } from '../lib/viz';

interface ArchNode {
  id: string;
  label: string;
  icon: typeof Cloud;
  desc: string;
  layer: string;
  color: string;
}

const nodes: ArchNode[] = [
  { id: 'react', label: 'React Frontend', icon: Code, desc: 'TypeScript + TailwindCSS SPA with real-time WebSocket updates and optimistic UI.', layer: 'Client', color: VIZ.cyan },
  { id: 'gateway', label: 'API Gateway', icon: Network, desc: 'AWS API Gateway routes REST and WebSocket traffic with rate limiting and JWT auth via Amazon Cognito.', layer: 'Edge', color: VIZ.emerald },
  { id: 'lambda', label: 'AWS Lambda', icon: Zap, desc: 'Serverless compute handlers for memory CRUD, search, and event processing. Auto-scales to zero.', layer: 'Compute', color: VIZ.cyan },
  { id: 'bedrock', label: 'Amazon Bedrock', icon: Cloud, desc: 'Managed foundation models for memory extraction, summarization, and semantic embedding generation.', layer: 'AI', color: VIZ.emerald },
  { id: 's3', label: 'Amazon S3', icon: HardDrive, desc: 'Object storage for raw memory payloads, exports, and audit logs with lifecycle policies.', layer: 'Storage', color: VIZ.cyan },
  { id: 'crdb', label: 'CockroachDB', icon: Database, desc: 'Distributed SQL with a native vector index. Memories and their embeddings live in one transactional store, so they can never drift apart.', layer: 'Data', color: VIZ.emerald },
  { id: 'mcp', label: 'CockroachDB MCP Server', icon: Server, desc: 'Model Context Protocol server exposing memory operations to AI agents as tool calls.', layer: 'Data', color: VIZ.cyan },
  { id: 'vector', label: 'Distributed Vector Index', icon: Layers, desc: 'CockroachDB\'s built-in vector index for sub-50ms semantic similarity search at scale.', layer: 'Data', color: VIZ.emerald },
  { id: 'skills', label: 'CockroachDB Agent Skills', icon: Boxes, desc: 'Pre-built agent skill packs: memory recall, consolidation, decay, and graph traversal.', layer: 'Data', color: VIZ.cyan },
];

const layers = ['Client', 'Edge', 'Compute', 'AI', 'Storage', 'Data'];



export default function ArchitecturePage() {
  const [selected, setSelected] = useState<string>('crdb');
  const reveal = useReveal<HTMLDivElement>();
  const selectedNode = nodes.find((n) => n.id === selected)!;

  return (
    <div className="pt-32 pb-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        {/* Header */}
        <div className="max-w-3xl mx-auto text-center mb-16">
          <span className="text-sm font-semibold text-accent tracking-wide uppercase">Architecture</span>
          <h1 className="mt-3 font-display text-4xl sm:text-6xl font-bold tracking-tight text-content">
            Built on a foundation
            <br />
            <span className="text-gradient-brand">that never forgets</span>
          </h1>
          <p className="mt-6 text-lg text-content-muted max-w-2xl mx-auto">
            A geo-distributed architecture powered by CockroachDB and AWS.
            One transactional store for memories and embeddings, searched by meaning.
          </p>
        </div>

        {/* Architecture diagram */}
        <div ref={reveal.ref} className={`glass-strong rounded-3xl p-6 sm:p-10 mb-8 ${reveal.revealed ? 'revealed' : ''} reveal`}>
          {/* Layered diagram */}
          <div className="space-y-6">
            {layers.map((layer) => {
              const layerNodes = nodes.filter((n) => n.layer === layer);
              if (layerNodes.length === 0) return null;
              return (
                <div key={layer}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs font-mono text-content-subtle uppercase tracking-wider">{layer} Layer</span>
                    <div className="flex-1 h-px bg-line/[0.04]" />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {layerNodes.map((n) => (
                      <button
                        key={n.id}
                        onClick={() => setSelected(n.id)}
                        className={`group relative glass rounded-2xl p-4 text-left transition-all duration-300 hover:-translate-y-1 ${
                          selected === n.id ? 'ring-1 ring-accent/50 bg-line/[0.05]' : 'hover:bg-line/[0.04]'
                        }`}
                      >
                        <div className="flex items-center gap-3 mb-2">
                          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: viz(n.color, 0.1), border: `1px solid ${viz(n.color, 0.28)}` }}>
                            <n.icon className="w-5 h-5" style={{ color: viz(n.color) }} strokeWidth={1.75} />
                          </div>
                          <span className="text-sm font-semibold text-content">{n.label}</span>
                        </div>
                        <p className="text-xs text-content-subtle leading-relaxed line-clamp-2">{n.desc}</p>
                        {selected === n.id && (
                          <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-accent ring-2 ring-surface" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Connection flow */}
          <div className="mt-8 pt-6 border-t border-line/[0.10]">
            <div className="flex items-center gap-2 mb-4">
              <Workflow className="w-4 h-4 text-accent" />
              <span className="text-xs font-mono text-content-subtle uppercase tracking-wider">Data Flow</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {['React', 'API Gateway', 'Lambda', 'Bedrock', 'CockroachDB', 'Vector Index', 'MCP Server', 'Agent Skills'].map((step, i, arr) => (
                <div key={step} className="flex items-center gap-2">
                  <span className="text-xs font-medium text-content-muted glass rounded-lg px-2.5 py-1.5">{step}</span>
                  {i < arr.length - 1 && <ArrowRight className="w-3 h-3 text-content-subtle" />}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Selected node detail */}
        <div className="glass rounded-2xl p-6 mb-8">
          <div className="flex items-start gap-4">
            <div className="shrink-0 w-14 h-14 rounded-2xl flex items-center justify-center" style={{ backgroundColor: viz(selectedNode.color, 0.1), border: `1px solid ${viz(selectedNode.color, 0.28)}` }}>
              <selectedNode.icon className="w-7 h-7" style={{ color: viz(selectedNode.color) }} strokeWidth={1.75} />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <h3 className="font-display text-xl font-semibold text-content">{selectedNode.label}</h3>
                <span className="text-xs font-mono text-content-subtle px-2 py-0.5 rounded bg-line/[0.04]">{selectedNode.layer} Layer</span>
              </div>
              <p className="text-content-muted leading-relaxed">{selectedNode.desc}</p>
            </div>
          </div>
        </div>

        {/* Tech stack badges */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-12">
          {[
            { name: 'React + TS', icon: Code },
            { name: 'AWS Lambda', icon: Zap },
            { name: 'Amazon Bedrock', icon: Cloud },
            { name: 'Amazon S3', icon: HardDrive },
            { name: 'CockroachDB', icon: Database },
            { name: 'Amazon Cognito', icon: Globe },
          ].map((t, i) => (
            <div key={i} className="glass rounded-xl p-3 flex items-center gap-2.5 hover:bg-line/[0.04] transition-colors">
              <t.icon className="w-4 h-4 text-accent shrink-0" />
              <span className="text-xs font-medium text-content-muted truncate">{t.name}</span>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="text-center">
          <button
            onClick={() => navigateTo('pricing')}
            className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-brand-400 to-brand-500 text-ink-950 px-7 py-3.5 text-base font-semibold hover:shadow-2xl hover:shadow-brand-500/40 transition-all duration-300 hover:-translate-y-0.5"
          >
            View pricing
            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </button>
        </div>
      </div>
    </div>
  );
}
