import React, { useState, useEffect } from 'react';
import Header from '../../shared/components/Header';
import Footer from '../../shared/components/Footer';
import './PatchNotes.scss';

const patches = [
  'v8.3 Patch Notes.txt','v8.2 Patch Notes.txt','v8.1 Patch Notes.txt','v8.0 Patch Notes.txt',
  'v7.9 Patch Notes.txt','v7.8 Patch Notes.txt','v7.7 Patch Notes.txt','v7.6 Patch Notes.txt','v7.5 Patch Notes.txt','v7.4 Patch Notes.txt','v7.3 Patch Notes.txt','v7.2 Patch Notes.txt','v7.1 Patch Notes.txt','v7.0 Patch Notes.txt',
  'v6.9 Patch Notes.txt','v6.8 Patch Notes.txt','v6.7 Patch Notes.txt','v6.6 Patch Notes.txt','v6.5 Patch Notes.txt','v6.4 Patch Notes.txt','v6.3 Patch Notes.txt','v6.2 Patch Notes.txt','v6.1 Patch Notes.txt','v6.0 Patch Notes.txt',
  'v5.9 Patch Notes.txt','v5.8 Patch Notes.txt','v5.7 Patch Notes.txt','v5.5 Patch Notes.txt','v5.4 Patch Notes.txt','v5.3 Patch Notes.txt','v5.2 Patch Notes.txt','v5.1 Patch Notes.txt','v5.0 Patch Notes.txt',
  'v4.9 Patch Notes.txt','v4.8 Patch Notes.txt','v4.7 Patch Notes.txt','v4.6 Patch Notes.txt','v4.5 Patch Notes.txt','v4.4 Patch Notes.txt','v4.3 Patch Notes.txt','v4.2 Patch Notes.txt','v4.1 Patch Notes.txt','v4.0 Patch Notes.txt',
  'v3.0 Patch Notes.txt',
  'v2.9 Patch Notes.txt','v2.8 Patch Notes.txt','v2.7 Patch Notes.txt','v2.6 Patch Notes.txt','v2.5 Patch Notes.txt','v2.4 Patch Notes.txt','v2.3 Patch Notes.txt','v2.2 Patch Notes.txt','v2.1 Patch Notes.txt','v2.0 Patch Notes.txt',
  'v1.9 Patch Notes.txt','v1.8 Patch Notes.txt','v1.7 Patch Notes.txt'
];

const PatchItem = ({ filename }: { filename: string }) => {
  const [expanded, setExpanded] = useState(false);
  const [content, setContent] = useState('');
  const [date, setDate] = useState('');
  const [loading, setLoading] = useState(false);

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

  return (
    <div className="patch-item">
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
          {loading ? 'Loading...' : content}
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
