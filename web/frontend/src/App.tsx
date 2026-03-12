const hideScrollbar = `
  .use-cases-scroll::-webkit-scrollbar { display: none; }
`;

export default function App() {
  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0f', fontFamily: 'Inter, sans-serif', overflowX: 'hidden' }}>
      <style>{hideScrollbar}</style>

      {/* Nav */}
      <nav style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
        padding: '16px 40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(10,10,15,0.8)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="http://clawpaw.oss-accelerate.aliyuncs.com/clawpaw_logo.png" style={{ width: 36, height: 36 }} />
          <span style={{ fontWeight: 800, fontSize: '1.1rem', color: '#fff' }}>ClawPaw</span>
        </div>
        <a href="https://github.com/wzliu888/clawpaw_phone_control" target="_blank"
          style={{ color: '#888', fontSize: '0.85rem', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
          </svg>
          GitHub
        </a>
      </nav>

      {/* Hero */}
      <section style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', padding: '120px 24px 80px',
        position: 'relative',
      }}>
        {/* Glow */}
        <div style={{
          position: 'absolute', top: '30%', left: '50%', transform: 'translate(-50%, -50%)',
          width: 600, height: 600, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(220,50,50,0.12) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />

        <div style={{
          position: 'relative', width: 110, height: 110, marginBottom: 28,
          filter: 'drop-shadow(0 0 30px rgba(220,60,60,0.4))',
        }}>
          <img src="http://clawpaw.oss-accelerate.aliyuncs.com/clawpaw_logo.png" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        </div>

        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: 'rgba(220,50,50,0.12)', border: '1px solid rgba(220,50,50,0.3)',
          borderRadius: 100, padding: '4px 14px', marginBottom: 24,
          fontSize: '0.75rem', fontWeight: 600, color: '#f87171', letterSpacing: '0.05em',
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f87171', display: 'inline-block' }} />
          AI-NATIVE PHONE CONTROL
        </div>

        <h1 style={{
          fontSize: 'clamp(2.5rem, 6vw, 4.5rem)', fontWeight: 900, textAlign: 'center',
          lineHeight: 1.1, letterSpacing: '-0.03em', maxWidth: 800,
          background: 'linear-gradient(135deg, #fff 40%, #888)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>
          Your phone.<br />Any AI. Any time.
        </h1>

        <p style={{
          marginTop: 24, fontSize: 'clamp(1rem, 2vw, 1.2rem)', color: '#666',
          textAlign: 'center', maxWidth: 520, lineHeight: 1.6,
        }}>
          ClawPaw connects your Android phone to any LLM via MCP.
          Take screenshots, tap, swipe, type — all from a conversation.
        </p>

        <div style={{ marginTop: 48, display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap', justifyContent: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
            <a href="https://dl.clawpaw.me/clawpaw-latest.apk" style={{
              padding: '12px 28px', background: '#dc3232', color: '#fff',
              borderRadius: 10, fontWeight: 700, fontSize: '0.95rem',
              textDecoration: 'none', display: 'inline-block',
            }}>
              Download APK →
            </a>
            <a href="https://github.com/wzliu888/clawpaw_phone_control" target="_blank" style={{
              padding: '12px 28px', background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: '#ccc', borderRadius: 10, fontWeight: 600, fontSize: '0.95rem',
              textDecoration: 'none', display: 'inline-block',
            }}>
              View on GitHub
            </a>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              background: '#fff', borderRadius: 12, padding: 10, display: 'inline-block',
              boxShadow: '0 0 30px rgba(220,50,50,0.2)',
            }}>
              <img
                src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=https%3A%2F%2Fdl.clawpaw.me%2Fclawpaw-latest.apk"
                width={120} height={120}
                alt="Scan to download APK"
                style={{ display: 'block' }}
              />
            </div>
            <p style={{ color: '#555', fontSize: '0.72rem', marginTop: 8 }}>Scan to download</p>
          </div>
        </div>

      </section>

      {/* Features */}
      <section style={{ padding: '80px 24px', maxWidth: 1000, margin: '0 auto' }}>
        <h2 style={{
          textAlign: 'center', fontSize: 'clamp(1.8rem, 4vw, 2.5rem)', fontWeight: 800,
          letterSpacing: '-0.02em', marginBottom: 56,
          background: 'linear-gradient(135deg, #fff 50%, #666)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>
          Everything you need to control your phone
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
          {[
            {
              icon: '📸',
              title: 'Screenshot & UI Tree',
              desc: 'Take screenshots and read the full UI element tree. The AI sees exactly what\'s on screen.',
            },
            {
              icon: '👆',
              title: 'Tap, Swipe, Type',
              desc: 'Full input control — tap coordinates, swipe gestures, type text into any field.',
            },
            {
              icon: '🔒',
              title: 'Secure by Default',
              desc: 'Your secret key never leaves your device. All traffic goes through an encrypted SSH tunnel.',
            },
            {
              icon: '🌐',
              title: 'Works Anywhere',
              desc: 'Your phone. Any AI. Any time.',
            },
            {
              icon: '⚡',
              title: 'MCP Native',
              desc: 'Built for the Model Context Protocol. Drop it into any Claude, GPT, or custom agent.',
            },
            {
              icon: '🤖',
              title: 'Open Source',
              desc: 'Fully open source. Self-host the backend or use the hosted version at clawpaw.me.',
            },
          ].map(f => (
            <div key={f.title} style={{
              padding: '28px 24px', borderRadius: 16,
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.07)',
            }}>
              <div style={{ fontSize: '1.8rem', marginBottom: 14 }}>{f.icon}</div>
              <h3 style={{ fontWeight: 700, fontSize: '1rem', color: '#e5e5e5', marginBottom: 8 }}>{f.title}</h3>
              <p style={{ color: '#555', fontSize: '0.875rem', lineHeight: 1.6 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Use Cases — horizontal scroll */}
      <section style={{ padding: '0 0 80px' }}>
        <h2 style={{
          textAlign: 'center', fontSize: 'clamp(1.8rem, 4vw, 2.5rem)', fontWeight: 800,
          letterSpacing: '-0.02em', marginBottom: 40,
          background: 'linear-gradient(135deg, #fff 50%, #666)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>
          What you can do
        </h2>
        <div style={{
          display: 'flex', gap: 20, overflowX: 'auto', padding: '8px 40px 24px',
          scrollbarWidth: 'none', msOverflowStyle: 'none',
        }} className="use-cases-scroll">
          {[
            {
              emoji: '💬',
              title: 'Send a message for you',
              desc: 'Open WeChat, find Mom, and send "on my way" — without touching your phone.',
              cmd: 'tap(156, 892) → type_text("on my way") → press_key("enter")',
            },
            {
              emoji: '🛒',
              title: 'Place an order on Taobao',
              desc: 'Search for a product, pick the best-reviewed option, and check out automatically.',
              cmd: 'launch_app("com.taobao.taobao") → type_text("AirPods") → tap(checkout)',
            },
            {
              emoji: '📅',
              title: 'Book a meeting',
              desc: 'Open Calendar, create an event at 3 PM tomorrow, and invite your teammates.',
              cmd: 'launch_app("calendar") → tap(new_event) → type_text("Team Sync")',
            },
            {
              emoji: '🎵',
              title: 'Control your music',
              desc: 'Skip to the next song, adjust volume, or switch playlist — all from Claude.',
              cmd: 'press_key("media_next") → set_volume(70)',
            },
            {
              emoji: '📸',
              title: 'Read anything on screen',
              desc: 'Screenshot any app and let the AI extract, summarize, or translate the content.',
              cmd: 'screenshot() → snapshot() → "here\'s what I see..."',
            },
            {
              emoji: '🔔',
              title: 'Triage your notifications',
              desc: 'Pull down the notification shade, read all alerts, and dismiss the unimportant ones.',
              cmd: 'swipe(540, 0, 540, 800) → snapshot() → dismiss(ids)',
            },
            {
              emoji: '🗺️',
              title: 'Navigate somewhere',
              desc: 'Open Maps, search for a restaurant nearby, and start navigation hands-free.',
              cmd: 'launch_app("maps") → type_text("ramen near me") → tap(navigate)',
            },
            {
              emoji: '📋',
              title: 'Fill out a form',
              desc: 'Auto-fill repetitive forms in any app by reading fields and typing your info.',
              cmd: 'snapshot() → type_text(name) → type_text(email) → tap(submit)',
            },
          ].map(c => (
            <div key={c.title} style={{
              flexShrink: 0, width: 260, borderRadius: 18,
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
              padding: '28px 24px',
              display: 'flex', flexDirection: 'column', gap: 12,
            }}>
              <div style={{ fontSize: '2rem' }}>{c.emoji}</div>
              <h3 style={{ fontWeight: 700, fontSize: '0.95rem', color: '#e5e5e5', margin: 0 }}>{c.title}</h3>
              <p style={{ color: '#555', fontSize: '0.82rem', lineHeight: 1.6, margin: 0, flexGrow: 1 }}>{c.desc}</p>
              <div style={{
                fontFamily: 'monospace', fontSize: '0.7rem', color: '#dc3232',
                background: 'rgba(220,50,50,0.07)', borderRadius: 8,
                padding: '8px 12px', lineHeight: 1.6, wordBreak: 'break-all',
              }}>{c.cmd}</div>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section style={{ padding: '80px 24px', maxWidth: 800, margin: '0 auto', textAlign: 'center' }}>
        <h2 style={{
          fontSize: 'clamp(1.8rem, 4vw, 2.5rem)', fontWeight: 800,
          letterSpacing: '-0.02em', marginBottom: 16,
          background: 'linear-gradient(135deg, #fff 50%, #666)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>
          How it works
        </h2>
        <p style={{ color: '#555', marginBottom: 52, lineHeight: 1.6 }}>
          A persistent SSH reverse tunnel connects your phone to the cloud backend,<br />
          giving any LLM direct ADB access over a secure channel.
        </p>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 0 }}>
          {[
            { label: 'LLM', sub: 'Claude / GPT' },
            { arrow: true },
            { label: 'MCP Server', sub: 'stdio transport' },
            { arrow: true },
            { label: 'Backend', sub: 'clawpaw.me' },
            { arrow: true },
            { label: 'SSH Tunnel', sub: 'reverse proxy' },
            { arrow: true },
            { label: 'Android', sub: 'ADB :5555' },
          ].map((item, i) => (
            item.arrow ? (
              <div key={i} style={{ color: '#333', fontSize: '1.2rem', padding: '0 4px' }}>→</div>
            ) : (
              <div key={i} style={{
                padding: '16px 20px', borderRadius: 12,
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                textAlign: 'center', minWidth: 100,
              }}>
                <div style={{ fontWeight: 700, fontSize: '0.875rem', color: '#e5e5e5' }}>{item.label}</div>
                <div style={{ fontSize: '0.7rem', color: '#555', marginTop: 2 }}>{item.sub}</div>
              </div>
            )
          ))}
        </div>
      </section>

      {/* CTA */}
      <section style={{
        padding: '80px 24px 120px', textAlign: 'center',
        borderTop: '1px solid rgba(255,255,255,0.06)',
      }}>
        <img src="http://clawpaw.oss-accelerate.aliyuncs.com/clawpaw_logo.png" style={{ width: 64, height: 64, marginBottom: 20, filter: 'drop-shadow(0 0 20px rgba(220,60,60,0.3))' }} />
        <h2 style={{
          fontSize: 'clamp(1.8rem, 4vw, 2.5rem)', fontWeight: 800,
          letterSpacing: '-0.02em', marginBottom: 16,
          background: 'linear-gradient(135deg, #fff 50%, #666)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>
          Ready to give AI hands?
        </h2>
        <p style={{ color: '#555', marginBottom: 48 }}>
          Install the Android app, run the MCP server, and start controlling your phone.
        </p>

        <p style={{ color: '#555', fontSize: '0.95rem', marginBottom: 12 }}>Questions or feedback?</p>
        <a href="mailto:ericshen.18888@gmail.com" style={{
          display: 'inline-block', padding: '12px 28px',
          background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 10, color: '#ccc', fontWeight: 600, fontSize: '1rem',
          textDecoration: 'none',
        }}>
          ericshen.18888@gmail.com
        </a>
      </section>

      {/* Footer */}
      <footer style={{
        padding: '24px 40px', borderTop: '1px solid rgba(255,255,255,0.05)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        flexWrap: 'wrap', gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <img src="http://clawpaw.oss-accelerate.aliyuncs.com/clawpaw_logo.png" style={{ width: 20, height: 20 }} />
          <span style={{ color: '#444', fontSize: '0.8rem' }}>ClawPaw © 2025</span>
        </div>
        <a href="https://github.com/wzliu888/clawpaw_phone_control" target="_blank"
          style={{ color: '#444', fontSize: '0.8rem', textDecoration: 'none' }}>
          Open Source on GitHub
        </a>
      </footer>

    </div>
  );
}
