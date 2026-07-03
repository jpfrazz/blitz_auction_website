import React from 'react';
import Header from '../../shared/components/Header';
import './ComprehensivePokedex.scss';

const ComprehensivePokedex: React.FC = () => {
  return (
    <>
      <Header />
      <main className="comprehensive-pokedex-main">
        <iframe
          src="/ComprehensiveDex/"
          title="Comprehensive Pokédex"
          className="comprehensive-pokedex-frame"
        />
      </main>
    </>
  );
};

export default ComprehensivePokedex;
