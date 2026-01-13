import React from 'react';
import Header from '../../shared/components/Header';
import Footer from '../../shared/components/Footer';
import './FAQ.scss';

const FAQ = () => (
  <>
    <Header />
    <main className="faq-main">
      <h1 className="faq-title">
        Frequently Asked Questions
      </h1>
      <nav className="faq-toc-card">
        <h2 className="faq-toc-heading">Contents</h2>
        <hr />
        <ul className="faq-toc-list">
          <li><a href="#what-is-emerald-blitz">What's Emerald Blitz?</a></li>
          <li><a href="#how-do-i-play">How do I play?</a></li>
          <li><a href="#what-are-the-rules">What are the rules?</a></li>
          <li><a href="#how-do-i-draft-with-my-friends">How do I draft with my friends?</a></li>
          <li><a href="#can-i-play-by-myself">Can I play by myself without drafting?</a></li>
          <li><a href="#whats-changed">So, what's changed from vanilla Emerald?</a></li>
          <li><a href="#what-do-the-new-items-do">What do the new items do?</a></li>
        </ul>
      </nav>

      <section id="what-is-emerald-blitz" className="faq-section">
        <h2 className="faq-question">What's Emerald Blitz?</h2>
        <hr />
        <p className="faq-answer">
          Emerald Blitz is a revamped version of Pokémon Emerald streamlined for competitive, fast-paced draft racing. Despite playing through the entire Hoenn region with a team of nine Pokemon, from first gym to Elite Four Champion, a single playthrough takes just two hours to complete. Emerald Blitz is customized with new features and quality-of-life improvements geared toward making the game as fast as possible; it's all of the good with none of the tedium.
        </p>
      </section>

      <section id="how-do-i-play" className="faq-section">
        <h2 className="faq-question">How do I play?</h2>
        <hr />
        <ol className="faq-answer">
          <li>
            Download the patch from <a href="/">here</a>.
          </li>
          <li>
            Apply the patch online using <a href="https://www.marcrobledo.com/RomPatcher.js/" target="_blank" rel="noopener noreferrer">this ROM Patcher</a>.
          </li>
          <li>
            Download a GBA emulator like <a href="https://mgba.io/downloads.html" target="_blank" rel="noopener noreferrer">mGBA</a>.
          </li>
        </ol>
        <p className="faq-answer">And you’re good to go!</p>
      </section>

      <section id="what-are-the-rules" className="faq-section">
        <h2 className="faq-question">What are the rules?</h2>
        <hr />
        <ul className="faq-answer">
          <li>
            This is a nuzlocke:
            <ul>
              <li>If a Pokemon faints, it’s dead forever.</li>
              <li>You can’t use items in battle.</li>
              <li>Battles are played on set mode (you don’t get the option to switch when you KO an opponent’s Pokemon).</li>
            </ul>
          </li>
          <li>
            Besides your starter Eevee, you can only use Pokemon you purchased at auction. They’re all in your notebook at the start of the game. You can’t catch Pokemon.
          </li>
          <li>The first player to beat the game wins.</li>
          <li>
            Pokemon can’t level up beyond the level of the next gym leader’s ace (level caps are implemented in game, so you can’t accidentally overlevel).
          </li>
          <li>
            The race begins when players leave their rooms. Any actions you take in your starting room, like withdrawing your party and hatching eggs, can be done before the race begins.
          </li>
          <li>
            Only one player per each race can use any given Eeveelution. In other words, once a player evolves their Eevee into Umbreon, no other players can use Umbreon.
          </li>
        </ul>
      </section>

      <section id="how-do-i-draft-with-my-friends" className="faq-section">
        <h2 className="faq-question">How do I draft with my friends?</h2>
        <hr />
        <ol className="faq-answer">
          <li>
            Head to <a href="/auctionsetup" target="_blank" rel="noopener noreferrer">Auction Setup</a>.
          </li>
          <li>
            The official ruleset uses the following settings:
            <ul>
              <li>Default Funds: 20,000 per player</li>
              <li>Bidding Time Limit: 10 seconds</li>
              <li>Total Pokémon: 8 * Number of players (64 for 8-player drafts)</li>
            </ul>
          </li>
          <li>Press <b>Create Auction</b>.</li>
          <li>Once you’re taken to the auction, copy the url and send it to your friends.</li>
          <li>After everyone has joined and clicked "Ready Up," the auction will begin automatically.</li>
        </ol>
      </section>

      <section id="can-i-play-by-myself" className="faq-section">
        <h2 className="faq-question">Can I play by myself without drafting?</h2>
        <hr />
        <p className="faq-answer">
          Yes! The notebook includes a "Random" option at the bottom of its list. Choose this option eight times to generate yourself a random team of Pokémon, then get racing!
        </p>
      </section>

      <section id="whats-changed" className="faq-section">
        <h2 className="faq-question">So, what's changed from vanilla Emerald?</h2>
        <hr />
        <div className="faq-answer">
          <h3>Roguelike Randomization</h3>
          <ul>
            <li>
              <b>Randomized Gyms:</b> Gyms are randomized; upon entering a gym, you'll be warped to any of Hoenn's eight gyms at random. Leader teams are adjusted to your current strength.
            </li>
            <li>
              <b>Elite... eight!?</b> Battle Frontier Brains join the Elite Four for a more diverse lineup of final bosses.
            </li>
          </ul>

          <h3>Quality of Life Improvements</h3>
          <ul>
            <li>
              <b>Pokemon Catalog:</b> The notebook on the player's desk now comes stocked with every Pokémon in the draft. Simply scroll through, select your Pokemon, and get racing.
            </li>
            <li>
              <b>Permanent Repel:</b> The Cleanse Tag now functions as a toggleable permanent repel.
            </li>
            <li>
              <b>Portable PC:</b> A PC in your bag, accessible from anywhere besides the Elite Four chambers.
            </li>
            <li>
              <b>Med Kit:</b> A key item Pokecenter in your bag, automatically registered when you enter the Elite Four.
            </li>
            <li>
              <b>Visible IVs:</b> When paused to view your Pokémon’s stats, press A to display their IVs.
            </li>
          </ul>

          <h3>Built for Speed</h3>
          <ul>
            <li>
              <b>Level Cap Candy:</b> Instantly jumps your Pokémon to the level it next learns a move, evolves, or hits the current cap (whichever of the three comes first). The evolution animation is shortened. Asking to learn a move only asks once, not twice.
            </li>
            <li>
              <b>Flygon Bike:</b> Flygon replaces the bike, able to hop up ledges, move over shallow water, leap over rocks and trees, and Fly with the press of a button.
            </li>
            <li>
              <b>Just the Good Stuff:</b> All plot, including all events involving Team Aqua and Magma, Steven, Wally, and Scott have been removed.
            </li>
            <li>
              <b>Polite Trainers:</b> Ordinary trainers no longer challenge any player they see. They can still be fought, however, if you interact with them.
            </li>
          </ul>

          <h3>Difficulty Boosts</h3>
          <ul>
            <li>
              <b>Nuzlocke Mechanics:</b> Your Pokémon can’t overlevel the most powerful Pokémon of the next major boss trainer. You can’t use items in battle.
            </li>
            <li>
              <b>Stat Boosting Cap:</b> While a Pokemon’s stats can still be debuffed to -6, a Pokemon’s stat stage can never be raised beyond +1. You’ll need to rely on more creative strategies than Dragon Dance sweeps to take down these bosses.
            </li>
            <li>
              <b>Updated Teams:</b> Gym leaders use more well-rounded teams, having bolstered their rosters with new Alolan, Hisuian, and Galarian members.
            </li>
            <li>
              <b>New Boss Fights:</b> The Elite Four champion is now Steven Stone wielding a Mega Metagross. Wallace, meanwhile, now joins Juan to make the 8th gym a double battle. Additionally, Viola is vacationing from Kalos to give Hoenn some bug representation.
            </li>
            <li>
              <b>Buffed Battles:</b> All enemy trainers use perfect 31-IV Pokémon.
            </li>
          </ul>

          <h3>Reworked Shop</h3>
          <ul>
            <li>
              <b>Fixed Money Supply:</b> Players are no longer able to sell items, and non-boss battles no longer award money. The player has 62,000 to spend, and every purchase has an opportunity cost.
            </li>
            <li>
              <b>Slateport Outdoor Market:</b> Most relevant items, including evolution stones, mega stones, power TMs, and ability-changing items are available for purchase in the Slateport outdoor market.
            </li>
            <li>
              <b>Purchasable Berries:</b> All easily accessible berries are available for sale in the Pretty Petal Flower Shop.
            </li>
          </ul>

          <h3>Modern Mechanics</h3>
          <ul>
            <li>
              <b>Mega Evolution:</b> Mega Stones are here! Click Fight in battle and then press Start before selecting your move to mega evolve. Mega-evolved Pokemon revert to their base form after three turns.
            </li>
            <li>
              <b>Fairy Types:</b> Fairy Type has been added to the game. Pokémon have had their typing and learnsets updated to generation VII.
            </li>
            <li>
              <b>Generation IX Pokémon:</b> The auction pool includes Pokémon and items all the way up to additions from Legends ZA.
            </li>
            <li>
              <b>Physical/Special Split:</b> Moves calculate damage based on the split introduced in generation IV.
            </li>
            <li>
              <b>New TMs:</b> TMs from generation 6 including Hone Claws, Dazzling Gleam, X-Scissor, and Trick Room help even out coverage for your team.
            </li>
          </ul>

          <h3>New Unique Tools</h3>
          <ul>
            <li>
              <b>Milk Drink:</b> Skiddo and Mareep’s Milk Drink can now be used in the overworld to increase a Pokemon’s level by one, ignoring the level cap. Choose carefully--you can only use it once!
            </li>
            <li>
              <b>Forecast:</b> Castform’s Forecast ability now sets rain, sun or hail depending on the type of the first move in its movelist.
            </li>
            <li>
              <b>Last Respects:</b> Last Respects’ power is now determined by how many deaths you’ve had over the course of your run, gaining 15 Base Power each time a Pokemon faints. Your Houndstone only grows more powerful as its allies fall.
            </li>
            <li>
              <b>Seed Sower:</b> Arboliva’s signature ability now sets Leech Seed when another Pokemon’s attack makes contact with it.
            </li>
            <li>
              <b>Undead Corsola:</b> Upon fainting, Corsola revives at the end of the battle as Galarian Corsola.
            </li>
            <li>
              <b>Applin Evolution:</b> Applin’s split evolution path is now determined by what gym you reach first: Fortree for Flapple, Lavaridge for Appletun, and Rustboro for Dipplin.
            </li>
            <li>
              <b>Sketch:</b> Smeargle’s signature move can now be used from the party menu to learn one of four powerful, randomly selected moves.
            </li>
            <li>
              <b>Run Away:</b> Eevee’s ability Run Away now functions like Emergency Exit when dropped below 1/4th HP, allowing it to switch out and stay safe when things get hairy.
            </li>
            <li>
              ...And many more!
            </li>
          </ul>
        </div>
      </section>

      <section id="what-do-the-new-items-do" className="faq-section">
        <h2 className="faq-question">What do the new items do?</h2>
        <hr />
        <div className="faq-answer">
          <ul>
            <li>
              <b>Birch’s Flygon:</b> Replaces the bike, able to hop up ledges, move over shallow water, leap over rocks and trees, accelerate to 1.5x speed by holding B, and Fly by pressing L. Comes registered (press Select to mount).
            </li>
            <li>
              <b>Cleanse Tag:</b> Now functions as a permanent, toggleable repel. Comes turned on.
            </li>
            <li>
              <b>Med Kit:</b> Key item which heals all Pokémon in your party to full health and restores PP. Does not heal status (so as not to interfere with Guts, Quick Feet, Poison Heal, etc.). To heal status, use the new "Heal" command in the menu.
            </li>
            <li>
              <b>Portable PC:</b> Gives access to the PC anywhere, anytime... besides in the Elite Four.
            </li>
            <li>
              <b>Rotom Catalog:</b> A consumable item that changes Rotom’s form. You’re gifted three by an NPC in the Fortree City furniture store.
            </li>
          </ul>
        </div>
      </section>
    </main>
    <Footer />
  </>
);

export default FAQ;