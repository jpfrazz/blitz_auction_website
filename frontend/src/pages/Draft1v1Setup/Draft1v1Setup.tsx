import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../shared/components/Header';
import Footer from '../../shared/components/Footer';
import { createDraft, CreateDraftRequest } from '../../shared/api/draft';
import '../AuctionSetup/AuctionSetup.scss';

const Draft1v1Setup = () => (
  <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
    <Header />
    <main className="auction-setup-main">
      <Draft1v1SetupForm />
    </main>
    <Footer />
  </div>
);

const Draft1v1SetupForm: React.FC = () => {
  const navigate = useNavigate();
  const [draftName, setDraftName] = useState('');
  const [password, setPassword] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!draftName.trim()) {
      setSubmitError('Please enter a draft name.');
      return;
    }

    const data: CreateDraftRequest = {
      num_teams: 2,
      starting_money: 20000,
      draft_name: draftName.trim(),
      ranked: false,
      password: password.trim() || null,
      excluded_pokemon: [],
      num_auctions: 30,
      auction_length: 10,
      draft_type: '1v1',
    };

    try {
      const draftId = await createDraft(data);
      navigate(`/Draft1v1?${draftId}`);
    } catch (err: any) {
      const errorMessage = err.response?.data || err.message || 'Failed to create 1v1 draft.';
      setSubmitError(typeof errorMessage === 'string' ? errorMessage : 'Failed to create 1v1 draft.');
    }
  };

  return (
    <div className="auction-setup-card">
      <h2 className="auction-setup-title">1v1 Draft Setup</h2>
      <form className="auction-setup-form" onSubmit={handleSubmit} autoComplete="off">
        {submitError && <div style={{ color: 'red', marginBottom: 8 }}>{submitError}</div>}
        <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
          <div className="auction-setup-field" style={{ flex: 1 }}>
            <label className="auction-setup-label">
              Draft Name:
              <input
                className="auction-setup-input"
                type="text"
                name="draft-name"
                autoComplete="off"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                required
              />
            </label>
          </div>
          <div className="auction-setup-field" style={{ flex: 1 }}>
            <label className="auction-setup-label">
              Password (optional):
              <input
                className="auction-setup-input"
                type="password"
                name="draft-password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          </div>
        </div>
        <div className="auction-setup-field auction-setup-btn-row">
          <button type="submit" className="auction-setup-btn navButton">
            Create 1v1 Draft
          </button>
        </div>
      </form>
    </div>
  );
};

export default Draft1v1Setup;
