import { useMemo, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { LoadoutProposal } from '../agent/proposal';
import { EngramIcon } from './icons';

export function BuildCard({ proposal }: { proposal: LoadoutProposal }) {
  const [copied, setCopied] = useState<'link' | 'query'>();
  const [error, setError] = useState<string>();
  const html = useMemo(() => {
    const safe = DOMPurify.sanitize(marked.parse(proposal.card, { async: false }), {
      ALLOWED_TAGS: ['p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'del', 'blockquote', 'pre', 'code', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a'],
      ALLOWED_ATTR: ['href', 'title', 'start'],
      ALLOWED_URI_REGEXP: /^https?:\/\//i,
      RETURN_DOM: true,
    });
    if (!(safe instanceof HTMLElement)) throw new Error('Markdown sanitizer returned an unexpected node.');
    for (const link of safe.querySelectorAll('a')) {
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
    }
    return safe.innerHTML;
  }, [proposal.card]);

  async function copy(which: 'link' | 'query', text: string) {
    setError(undefined);
    try {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const area = document.createElement('textarea');
        area.value = text;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        try {
          area.select();
          if (!document.execCommand('copy')) throw new Error('Copy failed; select and copy the output manually.');
        } finally {
          area.remove();
        }
      }
      setCopied(which);
      setTimeout(() => setCopied((c) => (c === which ? undefined : c)), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function openDim() {
    try {
      const url = new URL(proposal.url);
      if (url.origin !== 'https://app.destinyitemmanager.com' || url.pathname !== '/loadouts' || !url.searchParams.has('loadout')) {
        throw new Error('The build does not contain a valid DIM loadout link.');
      }
      await browser.tabs.create({ url: url.href });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div class="build-card">
      <header class="build-card-head">
        <EngramIcon class="build-card-icon" />
        <div class="build-card-titles">
          <h3>{proposal.name}</h3>
          <p class="build-card-sub">Loadout proposal</p>
        </div>
      </header>
      <div class="build-card-body" dangerouslySetInnerHTML={{ __html: html }} />
      <p class="build-card-actions">
        <button class="btn btn-gold" onClick={openDim}>
          Open in DIM
        </button>
        <button class="btn" onClick={() => copy('link', proposal.url)}>
          {copied === 'link' ? 'Copied' : 'Copy DIM link'}
        </button>
        <button class="btn" onClick={() => copy('query', proposal.query)}>
          {copied === 'query' ? 'Copied' : 'Copy search query'}
        </button>
      </p>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
