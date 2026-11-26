import React, { useState } from 'react';
import Header from '../../shared/components/Header';
import Footer from '../../shared/components/Footer';
import { AuctionSetupForm, AuctionSetupTip } from '../AuctionSetup/AuctionSetup';
import { BoosterSetupForm } from '../BoosterSetup/BoosterSetup';
import { Draft1v1SetupForm } from '../Draft1v1Setup/Draft1v1Setup';
import '../AuctionSetup/AuctionSetup.scss';
import '../Draft1v1Setup/Draft1v1Setup.scss';
import './DraftSetup.scss';

type DraftType = 'auction' | 'booster' | 'oneVOne';

const DRAFT_TYPES: { key: DraftType; label: string; recommendation: string }[] = [
  { key: 'auction', label: 'Auction', recommendation: '5+ players' },
  { key: 'booster', label: 'Booster', recommendation: '3-4 players' },
  { key: 'oneVOne', label: '1v1', recommendation: '2 players' },
];

const DRAFT_FORMS: Record<DraftType, React.ReactNode> = {
  auction: <AuctionSetupForm />,
  booster: <BoosterSetupForm />,
  oneVOne: <Draft1v1SetupForm />,
};

const DraftSetup: React.FC = () => {
  const [draftType, setDraftType] = useState<DraftType>('auction');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Header />
      <main className="auction-setup-main draft-setup-main">
        <div className="auction-setup-card">
          <h2 className="auction-setup-title">Draft Setup</h2>
          <div className="auction-setup-form">
            <div className="pool-size-options draft-type-options" role="group">
              {DRAFT_TYPES.map((type) => (
                <button
                  key={type.key}
                  type="button"
                  aria-pressed={draftType === type.key}
                  className={draftType === type.key ? 'selected' : ''}
                  onClick={() => setDraftType(type.key)}
                >
                  <span>{type.label}</span>
                  <span className="draft-type-recommendation">{type.recommendation}</span>
                </button>
              ))}
            </div>
            <div className="draft-setup-form-slot" key={draftType}>
              {DRAFT_FORMS[draftType]}
            </div>
          </div>
        </div>
        {draftType === 'auction' && <AuctionSetupTip />}
      </main>
      <Footer />
    </div>
  );
};

export default DraftSetup;
