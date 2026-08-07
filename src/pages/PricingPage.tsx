import { Check, ArrowRight } from 'lucide-react';
import { navigateTo } from '../router';

const tiers = [
  {
    name: 'Starter',
    price: '$0',
    period: '/forever',
    desc: 'For experiments and side projects.',
    features: [
      '10K memories / month',
      '1 agent',
      'Vector search',
      '7-day memory retention',
      'Community support',
      'REST API access',
    ],
    cta: 'Start free',
    highlighted: false,
  },
  {
    name: 'Professional',
    price: '$49',
    period: '/month',
    desc: 'For production agents that need to remember.',
    features: [
      '10M memories / month',
      'Unlimited agents',
      'Vector + graph search',
      'Memory layers & decay',
      'Event-driven webhooks',
      '90-day retention',
      'Real-time sync',
      'Priority support',
    ],
    cta: 'Start 14-day trial',
    highlighted: true,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    period: '',
    desc: 'For teams running agents at scale.',
    features: [
      'Unlimited memories',
      'Dedicated infrastructure',
      'Custom retention policies',
      'Full audit log of every recall and write',
      'SSO & RBAC',
      'On-prem deployment',
      'CockroachDB MCP Server',
      '24/7 dedicated support',
    ],
    cta: 'Talk to sales',
    highlighted: false,
  },
];

export default function PricingPage() {
  return (
    <div className="pt-32 pb-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="max-w-2xl mx-auto text-center mb-16">
          <span className="text-sm font-semibold text-accent tracking-wide uppercase">Pricing</span>
          <h1 className="mt-3 font-display text-4xl sm:text-6xl font-bold tracking-tight text-content">
            Pay for what your agents{' '}
            <span className="text-gradient-brand">remember</span>
          </h1>
          <p className="mt-6 text-lg text-content-muted">
            Start free. Scale when your agents do. No hidden fees.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {tiers.map((tier, i) => (
            <div
              key={i}
              className={`relative rounded-2xl p-8 flex flex-col ${
                tier.highlighted
                  ? 'glass-strong border-accent/30 shadow-2xl shadow-brand-500/10 lg:-translate-y-4'
                  : 'glass'
              }`}
            >
              {tier.highlighted && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-brand-400 to-brand-500 px-4 py-1 text-xs font-semibold text-ink-950">
                  Most popular
                </div>
              )}

              <div className="mb-6">
                <h3 className="font-display text-lg font-semibold text-content">{tier.name}</h3>
                <p className="mt-1 text-sm text-content-subtle">{tier.desc}</p>
              </div>

              <div className="mb-6">
                <span className="font-display text-4xl font-bold text-content">{tier.price}</span>
                <span className="text-content-subtle text-sm">{tier.period}</span>
              </div>

              <ul className="space-y-3 mb-8 flex-1">
                {tier.features.map((f, j) => (
                  <li key={j} className="flex items-start gap-3 text-sm text-content-muted">
                    <Check className={`shrink-0 w-4 h-4 mt-0.5 ${tier.highlighted ? 'text-accent' : 'text-positive'}`} />
                    {f}
                  </li>
                ))}
              </ul>

              <button
                onClick={() => navigateTo(tier.name === 'Enterprise' ? 'contact' : 'signup')}
                className={`group inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition-all duration-200 ${
                  tier.highlighted
                    ? 'bg-gradient-to-r from-brand-400 to-brand-500 text-ink-950 hover:shadow-lg hover:shadow-brand-500/30'
                    : 'glass text-content hover:bg-line/[0.06]'
                }`}
              >
                {tier.cta}
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </button>
            </div>
          ))}
        </div>

        {/* FAQ */}
        <div className="max-w-3xl mx-auto mt-20">
          <h2 className="font-display text-2xl font-bold text-content text-center mb-8">Frequently asked questions</h2>
          <div className="space-y-4">
            {[
              { q: 'What counts as a memory?', a: 'A memory is any stored piece of information your agent writes via the API — a fact, a preference, a decision, or a conversation summary. Reads (recalls) are free.' },
              { q: 'Can I switch plans later?', a: 'Yes. Upgrade or downgrade at any time. Changes take effect immediately and we primate the difference.' },
              { q: 'Is my data isolated?', a: 'Absolutely. Every tenant gets isolated storage in CockroachDB with per-agent namespaces. Your data never trains another customer\'s model.' },
              { q: 'Do you offer on-prem deployment?', a: 'Yes, on the Enterprise plan. We support VPC deployment, on-prem CockroachDB clusters, and air-gapped environments.' },
              { q: 'What models are supported?', a: 'Memora works with any LLM via Amazon Bedrock — Claude, Llama, Mistral, and more. You can also bring your own model.' },
            ].map((faq, i) => (
              <div key={i} className="glass rounded-2xl p-5">
                <h3 className="text-sm font-semibold text-content mb-2">{faq.q}</h3>
                <p className="text-sm text-content-muted leading-relaxed">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
