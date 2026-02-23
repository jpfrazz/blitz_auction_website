import React from 'react';
import { Auction } from '../../../../types';
import { getUserLabel } from '../../../../shared/utils/user';
import './TierListTab.scss';

const TierListTab = () => {
  return (
    <div className="auction-tier-list">
      <img src='/tierlist.png' alt='Tier List'></img>
    </div>
  );
};

export default TierListTab;
