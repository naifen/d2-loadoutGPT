// The build card (#9): rendered when a turn ends on the terminal
// propose_loadout tool. `card` is the complete markdown the runner produced in
// tools.ts — model-authored notes, then "## Items" bucket lines, the subclass
// line, and "## Mods" — so this component renders that markdown plus the two
// copy actions and the DIM link; it needs no item data of its own.
//
// Clipboard: writes only ever happen inside a real click, so
// navigator.clipboard.writeText needs no clipboardWrite permission in either
// browser; the textarea+execCommand fallback covers an unfocused panel.
// browser.tabs.create with just a URL needs no tabs permission either.

import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import type { LoadoutProposal } from '../agent/tools';

export function BuildCard({ proposal }: { proposal: LoadoutProposal }) {
  const [copied, setCopied] = useState<'link' | 'query'>();

  async function copy(which: 'link' | 'query', text: string) {
    try {
      if (!navigator.clipboard) throw new Error('clipboard API unavailable');
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    setCopied(which);
    setTimeout(() => setCopied((c) => (c === which ? undefined : c)), 1500);
  }

  return (
    <div style={{ border: '1px solid #999', borderRadius: 4, padding: '0 0.75em 0.75em' }}>
      <h3>{proposal.name}</h3>
      {markdownBlocks(proposal.card)}
      <p>
        <button onClick={() => browser.tabs.create({ url: proposal.url })}>Open in DIM</button>{' '}
        <button onClick={() => copy('link', proposal.url)}>
          {copied === 'link' ? 'Copied' : 'Copy DIM link'}
        </button>{' '}
        <button onClick={() => copy('query', proposal.query)}>
          {copied === 'query' ? 'Copied' : 'Copy search query'}
        </button>
      </p>
    </div>
  );
}

/** Inline `**bold**` spans — odd segments of a `**` split are bold. */
function inline(text: string): ComponentChildren[] {
  return text.split('**').map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part));
}

const HEADING = /^(#{1,3}) /;

/**
 * The tiny markdown subset the card needs: `#`/`##`/`###` headings (mapped to
 * h3–h5 so they nest under the panel's h2 sections), `- ` bullets, `---`
 * rules, and paragraphs. Notes are model-authored, so anything unrecognized
 * degrades to plain paragraph text.
 */
function markdownBlocks(md: string): ComponentChildren[] {
  const blocks: ComponentChildren[] = [];
  let bullets: string[] = [];
  const flushBullets = () => {
    if (!bullets.length) return;
    blocks.push(
      <ul key={blocks.length}>
        {bullets.map((item, i) => (
          <li key={i}>{inline(item)}</li>
        ))}
      </ul>,
    );
    bullets = [];
  };
  for (const line of md.split('\n')) {
    const t = line.trim();
    if (t.startsWith('- ')) {
      bullets.push(t.slice(2));
      continue;
    }
    flushBullets();
    if (!t) continue;
    if (t === '---') {
      blocks.push(<hr key={blocks.length} />);
      continue;
    }
    const heading = t.match(HEADING);
    if (heading) {
      const level = heading[1]!.length;
      const Tag = `h${level + 2}` as 'h3' | 'h4' | 'h5';
      blocks.push(<Tag key={blocks.length}>{inline(t.slice(level + 1))}</Tag>);
    } else {
      blocks.push(<p key={blocks.length}>{inline(t)}</p>);
    }
  }
  flushBullets();
  return blocks;
}
