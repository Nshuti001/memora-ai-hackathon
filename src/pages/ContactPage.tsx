import { useState } from 'react';
import { Mail, MessageSquare, MapPin, ArrowRight, Check } from 'lucide-react';

export default function ContactPage() {
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', company: '', message: '' });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  return (
    <div className="pt-32 pb-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="max-w-3xl mx-auto text-center mb-16">
          <span className="text-sm font-semibold text-brand-400 tracking-wide uppercase">Contact</span>
          <h1 className="mt-3 font-display text-4xl sm:text-6xl font-bold tracking-tight text-white">
            Let's build something
            <br />
            <span className="text-gradient-brand">unforgettable</span>
          </h1>
          <p className="mt-6 text-lg text-ink-300 max-w-2xl mx-auto">
            Whether you're evaluating Memora for your team or need help with
            integration, we'd love to hear from you.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {/* Contact info */}
          <div className="space-y-4">
            {[
              { icon: Mail, title: 'Email us', value: 'hello@memora.ai', desc: 'We reply within 24 hours.' },
              { icon: MessageSquare, title: 'Live chat', value: 'Available 24/7', desc: 'Talk to our team in real time.' },
              { icon: MapPin, title: 'Office', value: 'San Francisco, CA', desc: '535 Mission St, Floor 12' },
            ].map((c, i) => (
              <div key={i} className="glass rounded-2xl p-5">
                <div className="flex items-start gap-3">
                  <div className="shrink-0 w-10 h-10 rounded-xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center">
                    <c.icon className="w-5 h-5 text-brand-400" strokeWidth={1.75} />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white">{c.title}</h3>
                    <p className="text-sm text-brand-300 mt-0.5">{c.value}</p>
                    <p className="text-xs text-ink-400 mt-1">{c.desc}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Form */}
          <div className="lg:col-span-2">
            <div className="glass-strong rounded-2xl p-6 sm:p-8">
              {submitted ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="w-16 h-16 rounded-full bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center mb-4">
                    <Check className="w-8 h-8 text-emerald-400" />
                  </div>
                  <h3 className="font-display text-xl font-semibold text-white mb-2">Message sent!</h3>
                  <p className="text-sm text-ink-300 max-w-sm">
                    Thanks for reaching out. Our team will get back to you within 24 hours.
                  </p>
                  <button
                    onClick={() => { setSubmitted(false); setForm({ name: '', email: '', company: '', message: '' }); }}
                    className="mt-6 text-sm font-medium text-brand-400 hover:text-brand-300 transition-colors"
                  >
                    Send another message
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-ink-300 mb-1.5">Name</label>
                      <input
                        required
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        className="w-full bg-ink-900/50 rounded-xl px-4 py-2.5 text-sm text-white placeholder-ink-500 border border-white/[0.06] focus:border-brand-400/30 focus:outline-none transition-colors"
                        placeholder="Jane Doe"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-ink-300 mb-1.5">Email</label>
                      <input
                        required
                        type="email"
                        value={form.email}
                        onChange={(e) => setForm({ ...form, email: e.target.value })}
                        className="w-full bg-ink-900/50 rounded-xl px-4 py-2.5 text-sm text-white placeholder-ink-500 border border-white/[0.06] focus:border-brand-400/30 focus:outline-none transition-colors"
                        placeholder="jane@company.com"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-ink-300 mb-1.5">Company</label>
                    <input
                      value={form.company}
                      onChange={(e) => setForm({ ...form, company: e.target.value })}
                      className="w-full bg-ink-900/50 rounded-xl px-4 py-2.5 text-sm text-white placeholder-ink-500 border border-white/[0.06] focus:border-brand-400/30 focus:outline-none transition-colors"
                      placeholder="Acme Inc."
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-ink-300 mb-1.5">Message</label>
                    <textarea
                      required
                      rows={5}
                      value={form.message}
                      onChange={(e) => setForm({ ...form, message: e.target.value })}
                      className="w-full bg-ink-900/50 rounded-xl px-4 py-2.5 text-sm text-white placeholder-ink-500 border border-white/[0.06] focus:border-brand-400/30 focus:outline-none transition-colors resize-none"
                      placeholder="Tell us about your use case..."
                    />
                  </div>
                  <button
                    type="submit"
                    className="group w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-400 to-brand-500 text-ink-950 px-6 py-3 text-sm font-semibold hover:shadow-lg hover:shadow-brand-500/30 transition-all"
                  >
                    Send message
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
