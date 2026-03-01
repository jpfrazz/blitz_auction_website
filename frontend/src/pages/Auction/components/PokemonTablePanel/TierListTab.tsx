import React from 'react';
import { Auction } from '../../../../types';
import { getUserLabel } from '../../../../shared/utils/user';
import './TierListTab.scss';

const TierListTab = () => {
  return (
    <div className="auction-tier-list">
      <img src='/tierlist.png' alt='Tier List' style={{ width: '100%', height: 'auto', display: 'block' }} />
    </div>
  );
};

export default TierListTab;
