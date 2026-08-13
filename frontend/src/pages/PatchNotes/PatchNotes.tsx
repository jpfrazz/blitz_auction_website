import React, { useState, useEffect } from 'react';
import Header from '../../shared/components/Header';
import Footer from '../../shared/components/Footer';
import './PatchNotes.scss';

const patches = [
  'v1.0.5 Patch Notes.txt','v1.0.4 Patch Notes.txt','v1.0.3 Patch Notes.txt','v1.0.2 Patch Notes.txt','v1.0.1 Patch Notes.txt','v1.0.0 Patch Notes.txt',
  'v0.9.2 Patch Notes.txt','v0.9.1 Patch Notes.txt','v0.9.0 Patch Notes.txt',
  'v0.8.9 Patch Notes.txt','v0.8.8 Patch Notes.txt','v0.8.7 Patch Notes.txt','v0.8.6 Patch Notes.txt','v0.8.5 Patch Notes.txt','v0.8.4 Patch Notes.txt','v0.8.32 Patch Notes.txt','v0.8.3 Patch Notes.txt','v0.8.2 Patch Notes.txt','v0.8.1 Patch Notes.txt','v0.8.0 Patch Notes.txt',
  'v0.7.9 Patch Notes.txt','v0.7.8 Patch Notes.txt','v0.7.7 Patch Notes.txt','v0.7.6 Patch Notes.txt','v0.7.5 Patch Notes.txt','v0.7.4 Patch Notes.txt','v0.7.3 Patch Notes.txt','v0.7.2 Patch Notes.txt','v0.7.1 Patch Notes.txt','v0.7.0 Patch Notes.txt',
  'v0.6.9 Patch Notes.txt','v0.6.8 Patch Notes.txt','v0.6.7 Patch Notes.txt','v0.6.6 Patch Notes.txt','v0.6.5 Patch Notes.txt','v0.6.4 Patch Notes.txt','v0.6.3 Patch Notes.txt','v0.6.2 Patch Notes.txt','v0.6.1 Patch Notes.txt','v0.6.0 Patch Notes.txt',
  'v0.5.9 Patch Notes.txt','v0.5.8 Patch Notes.txt','v0.5.7 Patch Notes.txt','v0.5.5 Patch Notes.txt','v0.5.4 Patch Notes.txt','v0.5.3 Patch Notes.txt','v0.5.2 Patch Notes.txt','v0.5.1 Patch Notes.txt','v0.5.0 Patch Notes.txt',
  'v0.4.9 Patch Notes.txt','v0.4.8 Patch Notes.txt','v0.4.7 Patch Notes.txt','v0.4.6 Patch Notes.txt','v0.4.5 Patch Notes.txt','v0.4.4 Patch Notes.txt','v0.4.3 Patch Notes.txt','v0.4.2 Patch Notes.txt','v0.4.1 Patch Notes.txt','v0.4.0 Patch Notes.txt',
  'v0.3.0 Patch Notes.txt',
  'v0.2.9 Patch Notes.txt','v0.2.8 Patch Notes.txt','v0.2.7 Patch Notes.txt','v0.2.6 Patch Notes.txt','v0.2.5 Patch Notes.txt','v0.2.4 Patch Notes.txt','v0.2.3 Patch Notes.txt','v0.2.2 Patch Notes.txt','v0.2.1 Patch Notes.txt','v0.2.0 Patch Notes.txt',
  'v0.1.9 Patch Notes.txt','v0.1.8 Patch Notes.txt','v0.1.7 Patch Notes.txt'
];

const START_MARKER = '//Extended Commentary Start';
const END_MARKER = '//Extended Commentary End';

type Segment =
  | { type: 'text'; content: string }
  | { type: 'commentary'; content: string };

const parseContent = (text: string): Segment[] => {
  const segments: Segment[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const startIdx = text.indexOf(START_MARKER, cursor);
    if (startIdx === -1) {
      segments.push({ type: 'text', content: text.slice(cursor) });
      break;
    }

    if (startIdx > cursor) {
      segments.push({ type: 'text', content: text.slice(cursor, startIdx) });
    }

    const afterStart = startIdx + START_MARKER.length;
    const endIdx = text.indexOf(END_MARKER, afterStart);
    if (endIdx === -1) {
      segments.push({ type: 'text', content: text.slice(startIdx) });
      break;
    }

    segments.push({ type: 'commentary', content: text.slice(afterStart, endIdx).replace(/^\n+/, '') });
    cursor = endIdx + END_MARKER.length;
  }

  return segments;
};

const PatchItem = ({ filename }: { filename: string }) => {
  const [expanded, setExpanded] = useState(false);
  const [content, setContent] = useState('');
  const [date, setDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [openCommentary, setOpenCommentary] = useState<Record<number, boolean>>({});

  useEffect(() => {
    const fetchDate = async () => {
      try {
        const res = await fetch(`/patches/${encodeURIComponent(filename)}`);
        if (res.ok) {
          const txt = await res.text();
          const firstLine = txt.split(/\r?\n/)[0] || '';
          setDate(firstLine.trim() || 'Date unavailable');
        } else {
          setDate('Date unavailable');
        }
      } catch (e) {
        setDate('Date unavailable');
      }
    };
    fetchDate();
  }, [filename]);

  const toggle = async () => {
    if (!expanded && !content) {
      setLoading(true);
      try {
        const res = await fetch(`/patches/${encodeURIComponent(filename)}`);
        if (res.ok) {
          const txt = await res.text();
          setContent(txt);
        } else {
          setContent('Error loading patch notes.');
        }
      } catch (e) {
        setContent('Error loading patch notes.');
      }
      setLoading(false);
    }
    setExpanded(!expanded);
  };

  const shortName = filename.replace(' Patch Notes.txt', '').replace(/^v/, '');
  const isCurrentMajor = (() => {
    const parts = shortName.split('.').map(Number);
    return parts.length >= 2 && parts[0] >= 1;
  })();
  const segments = content ? parseContent(content) : null;
  const commentaryCount = segments ? segments.filter(s => s.type === 'commentary').length : 0;

  return (
    <div className={`patch-item${isCurrentMajor ? ' current-major' : ''}`}>
      <div 
        className="patch-bar" 
        onClick={toggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
      >
        <div className="patch-meta">Version {shortName} Patch Notes</div>
        <div className="patch-date">{date}</div>
      </div>
      {expanded && (
        <div className="patch-content">
          {loading ? 'Loading...' : segments ? (
            <>
              {(() => {
                let commentaryIdx = 0;
                return segments.map((seg, i) => {
                  if (seg.type === 'text') {
                    return <span key={i}>{seg.content}</span>;
                  }
                  const idx = commentaryIdx++;
                  const isOpen = openCommentary[idx] || false;
                  return (
                    <div key={i} className="extended-commentary">
                      <button
                        className="commentary-toggle"
                        onClick={() => setOpenCommentary(prev => ({ ...prev, [idx]: !prev[idx] }))}
                      >
                        {isOpen ? '▾' : '▸'} Extended Commentary
                      </button>
                      {isOpen && (
                        <div className="commentary-body">
                          {seg.content}
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </>
          ) : content}
        </div>
      )}
    </div>
  );
};

const PatchNotes = () => {
  return (
    <>
      <Header />
      <main className="patch-notes-page">
        <h1 className="page-title">Patch Notes</h1>
        <div className="patch-container">
          <div className="patch-list">
            {patches.map(p => <PatchItem key={p} filename={p} />)}
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
};

export default PatchNotes;
