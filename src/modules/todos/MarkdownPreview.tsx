import React from 'react';

function isSafeLink(url: string) {
  return /^(https?:|mailto:)/i.test(url);
}

function parseInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|~~[^~]+~~|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    if (token.startsWith('`')) {
      nodes.push(<code key={`${match.index}-code`} className="rounded bg-black/30 px-1 py-0.5 text-[11px] text-sky-100">{token.slice(1, -1)}</code>);
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={`${match.index}-bold`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('~~')) {
      nodes.push(<del key={`${match.index}-del`}>{token.slice(2, -2)}</del>);
    } else if (token.startsWith('[')) {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const label = linkMatch?.[1] || token;
      const href = linkMatch?.[2] || '';
      nodes.push(isSafeLink(href)
        ? <a key={`${match.index}-link`} href={href} className="text-sky-200 underline underline-offset-2">{label}</a>
        : label
      );
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

export const MarkdownPreview: React.FC<{ content: string }> = ({ content }) => {
  const lines = content.split(/\r?\n/);
  const blocks: React.ReactNode[] = [];
  let codeBuffer: string[] = [];
  let inCode = false;
  let tableBuffer: string[] = [];

  const flushTable = () => {
    if (tableBuffer.length < 2) {
      for (const row of tableBuffer) {
        blocks.push(<p key={`table-fallback-${blocks.length}`} className="my-1 text-[12px] leading-5 text-slate-200">{parseInline(row)}</p>);
      }
      tableBuffer = [];
      return;
    }

    const [header, divider, ...rows] = tableBuffer;
    if (!/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(divider)) {
      for (const row of tableBuffer) {
        blocks.push(<p key={`table-fallback-${blocks.length}`} className="my-1 text-[12px] leading-5 text-slate-200">{parseInline(row)}</p>);
      }
      tableBuffer = [];
      return;
    }

    const splitRow = (row: string) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
    const headers = splitRow(header);

    blocks.push(
      <div key={`table-${blocks.length}`} className="my-3 overflow-x-auto rounded-lg border border-white/[0.08]">
        <table className="w-full border-collapse text-left text-[11px]">
          <thead className="bg-white/[0.06] text-slate-200">
            <tr>{headers.map((cell, index) => <th key={index} className="border-b border-white/[0.08] px-2 py-1.5 font-bold">{parseInline(cell)}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-t border-white/[0.05]">
                {splitRow(row).map((cell, cellIndex) => <td key={cellIndex} className="px-2 py-1.5 text-slate-300">{parseInline(cell)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    tableBuffer = [];
  };

  lines.forEach((line, index) => {
    if (line.trim().startsWith('```')) {
      flushTable();
      if (inCode) {
        blocks.push(
          <pre key={`code-${index}`} className="my-2 overflow-x-auto rounded-lg border border-white/[0.08] bg-black/35 p-3 text-[11px] leading-5 text-slate-200">
            <code>{codeBuffer.join('\n')}</code>
          </pre>
        );
        codeBuffer = [];
        inCode = false;
      } else {
        inCode = true;
      }
      return;
    }

    if (inCode) {
      codeBuffer.push(line);
      return;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      flushTable();
      blocks.push(<div key={`space-${index}`} className="h-2" />);
      return;
    }

    if (trimmed.includes('|') && trimmed.split('|').length >= 3) {
      tableBuffer.push(trimmed);
      return;
    }

    flushTable();

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const className = level === 1
        ? 'mt-3 text-[18px] font-black text-slate-50'
        : level === 2
          ? 'mt-3 text-[15px] font-bold text-slate-100'
          : 'mt-2 text-[13px] font-bold text-slate-200';
      blocks.push(<div key={`h-${index}`} className={className}>{parseInline(heading[2])}</div>);
      return;
    }

    const checkbox = trimmed.match(/^- \[([ xX])\]\s+(.+)$/);
    if (checkbox) {
      blocks.push(
        <div key={`check-${index}`} className="my-1 flex items-start gap-2 text-[12px] leading-5 text-slate-200">
          <span className={`mt-1 grid h-3.5 w-3.5 shrink-0 place-items-center rounded border ${checkbox[1].trim() ? 'border-emerald-300 bg-emerald-400/25' : 'border-slate-500 bg-white/[0.03]'}`} />
          <span>{parseInline(checkbox[2])}</span>
        </div>
      );
      return;
    }

    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      blocks.push(
        <div key={`li-${index}`} className="my-1 flex gap-2 text-[12px] leading-5 text-slate-200">
          <span className="text-slate-500">•</span>
          <span>{parseInline(bullet[1])}</span>
        </div>
      );
      return;
    }

    const quote = trimmed.match(/^>\s+(.+)$/);
    if (quote) {
      blocks.push(
        <div key={`quote-${index}`} className="my-2 border-l-2 border-sky-300/40 pl-3 text-[12px] italic leading-5 text-slate-300">
          {parseInline(quote[1])}
        </div>
      );
      return;
    }

    blocks.push(<p key={`p-${index}`} className="my-1 text-[12px] leading-5 text-slate-200">{parseInline(trimmed)}</p>);
  });

  if (inCode && codeBuffer.length > 0) {
    blocks.push(
      <pre key="code-tail" className="my-2 overflow-x-auto rounded-lg border border-white/[0.08] bg-black/35 p-3 text-[11px] leading-5 text-slate-200">
        <code>{codeBuffer.join('\n')}</code>
      </pre>
    );
  }

  flushTable();

  return <div className="break-words">{blocks}</div>;
};
