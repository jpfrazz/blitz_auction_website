import React, { useState, useEffect } from 'react';
import Header from '../shared/components/Header';
import './SourceCodePage.scss';

const SourceCodePage: React.FC = () => {
    const [activeTab, setActiveTab] = useState('level-up');
    const [content, setContent] = useState<string>('');
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);

    const tabs = [
        { 
            id: 'level-up', 
            label: 'Level-Up Learnsets', 
            url: 'https://raw.githubusercontent.com/FranklyNathan/EmeraldBlitz/main/src/data/pokemon/level_up_learnsets/gen_7.h' 
        },
        { 
            id: 'teachable', 
            label: 'Teachable Learnsets', 
            url: 'https://raw.githubusercontent.com/FranklyNathan/EmeraldBlitz/main/src/data/pokemon/teachable_learnsets.h' 
        },
        { 
            id: 'egg', 
            label: 'Egg Moves', 
            url: 'https://raw.githubusercontent.com/FranklyNathan/EmeraldBlitz/main/src/data/pokemon/egg_moves.h' 
        }
    ];

    useEffect(() => {
        const activeUrl = tabs.find(t => t.id === activeTab)?.url;
        if (!activeUrl) return;

        setLoading(true);
        setError(null);

        fetch(activeUrl)
            .then(res => {
                if (!res.ok) throw new Error('Failed to fetch source file');
                return res.text();
            })
            .then(data => {
                setContent(data);
                setLoading(false);
            })
            .catch(err => {
                setError(err.message);
                setLoading(false);
            });
    }, [activeTab]);

    return (
        <div className="source-code-page-wrapper">
            <Header />
            <div className="source-code-header-section">
                <h1>Source Code</h1>
                <p>
                    Emerald Blitz is an <a href="https://github.com/FranklyNathan/EmeraldBlitz" target="_blank" rel="noopener noreferrer">open source game</a> that builds from the GitHub (
                    <a href="https://github.com/jpfrazz/blitz_auction_website" target="_blank" rel="noopener noreferrer">this website</a> is, too!). Below are some of the game's most useful files embedded directly from the GitHub for reference at a glance.
                </p>
            </div>
            <div className="source-code-tabs-container">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        className={`source-code-tab-btn ${activeTab === tab.id ? 'active' : ''}`}
                        onClick={() => setActiveTab(tab.id)}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>
            <div className="source-code-container">
                {loading ? (
                    <div className="source-code-status">Loading source code...</div>
                ) : error ? (
                    <div className="source-code-status error">{error}</div>
                ) : (
                    <pre className="source-code-content">
                        <code>
                            {content.split('\n').map((line, index) => (
                                <span key={index} className={line.trim().startsWith('//') ? 'source-code-comment' : ''}>
                                    {line}{'\n'}
                                </span>
                            ))}
                        </code>
                    </pre>
                )}
            </div>
        </div>
    );
};

export default SourceCodePage;