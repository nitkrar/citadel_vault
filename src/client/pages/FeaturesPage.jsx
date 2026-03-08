import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Shield, ArrowLeft, BookOpen, FileText } from 'lucide-react';
import api from '../api/client';

// Lightweight markdown → HTML renderer (handles the patterns in our README/CHANGELOG)
function renderMarkdown(md) {
  if (!md) return '';

  let html = md
    // Escape HTML
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

    // Code blocks (```)
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
      `<pre style="background:var(--bg-hover);border:1px solid var(--border-color);border-radius:8px;padding:14px;overflow-x:auto;font-size:0.8rem;line-height:1.6;margin:12px 0"><code>${code.trim()}</code></pre>`
    )

    // Tables
    .replace(/^(\|.+\|)\n(\|[-| :]+\|)\n((?:\|.+\|\n?)*)/gm, (_, header, sep, body) => {
      const thCells = header.split('|').filter(c => c.trim()).map(c => `<th style="padding:8px 12px;text-align:left;font-size:0.8rem">${c.trim()}</th>`).join('');
      const rows = body.trim().split('\n').map(row => {
        const cells = row.split('|').filter(c => c.trim()).map(c => `<td style="padding:8px 12px;font-size:0.8rem">${c.trim()}</td>`).join('');
        return `<tr>${cells}</tr>`;
      }).join('');
      return `<div style="overflow-x:auto;margin:12px 0"><table style="width:100%;border-collapse:collapse;border:1px solid var(--border-color)"><thead style="background:var(--bg-hover)"><tr>${thCells}</tr></thead><tbody>${rows}</tbody></table></div>`;
    })

    // Headings
    .replace(/^#### (.+)$/gm, '<h4 style="margin:20px 0 8px;font-size:0.95rem">$1</h4>')
    .replace(/^### (.+)$/gm, '<h3 style="margin:24px 0 10px;font-size:1.05rem">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 style="margin:28px 0 12px;font-size:1.2rem;padding-bottom:6px;border-bottom:1px solid var(--border-color)">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 style="margin:0 0 16px;font-size:1.5rem">$1</h1>')

    // Bold + italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')

    // Inline code
    .replace(/`([^`]+)`/g, '<code style="background:var(--bg-hover);padding:1px 5px;border-radius:3px;font-size:0.85em">$1</code>')

    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:var(--primary)" target="_blank" rel="noopener noreferrer">$1</a>')

    // Unordered lists
    .replace(/^- (.+)$/gm, '<li style="margin:4px 0;font-size:0.88rem">$1</li>')

    // Horizontal rules
    .replace(/^---$/gm, '<hr style="border:none;border-top:1px solid var(--border-color);margin:20px 0">')

    // Paragraphs (blank lines between text)
    .replace(/\n\n(?!<)/g, '</p><p style="margin:10px 0;font-size:0.88rem;line-height:1.7;color:var(--text-muted)">')

    // Wrap consecutive <li> in <ul>
    .replace(/((?:<li[^>]*>.*?<\/li>\s*)+)/g, '<ul style="padding-left:20px;margin:8px 0">$1</ul>')

    // Line breaks
    .replace(/\n/g, '<br>');

  // Wrap in paragraph
  html = `<p style="margin:10px 0;font-size:0.88rem;line-height:1.7;color:var(--text-muted)">${html}</p>`;

  // Clean up empty paragraphs
  html = html.replace(/<p[^>]*>\s*<\/p>/g, '');
  html = html.replace(/<p[^>]*>\s*<br>\s*<\/p>/g, '');

  return html;
}

export default function FeaturesPage() {
  const [activeTab, setActiveTab] = useState('readme');
  const [readme, setReadme] = useState(null);
  const [changelog, setChangelog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      api.get('/docs.php?file=readme').then(r => r.data?.data?.content || '').catch(() => ''),
      api.get('/docs.php?file=changelog').then(r => r.data?.data?.content || '').catch(() => ''),
    ]).then(([r, c]) => {
      setReadme(r);
      setChangelog(c);
      setLoading(false);
    }).catch(() => {
      setError('Failed to load documentation.');
      setLoading(false);
    });
  }, []);

  const tabs = [
    { key: 'readme', label: 'Overview & Features', icon: <BookOpen size={14} /> },
    { key: 'changelog', label: 'Changelog', icon: <FileText size={14} /> },
  ];

  const content = activeTab === 'readme' ? readme : changelog;

  return (
    <div className="auth-page" style={{ minHeight: '100vh', padding: '24px 16px' }}>
      <div style={{ maxWidth: 860, width: '100%', margin: '0 auto' }}>
        {/* Nav bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <Link to="/home" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--primary)', textDecoration: 'none', fontSize: '0.875rem', fontWeight: 500 }}>
            <ArrowLeft size={16} /> Back to Home
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Shield size={20} style={{ color: 'var(--primary)' }} />
            <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>Citadel</span>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <Link to="/help" style={{ color: 'var(--text-muted)', textDecoration: 'none', fontSize: '0.875rem' }}>Help & FAQ</Link>
            <Link to="/dev-guide" style={{ color: 'var(--text-muted)', textDecoration: 'none', fontSize: '0.875rem' }}>Dev Guide</Link>
          </div>
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--border-color)', paddingBottom: 0 }}>
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '10px 16px',
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: '0.875rem', fontWeight: activeTab === tab.key ? 600 : 400,
                color: activeTab === tab.key ? 'var(--primary)' : 'var(--text-muted)',
                borderBottom: activeTab === tab.key ? '2px solid var(--primary)' : '2px solid transparent',
                marginBottom: -1,
              }}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{
          background: 'var(--card-bg)', border: '1px solid var(--border-color)',
          borderRadius: 10, padding: '24px 28px', minHeight: 300,
        }}>
          {loading && (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Loading documentation...</div>
          )}
          {error && (
            <div className="alert alert-danger">{error}</div>
          )}
          {!loading && !error && content && (
            <div dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
          )}
          {!loading && !error && !content && (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>No content available.</div>
          )}
        </div>
      </div>
    </div>
  );
}
