import React from 'react';
import Header from '../../shared/components/Header';
import Footer from '../../shared/components/Footer';
import './Info.scss';

const Info = () => (
  <>
    <Header />
    <main className="info-main">
      <h1 className="info-title">
        Blitz Info
      </h1>
      <nav className="info-toc-card">
        <h2 className="info-toc-heading">Contents</h2>
        <hr />
        <ul className="info-toc-list">
          <li><a href="#heart-scale-locations">Heart Scale Locations</a></li>
          <li><a href="#type-enchancing-items">Type-enchancing items</a></li>
          <li><a href="#key-npcs">Key NPCs</a></li>
          <li><a href="#sitrus-berries">Sitrus Berries</a></li>
          <li><a href="#slateport-market-items">Slateport Market Items</a></li>
          <li><a href="#scotts-tms">Scott's TMs</a></li>
          <li><a href="#gym-benchmarks">Gym Benchmarks</a></li>
          <li><a href="#inter-gym-mechanics">Inter-Gym Mechanics</a></li>
          <li><a href="#battle-mechanics">Battle Mechanics</a></li>
          <li><a href="#ai-logic">AI Logic</a></li>
          <li><a href="#key-binds">Input Tips</a></li>
          <li><a href="#ability-reworks">Reworked Abilities</a></li>
        </ul>
      </nav>

      <section id="heart-scale-locations" className="info-section">
        <h2 className="info-question">Heart Scale Locations</h2>
        <hr />
        <p className="info-answer">
          Exchange Heart Scales at the Move Relearner to access powerful moves. Heart Scales can be found hidden in the following locations:
        </p>
        <div className="location-scale-grid">
          {/* Example images and captions. Replace filenames and captions as needed. */}
          <div className="location-scale-card">
            <img src="/HeartScaleLocations/HeartScale1.png" alt="Route 104 Heart Scale" />
            <div className="location-scale-caption">Route 104</div>
          </div>
          <div className="location-scale-card">
            <img src="/HeartScaleLocations/HeartScale2.png" alt="Route 106 Heart Scale" />
            <div className="location-scale-caption">Route 106</div>
          </div>
          <div className="location-scale-card">
            <img src="/HeartScaleLocations/HeartScale3.png" alt="Route 109 Heart Scale" />
            <div className="location-scale-caption">Route 109</div>
          </div>
          <div className="location-scale-card">
            <img src="/HeartScaleLocations/HeartScale4.png" alt="Route 109 Heart Scale" />
            <div className="location-scale-caption">Route 109</div>
          </div>
          <div className="location-scale-card">
            <img src="/HeartScaleLocations/HeartScale5.png" alt="Route 118 Heart Scale" />
            <div className="location-scale-caption">Route 118</div>
          </div>
          <div className="location-scale-card">
            <img src="/HeartScaleLocations/HeartScale6.png" alt="Route 109 Heart Scale" />
            <div className="location-scale-caption">Route 109</div>
          </div>
          <div className="location-scale-card">
            <img src="/HeartScaleLocations/HeartScale7.png" alt="Lilycove City Heart Scale" />
            <div className="location-scale-caption">Lilycove City</div>
          </div>
          <div className="location-scale-card">
            <img src="/HeartScaleLocations/HeartScale9.png" alt="Route 115 Heart Scale" />
            <div className="location-scale-caption">Route 115</div>
          </div>
          <div className="location-scale-card">
            <img src="/HeartScaleLocations/HeartScale8.png" alt="Route 105 Heart Scale" />
            <div className="location-scale-caption">Route 105</div>
          </div>
        </div>
      </section>

      <section id="type-enchancing-items" className="info-section">
        <h2 className="info-question">Type-enhancing items</h2>
        <hr />
        <p className="info-answer">
          Type-enhancing items boost damage by 20%. They can be found in the following locations:
        </p>
        <div className="location-scale-grid">
          <div className="location-scale-card">
            <img src="/TypeBoosterLocations/TypeBooster1.png" alt="Petalburg Woods Miracle Seed" />
            <div className="location-scale-caption">Petalburg Woods</div>
          </div>
          <div className="location-scale-card">
            <img src="/TypeBoosterLocations/TypeBooster2.png" alt="Dewford Town Silk Scarf" />
            <div className="location-scale-caption">Dewford Town</div>
          </div>
          <div className="location-scale-card">
            <img src="/TypeBoosterLocations/TypeBooster3.png" alt="Route 109 Soft Sand" />
            <div className="location-scale-caption">Route 109</div>
          </div>
          <div className="location-scale-card">
            <img src="/TypeBoosterLocations/TypeBooster4.png" alt="Lavaridge Herb Shop Charcoal" />
            <div className="location-scale-caption">Lavaridge Herb Shop</div>
          </div>
          <div className="location-scale-card">
            <img src="/TypeBoosterLocations/TypeBooster5.png" alt="Weather Institute Mystic Water" />
            <div className="location-scale-caption">Weather Institute</div>
          </div>
          <div className="location-scale-card">
            <img src="/TypeBoosterLocations/TypeBooster6.png" alt="Route 116 Black Glasses" />
            <div className="location-scale-caption">Route 116</div>
          </div>
          <div className="location-scale-card">
            <img src="/TypeBoosterLocations/TypeBooster7.png" alt="Shoal Cave Basement Never-Melt Ice" />
            <div className="location-scale-caption">Shoal Cave Basement</div>
          </div>
        </div>
      </section>

      <section id="key-npcs" className="info-section">
        <h2 className="info-question">Key NPCs</h2>
        <hr />
        <p className="info-answer">
          Locations of important NPCs.
        </p>

        <div className="location-scale-grid">
          <div className="location-scale-card">
            <img src="/KeyNPCLocations/KeyNPC2.png" alt="Berry Saleswoman - Route 104" />
            <div className="location-scale-caption">Berry Saleswoman - Route 104</div>
          </div>

          <div className="location-scale-card">
            <img src="/KeyNPCLocations/KeyNPC10.png" alt="Energy Guru - Slateport City" />
            <div className="location-scale-caption">Burmy Binders - Route 104</div>
          </div>

          <div className="location-scale-card">
            <img src="/KeyNPCLocations/KeyNPC1.png" alt="Status Chef - Slateport Market" />
            <div className="location-scale-caption">Status Chef - Slateport Market</div>
          </div>

          <div className="location-scale-card">
            <img src="/KeyNPCLocations/KeyNPC9.png" alt="Black Market Renter - Slateport City" />
            <div className="location-scale-caption">Black Market Renter - Slateport City</div>
          </div>

          <div className="location-scale-card">
            <img src="/KeyNPCLocations/KeyNPC7.png" alt="Time-of-Day Jump - Starting House" />
            <div className="location-scale-caption">Time Advancer - Starting House</div>
          </div>

          <div className="location-scale-card">
            <img src="/KeyNPCLocations/KeyNPC8.png" alt="Energy Guru - Slateport City" />
            <div className="location-scale-caption">Energy Guru - Slateport City</div>
          </div>

          <div className="location-scale-card">
            <img src="/KeyNPCLocations/KeyNPC3.png" alt="Move Tutor - Fallarbor Town" />
            <div className="location-scale-caption">Move Tutor - Fallarbor Town</div>
          </div>

          <div className="location-scale-card">
            <img src="/KeyNPCLocations/KeyNPC4.png" alt="Rotom Catalogs - Fortree City" />
            <div className="location-scale-caption">Rotom Catalogs - Fortree City</div>
          </div>
      
          <div className="location-scale-card">
            <img src="/KeyNPCLocations/KeyNPC5.png" alt="Substitute Tutor - Lilycove City" />
            <div className="location-scale-caption">Substitute Tutor - Lilycove City</div>
          </div>

          <div className="location-scale-card">
            <img src="/KeyNPCLocations/KeyNPC6.png" alt="Day Care - Route 117" />
            <div className="location-scale-caption">Day Care - Route 117</div>
          </div>
        </div>
      </section>

      <section id="sitrus-berries" className="info-section">
        <h2 className="info-question">Sitrus Berries</h2>
        <hr />
        <p className="info-answer">
          Sitrus Berries can't be purchased until after beating the 6th gym. In the meantime, you have access to eight of them on your way to Fortree City:
        </p>
        <div className="location-scale-grid">
          <div className="location-scale-card">
            <img src="/SitrusBerryLocations/Sitrus1.png" alt="Route 118 Sitrus Berries" />
            <div className="location-scale-caption">Route 118</div>
          </div>
          <div className="location-scale-card">
            <img src="/SitrusBerryLocations/Sitrus2.png" alt="Route 119 Sitrus Berries" />
            <div className="location-scale-caption">Route 119</div>
          </div>
          <div className="location-scale-card">
            <img src="/SitrusBerryLocations/Sitrus3.png" alt="Route 123 Sitrus Berries" />
            <div className="location-scale-caption">Route 123</div>
          </div>
        </div>
      </section>

      <section id="slateport-market-items" className="info-section">
        <h2 className="info-question">Slateport Market Items</h2>
        <hr />
        <p className="info-answer">
          The following items are available for purchase at the Slateport Market. At each badge threshold, the items below are added to the merchant's stock.
        </p>
        <h3 className="info-subheading">TMs</h3>
        <div className="slateport-market-grid tms">
          <div className="slateport-market-card">
            <div className="slateport-market-title">Badge 1 — 1000</div>
            <ul className="slateport-list">
              <li className="tm-grass">Bullet Seed</li>
              <li className="tm-ice">Icy Wind</li>
              <li className="tm-ground">Mud Shot</li>
              <li className="tm-bug">Pounce</li>
              <li className="tm-steel">Steel Wing</li>
              <li className="tm-dark">Thief</li>
              <li className="tm-dark">Taunt</li>
            </ul>
          </div>
          <div className="slateport-market-card">
            <div className="slateport-market-title">Badge 4 — 2000</div>
            <ul className="slateport-list">
              <li className="tm-fire">Sunny Day</li>
              <li className="tm-water">Rain Dance</li>
              <li className="tm-rock">Sandstorm</li>
              <li className="tm-ice">Hail</li>
              <li className="tm-psychic">Light Screen</li>
              <li className="tm-psychic">Reflect</li>
              <li className="tm-psychic">Rest</li>
              <li className="tm-psychic">Trick Room</li>
              <li className="tm-normal">Protect (4000)</li>
            </ul>
          </div>
          <div className="slateport-market-card">
            <div className="slateport-market-title">Badge 6 — 4000</div>
            <ul className="slateport-list">
              <li className="tm-ice">Blizzard</li>
              <li className="tm-fire">Fire Blast</li>
              <li className="tm-electric">Thunder</li>
              <li className="tm-grass">Solar Beam</li>
              <li className="tm-normal">Hyper Beam</li>
              <li className="tm-dark">Hone Claws (8000)</li>
            </ul>
          </div>
        </div>
        <h3 className="info-subheading">Items</h3>
        <div className="slateport-market-grid">
          <div className="slateport-market-card">
            <div className="slateport-market-title">Game Start</div>
            <details>
              <summary className='slateport-market-dropdown'>Ability Capsule</summary>
              <div className="evo-icons">
                <img src="/MiniIcons/azurill.png" alt="Azurill" />
                <img src="/MiniIcons/chewtle.png" alt="Chewtle" />
                <img src="/MiniIcons/chinchou.png" alt="Chinchou" />
                <img src="/MiniIcons/gossifleur.png" alt="Gossifleur" />
                <img src="/MiniIcons/growlithe.png" alt="Growlithe" />
                <img src="/MiniIcons/helioptile.png" alt="Helioptile" />
                <img src="/MiniIcons/litwick.png" alt="Litwick" />
                <img src="/MiniIcons/joltik.png" alt="Joltik" />
                <img src="/MiniIcons/mawile.png" alt="Mawile" />
                <img src="/MiniIcons/minccino.png" alt="Minccino" />
                <img src="/MiniIcons/mudbray.png" alt="Mudbray" />
                <img src="/MiniIcons/scatterbug.png" alt="Scatterbug" />
                <img src="/MiniIcons/shellder.png" alt="Shellder" />
                <img src="/MiniIcons/shellos.png" alt="Shellos" />
                <img src="/MiniIcons/shinx.png" alt="Shinx" />
                <img src="/MiniIcons/shroomish.png" alt="Shroomish" />
                <img src="/MiniIcons/snubbull.png" alt="Snubbull" />
                <img src="/MiniIcons/stufful.png" alt="Stufful" />
                <img src="/MiniIcons/teddiursa.png" alt="Teddiursa" />
                <img src="/MiniIcons/wattrel.png" alt="Wattrel" />
                <img src="/MiniIcons/wooper.png" alt="Wooper" />
                <img src="/MiniIcons/roggenrola.png" alt="Roggenrola" />
                <img src="/MiniIcons/wingull.png" alt="Wingull" />
                <img src="/MiniIcons/zigzagoon.png" alt="Zigzagoon" />
              </div>
              <ul>
                <li>Azurill (Huge Power)</li>
                <li>Chewtle (Strong Jaw)</li>
                <li>Chinchou (Volt Absorb)</li>
                <li>Gossifleur (Cotton Down)</li>
                <li>Growlithe (Intimidate)</li>
                <li>Helioptile (Dry Skin)</li>
                <li>Litwick (Flash Fire)</li>
                <li>Joltik (Compound Eyes)</li>
                <li>Mawile (Intimidate)</li>
                <li>Minccino (Technician)</li>
                <li>Mudbray (Stamina)</li>
                <li>Scatterbug (Compound Eyes)</li>
                <li>Shellder (Skill Link)</li>
                <li>Shellos (Storm Drain)</li>
                <li>Shinx (Intimidate)</li>
                <li>Shroomish (Poison Heal)</li>
                <li>Snubbull (Intimidate)</li>
                <li>Stufful (Fluffy)</li>
                <li>Teddiursa (Guts)</li>
                <li>Wattrel (Volt Absorb)</li>
                <li>Wooper (Water Absorb)</li>
                <li>Roggenrola (Weak Armor, Sand Stream on Gigalith)</li>
                <li>Wingull (Hydration, Drizzle on Pelipper)</li>
                <li>Zigzagoon (Gluttony, Guts on Obstagoon)</li>
              </ul>
            </details>
            <details>
              <summary className='slateport-market-dropdown'>Ability Patch</summary>
              <div className="evo-icons">
                <img src="/MiniIcons/bunnelby.png" alt="Bunnelby" />
                <img src="/MiniIcons/cacnea.png" alt="Cacnea" />
                <img src="/MiniIcons/corphish.png" alt="Corphish" />
                <img src="/MiniIcons/exeggcute.png" alt="Exeggcute" />
                <img src="/MiniIcons/froakie.png" alt="Froakie" />
                <img src="/MiniIcons/litten.png" alt="Litten" />
                <img src="/MiniIcons/meowth.png" alt="Meowth" />
                <img src="/MiniIcons/minccino.png" alt="Minccino" />
                <img src="/MiniIcons/skrelp.png" alt="Skrelp" />
                <img src="/MiniIcons/slowpoke.png" alt="Slowpoke" />
                <img src="/MiniIcons/totodile.png" alt="Totodile" />
                <img src="/MiniIcons/vulpix.png" alt="Vulpix" />
                <img src="/MiniIcons/corsola.png" alt="Corsola" />
                <img src="/MiniIcons/poliwag.png" alt="Poliwag" />
                <img src="/MiniIcons/shroomish.png" alt="Shroomish" />
              </div>
              <ul>
                <li>Bunnelby (Huge Power)</li>
                <li>Cacnea (Water Absorb)</li>
                <li>Corphish (Adaptability)</li>
                <li>Exeggcute (Harvest)</li>
                <li>Froakie (Protean)</li>
                <li>Litten (Intimidate)</li>
                <li>Meowth (Tough Claws)</li>
                <li>Minccino (Skill Link)</li>
                <li>Skrelp (Adaptability)</li>
                <li>Slowpoke (Regenerator)</li>
                <li>Totodile (Sheer Force)</li>
                <li>Vulpix (Snow Warning)</li>
                <li>Corsola (Regenerator, Perish Body on Cursola)</li>
                <li>Poliwag (Swift Swim, Drizzle on Politoed)</li>
                <li>Shroomish (Quick Feet, Technician on Breloom)</li>
              </ul>
            </details>
            <summary className='slateport-market-dropdown'>Serious Mint</summary>
          </div>
          <div className="slateport-market-card">
            <div className="slateport-market-title">Badge 2</div>
            <details>
              <summary className='slateport-market-dropdown'>Energy Guru</summary>
              <div className="evo-icons">
                <img src="/MiniIcons/aron.png" alt="Aron" />
                <img src="/MiniIcons/duskull.png" alt="Duskull" />
                <img src="/MiniIcons/frigibax.png" alt="Frigibax" />
                <img src="/MiniIcons/goomy.png" alt="Goomy" />
                <img src="/MiniIcons/hatenna.png" alt="Hatenna" />
                <img src="/MiniIcons/honedge.png" alt="Honedge" />
                <img src="/MiniIcons/horsea.png" alt="Horsea" />
                <img src="/MiniIcons/impidimp.png" alt="Impidimp" />
                <img src="/MiniIcons/jangmo-o.png" alt="Jangmo-o" />
                <img src="/MiniIcons/litwick.png" alt="Litwick" />
                <img src="/MiniIcons/solosis.png" alt="Solosis" />
                <img src="/MiniIcons/spheal.png" alt="Spheal" />
                <img src="/MiniIcons/swinub.png" alt="Swinub" />
                <img src="/MiniIcons/trapinch.png" alt="Trapinch" />
                <img src="/MiniIcons/tynamo.png" alt="Tynamo" />
              </div>
              <ul>
                <li>Aron &gt; Lairon</li>
                <li>Duskull &gt; Dusclops</li>
                <li>Frigibax &gt; Arctibax</li>
                <li>Goomy &gt; Sliggoo</li>
                <li>Hatenna &gt; Hattrem</li>
                <li>Honedge &gt; Doublade</li>
                <li>Horsea &gt; Seadra</li>
                <li>Impidimp &gt; Morgrem</li>
                <li>Jangmo-o &gt; Hakamo-o</li>
                <li>Litwick &gt; Lampent</li>
                <li>Solosis &gt; Duosion</li>
                <li>Spheal &gt; Sealeo</li>
                <li>Swinub &gt; Piloswine</li>
                <li>Trapinch &gt; Vibrava</li>
                <li>Tynamo &gt; Eelektrik</li>
              </ul>
            </details>
          </div>
          <div className="slateport-market-card">
            <div className="slateport-market-title">Badge 4</div>
            <details>
              <summary className='slateport-market-dropdown'>Energy Oracle</summary>
              <div className="evo-icons">
                <img src="/MiniIcons/amaura.png" alt="Amaura" />
                <img src="/MiniIcons/anorith.png" alt="Anorith" />
                <img src="/MiniIcons/archen.png" alt="Archen" />
                <img src="/MiniIcons/binacle.png" alt="Binacle" />
                <img src="/MiniIcons/clauncher.png" alt="Clauncher" />
                <img src="/MiniIcons/corsola-galar.png" alt="Corsola-Galar" />
                <img src="/MiniIcons/croagunk.png" alt="Croagunk" />
                <img src="/MiniIcons/elgyem.png" alt="Elgyem" />
                <img src="/MiniIcons/frillish.png" alt="Frillish" />
                <img src="/MiniIcons/meditite.png" alt="Meditite" />
                <img src="/MiniIcons/ponyta.png" alt="Ponyta" />
                <img src="/MiniIcons/rufflet.png" alt="Rufflet" />
                <img src="/MiniIcons/sandygast.png" alt="Sandygast" />
                <img src="/MiniIcons/scraggy.png" alt="Scraggy" />
                <img src="/MiniIcons/shuppet.png" alt="Shuppet" />
                <img src="/MiniIcons/skorupi.png" alt="Skorupi" />
                <img src="/MiniIcons/slowpoke.png" alt="Slowpoke" />
                <img src="/MiniIcons/snorunt.png" alt="Snorunt" />
                <img src="/MiniIcons/snover.png" alt="Snover" />
                <img src="/MiniIcons/tirtouga.png" alt="Tirtouga" />
                <img src="/MiniIcons/tyrunt.png" alt="Tyrunt" />
                <img src="/MiniIcons/varoom.png" alt="Varoom" />
                <img src="/MiniIcons/wailmer.png" alt="Wailmer" />
              </div>
              <ul>
                <li>Amaura &gt; Aurorus</li>
                <li>Anorith &gt; Armaldo</li>
                <li>Archen &gt; Archeops</li>
                <li>Binacle &gt; Barbaracle</li>
                <li>Clauncher &gt; Clawitzer</li>
                <li>Corsola-Galar &gt; Cursola</li>
                <li>Croagunk &gt; Toxicroak</li>
                <li>Elgyem &gt; Beheeyem</li>
                <li>Frillish &gt; Jellicent</li>
                <li>Meditite &gt; Medicham</li>
                <li>Ponyta &gt; Rapidash</li>
                <li>Rufflet &gt; Braviary</li>
                <li>Sandygast &gt; Palossand</li>
                <li>Scraggy &gt; Scrafty</li>
                <li>Shuppet &gt; Banette</li>
                <li>Skorupi &gt; Drapion</li>
                <li>Slowpoke &gt; Slowbro-Galar</li>
                <li>Snorunt &gt; Glalie</li>
                <li>Snover &gt; Abomasnow</li>
                <li>Tirtouga &gt; Carracosta</li>
                <li>Tyrunt &gt; Tyrantrum</li>
                <li>Varoom &gt; Revavroom</li>
                <li>Wailmer &gt; Wailord</li>
              </ul>
            </details>
            <details>
              <summary className='slateport-market-dropdown'>Fire Stone</summary>
              <ul>
                <li>Growlithe &gt; Arcanine</li>
                <li>Pansear &gt; Simisear</li>
                <li>Eevee &gt; Flareon</li>
              </ul>
            </details>
            <details>
              <summary className='slateport-market-dropdown'>Water Stone</summary>
              <ul>
                <li>Poliwhirl &gt; Poliwrath</li>
                <li>Shellder &gt; Cloyster</li>
                <li>Staryu &gt; Starmie</li>
                <li>Eevee &gt; Vaporeon</li>
              </ul>
            </details>
            <details>
              <summary className='slateport-market-dropdown'>Thunder Stone</summary>
              <ul>
                <li>Eelektrik &gt; Eelektross</li>
                <li>Magneton &gt; Magnezone</li>
                <li>Nosepass &gt; Probopass</li>
                <li>Charjabug &gt; Vikavolt</li>
                <li>Pikachu &gt; Raichu</li>
                <li>Tadbulb &gt; Bellibolt</li>
                <li>Eevee &gt; Jolteon</li>
              </ul>
            </details>
            <details>
              <summary className='slateport-market-dropdown'>Leaf Stone</summary>
              <ul>
                <li>Gloom &gt; Vileplume</li>
                <li>Cottonee &gt; Whimsicott</li>
                <li>Exeggcute &gt; Exeggutor</li>
                <li>Voltorb &gt; Electrode</li>
                <li>Eevee &gt; Leafeon</li>
              </ul>
            </details>
            <details>
              <summary className='slateport-market-dropdown'>Ice Stone</summary>
              <ul>
                <li>Cetoddle &gt; Cetitan</li>
                <li>Vulpix-Alola &gt; Ninetales-Alola</li>
                <li>Eevee &gt; Glaceon</li>
              </ul>
            </details>
            <details>
              <summary className='slateport-market-dropdown'>Moon Stone</summary>
              <ul>
                <li>Clefairy &gt; Clefable</li>
                <li>Jigglypuff &gt; Wigglytuff</li>
                <li>Eevee &gt; Umbreon</li>
              </ul>
            </details>
            <details>
              <summary className='slateport-market-dropdown'>Sun Stone</summary>
              <ul>
                <li>Gloom &gt; Bellossom</li>
                <li>Exeggcute &gt; Exeggutor-Alola</li>
                <li>Helioptile &gt; Heliolisk</li>
                <li>Pikachu &gt; Raichu-Alola</li>
                <li>Eevee &gt; Espeon</li>
              </ul>
            </details>
            <details>
              <summary className='slateport-market-dropdown'>Shiny Stone</summary>
              <ul>
                <li>Florette &gt; Florges</li>
                <li>Minccino &gt; Cinccino</li>
                <li>Togetic &gt; Togekiss</li>
                <li>Roselia &gt; Roserade</li>
                <li>Eevee &gt; Sylveon</li>
              </ul>
            </details>
            <details>
              <summary className='slateport-market-dropdown'>Dawn Stone</summary>
              <ul>
                <li>Kirlia &gt; Gallade</li>
                <li>Snorunt &gt; Froslass</li>
                <li>Charcadet &gt; Armarouge</li>
              </ul>
            </details>
            <details>
              <summary className='slateport-market-dropdown'>Dusk Stone</summary>
              <ul>
                <li>Doublade &gt; Aegislash</li>
                <li>Litwick &gt; Chandelure</li>
                <li>Misdreavus &gt; Mismagius</li>
                <li>Murkrow &gt; Honchkrow</li>
                <li>Sneasel &gt; Weavile</li>
                <li>Charcadet &gt; Ceruledge</li>
              </ul>
            </details>
            <details>
              <summary className='slateport-market-dropdown'>Dragon Scale</summary>
              <ul>
                <li>Seadra &gt; Kingdra</li>
              </ul>
            </details>
            <details>
              <summary className='slateport-market-dropdown'>King's Rock</summary>
              <ul>
                <li>Poliwhirl &gt; Politoed</li>
                <li>Slowpoke-Galar &gt; Slowking-Galar</li>
                <li>Scyther &gt; Kleavor</li>
              </ul>
            </details>
            <details>
              <summary className='slateport-market-dropdown'>Metal Coat</summary>
              <ul>
                <li>Scyther &gt; Scizor</li>
                <li>Goomy &gt; Sliggoo-Hisui</li>
              </ul>
            </details>
          </div>
          <div className="slateport-market-card">
            <div className="slateport-market-title">Badge 6</div>
            <details>
              <summary className='slateport-market-dropdown'>Linking Cord</summary>
              <div className="evo-icons">
                <img src="/MiniIcons/boldore.png" alt="Boldore" />
                <img src="/MiniIcons/dusclops.png" alt="Dusclops" />
                <img src="/MiniIcons/graveler.png" alt="Graveler" />
                <img src="/MiniIcons/gurdurr.png" alt="Gurdurr" />
                <img src="/MiniIcons/haunter.png" alt="Haunter" />
                <img src="/MiniIcons/machoke.png" alt="Machoke" />
                <img src="/MiniIcons/porygon2.png" alt="Porygon2" />
                <img src="/MiniIcons/electabuzz.png" alt="Electabuzz" />
                <img src="/MiniIcons/magmar.png" alt="Magmar" />
              </div>
              <ul>
                <li>Boldore &gt; Gigalith</li>
                <li>Dusclops &gt; Dusknoir</li>
                <li>Graveler &gt; Golem</li>
                <li>Gurdurr &gt; Conkeldurr</li>
                <li>Haunter &gt; Gengar</li>
                <li>Machoke &gt; Machamp</li>
                <li>Porygon2 &gt; Porygon-Z</li>
                <li>Electabuzz &gt; Electivire</li>
                <li>Magmar &gt; Magmortar</li>
              </ul>
            </details>
          </div>
        </div>
        <h3 className="info-subheading">Mega Stones</h3>
        <div className="slateport-market-grid">
          <div className="slateport-market-card">
            <div className="slateport-market-title">Game Start</div>
            <ul className="slateport-list">
              <li>Mawilite</li>
              <li>Sablenite</li>
            </ul>
          </div>
          <div className="slateport-market-card">
            <div className="slateport-market-title">Badge 6</div>
            <ul className="slateport-list">
              <li>Abomasite</li>
              <li>Banettite</li>
              <li>Barbaracite</li>
              <li>Cameruptite</li>
              <li>Chimechite</li>
              <li>Dragalgyite</li>
              <li>Excadillite</li>
              <li>Froslassite</li>
              <li>Glalitite</li>
              <li>Houndoominite</li>
              <li>Lopunnite</li>
              <li>Lucarionite</li>
              <li>Malamite</li>
              <li>Manectite</li>
              <li>Medichamite</li>
              <li>Meowsticite</li>
              <li>Pyroarite</li>
              <li>Raichunite X</li>
              <li>Scizorite</li>
              <li>Scraftinite</li>
              <li>Sharpedonite</li>
              <li>Starmite</li>
              <li>Steelixite</li>
            </ul>
          </div>
          <div className="slateport-market-card">
            <div className="slateport-market-title">Badge 8</div>
            <ul className="slateport-list">
              <li>Aggronite</li>
              <li>Ampharosite</li>
              <li>Baxcalibrite</li>
              <li>Blastoisinite</li>
              <li>Blazikenite</li>
              <li>Chandelurite</li>
              <li>Charizardite X</li>
              <li>Chesnaughtite</li>
              <li>Clefablite</li>
              <li>Delphoxite</li>
              <li>Feraligatrite</li>
              <li>Galladite</li>
              <li>Garchompite</li>
              <li>Gardevoirite</li>
              <li>Gengarite</li>
              <li>Greninjite</li>
              <li>Salamencite</li>
              <li>Sceptilite</li>
              <li>Scolipedite</li>
              <li>Staraptite</li>
              <li>Swampertite</li>
              <li>Venusaurite</li>
            </ul>
          </div>
        </div>
      </section>

      <section id="scotts-tms" className="info-section">
        <h2 className="info-question">Scott's TMs</h2>
        <hr />
        <p className="info-answer">
          Starting at badge 4, after defeating a gym, Scott approaches you. He offers 5 TMs for sale, chosen at random from the following pool:
        </p>
        <div className="slateport-market-grid tms">
          <div className="slateport-market-card">
            <h3 className="slateport-card-title">Pool 1</h3>
            <ul className="slateport-list">
              <li className="tm-grass">Seed Bomb</li>
              <li className="tm-fire">Fire Punch</li>
              <li className="tm-electric">Thunder Punch</li>
              <li className="tm-ice">Ice Punch</li>
              <li className="tm-water">Flip Turn</li>
              <li className="tm-bug">X Scissor</li>
              <li className="tm-rock">Rock Slide</li>
              <li className="tm-dragon">Dragon Claw</li>
              <li className="tm-steel">Iron Tail</li>
              <li className="tm-fairy">Play Rough</li>
              <li className="tm-ground">Earthquake</li>
              <li className="tm-ghost">Shadow Claw</li>
              <li className="tm-psychic">Zen Headbutt</li>
              <li className="tm-fighting">Brick Break</li>
              <li className="tm-normal">Return</li>
              <li className="tm-poison">Poison Jab</li>
              <li className="tm-dark">Crunch</li>
              <li className="tm-flying">Dual Wingbeat</li>
            </ul>
          </div>
          <div className="slateport-market-card">
            <h3 className="slateport-card-title">Pool 2</h3>
            <ul className="slateport-list">
              <li className="tm-grass">Giga Drain</li>
              <li className="tm-fire">Flamethrower</li>
              <li className="tm-electric">Thunderbolt</li>
              <li className="tm-ice">Ice Beam</li>
              <li className="tm-water">Scald</li>
              <li className="tm-bug">Bug Buzz</li>
              <li className="tm-rock">Power Gem</li>
              <li className="tm-dragon">Dragon Pulse</li>
              <li className="tm-steel">Flash Cannon</li>
              <li className="tm-fairy">Dazzling Gleam</li>
              <li className="tm-ground">Scorching Sands</li>
              <li className="tm-ghost">Shadow Ball</li>
              <li className="tm-psychic">Psychic</li>
              <li className="tm-fighting">Body Press</li>
              <li className="tm-normal">Hyper Voice</li>
              <li className="tm-poison">Sludge Bomb</li>
              <li className="tm-dark">Dark Pulse</li>
              <li className="tm-flying">Air Slash</li>
            </ul>
          </div>
        </div>
        <p className="info-answer">
          Each time Scott approaches you, he has a new, randomly chosen pool of 5 TMs to offer.
        </p>
        <p className="info-answer">
          Each TM costs $4000. In addition to TMs, for $2000, you can choose to "invert" the shop, swapping all TMs with their same-type counterpart.
        </p>
        <p className="info-answer">
          Pressing "Select" while in the shop allows you to preview the inverted TMs so that you can check which Pokémon in your party could learn them.
        </p>
        <p className="info-answer">
          If, at gym 8, there's a TM-type that you've yet to see, Scott is guaranteed to offer you a TM of that type.
        </p>
        <p className="info-answer">
          Buying a TM causes all other TMs in the shop to have their price reduced by half.
        </p>
        <p className="info-answer">
          If you steal a Pokémon, Scott will stop meeting with you to offer TMs for sale. Crime doesn't pay!
        </p>
      </section>

      <section id="gym-benchmarks" className="info-section">
        <h2 className="info-question">Gym Benchmarks</h2>
        <hr />
        <p className="info-answer">
          The Rare Candy stops leveling up your Pokémon at these thresholds. Defeating each gym leader also rewards you with the following amounts of money.
        </p>
        <div className="info-table-wrapper">
          <table className="info-table">
            <thead>
              <tr>
                <th>Gym</th>
                <th>Level Cap</th>
                <th>Money Awarded</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>Gym 1</td><td>15</td><td>3,750</td></tr>
              <tr><td>Gym 2</td><td>19</td><td>4,750</td></tr>
              <tr><td>Gym 3</td><td>24</td><td>6,000</td></tr>
              <tr><td>Gym 4</td><td>29</td><td>7,250</td></tr>
              <tr><td>Gym 5</td><td>32</td><td>8,000</td></tr>
              <tr><td>Gym 6</td><td>35</td><td>8,750</td></tr>
              <tr><td>Gym 7</td><td>42</td><td>10,500</td></tr>
              <tr><td>Gym 8</td><td>48</td><td>12,000</td></tr>
              <tr><td>Elite 4</td><td>58</td><td>-</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section id="inter-gym-mechanics" className="info-section">
        <h2 className="info-question">Inter-Gym Mechanics</h2>
        <hr />
        <p className="info-answer">
          <strong>Day Care</strong>
        </p>
        <p className="info-answer">
          The Day Care has been repurposed! Now, when you leave your Pokmeon in the Day Care and come back after earning a badge, the first move in its learnset is replaced with its egg move. Each evolution line in Emerald Blitz has one egg move. Talk to the old man out front to check what each Pokémon in your party could learn!
        </p>
        <ul>
          <li>Once you've visited Mauville City, you can fly directly to the Day Care.</li>
          <li>You can't access the Day Care until you've earned at least one badge.</li>
          <li>You can only store one Pokémon in the Day Care at a time.</li>
        </ul>
        <p className="info-answer">
          <strong>Pokémon Renting</strong>
        </p>
        <p className="info-answer">
          For the price of ¥8000, Talk to the shady man in the top left of the Slateport Market to rent a Pokémon. Once rented, you can use it for the next gym before returning it.<br />
          <br />
          After renting, when you re-enter the market with a new badge, the salesman teleports to you and reclaims your rented Pokemon. If the rented Pokémon is fainted, he scolds you thoroughly and charges you an additional ¥6000 for being so careless.<br />
          <br />
          ...Still, even if it's fainted, returning the rental Pokémon is the right thing to do. If you steal it, you'll be paying back renter NPC for the rest of your run, never able to purchase anything but berries.
        </p>
        <ul>
          <li>You can rent one Pokemon at a time.</li>
          <li>You can no longer rent Pokémon after obtaining the 7th badge.</li>
          <li>Once renter NPC chooses a Pokémon to offer to you, he'll continue to offer that same Pokémon until you rent it (it doesn't randomize each time you speak to him).</li>
          <li>Mega Stones for the eight Pokémon in the pool who can mega evolve are available for purchase in Slateport's outdoor market after you obtain the 6th gym badge.</li>
          <li>Stealing a Pokémon effectively locks you out of the Slateport outdoor market, as renter NPC will reclaim his Pokémon on entrance. Because of this, doing so by renting at the latest possible point costs ¥30,250 (the cost of the rental plus the prize money you're no longer able to spend).</li>
        </ul>
      </section>

      <section id="battle-mechanics" className="info-section">
        <h2 className="info-question">Battle Mechanics</h2>
        <hr />
        <p className="info-answer">
          Apart from a few exceptions to stay true to Hoenn and keep things balanced, Emerald Blitz uses modern battle mechanics. These include...
        </p>
        <h3 className="info-subheading"><strong>Stat Boost Cap</strong></h3>
        <ul>
          <li>A Pokemon's stat stage can never be raised beyond +1</li>
          <li>A Pokemon's stat stage can still be debuffed to -6</li>
          <li>If a Pokemon at +0 Attack uses Swords Dance, it will raise its Attack stage to +1</li>
          <li>If a Pokemon at -1 Attack uses Swords Dance, it will raise its Attack stage to +1</li>
        </ul>
        <h3 className="info-subheading"><strong>Pokemon Champions Status Mechanics</strong></h3>
        <ul>
          <li>Paralyzed Pokemon have a 12.5% chance to be fully paralyzed</li>
          <li>Frozen Pokemon have a 25% chance of thawing each turn with a three-turn cap</li>
          <li>Sleeping Pokemon always sleep for 2-3 turns</li>
        </ul>
        <h3 className="info-subheading"><strong>Sleep Clause</strong></h3>
        <ul>
          <li>During a battle, you can't put more than one of your opponent's Pokemon to sleep at a time</li>
          <li>Similarly, the opponent can't put more than one of your Pokemon to sleep at a time, and they avoid trying to</li>
        </ul>
        <h3 className="info-subheading"><strong>Modern Critical Hit Mechanics</strong></h3>
        <ul>
          <li>Critical hits deal 1.5x damage</li>
          <li>The baseline odds for a critical hit are 1/24</li>
        </ul>
        <h3 className="info-subheading"><strong>Mega Evolution</strong></h3>
        <ul>
          <li>Mega Evolution lasts three turns</li>
          <li>At the end of the three turns, a mega-evolved Pokemon reverts to its base form</li>
          <li>When a Pokemon reverts to its base form, any entrance ability (like Intimidate, Protean) does "reset" and trigger again</li>
        </ul>
        <h3 className="info-subheading"><strong>Weather</strong></h3>
        <ul>
          <li>Weather effects last for five turns</li>
          <li>Hail exists and Snow does not. Effects that would set or benefit from Snow do the same but with Hail</li>
        </ul>
        <h3 className="info-subheading"><strong>Terrain Disabled</strong></h3>
        <ul>
          <li>Effects that would set or benefit from Terrain have been modified or removed</li>
        </ul>
        <h3 className="info-subheading"><strong>Modern Abilities</strong></h3>
        <ul>
          <li>Abilities that were nerfed after their debuts, like Gale Wings and Protean, use Generation 9 mechanics</li>
        </ul>
        <h3 className="info-subheading"><strong>Invisible Stat Changes</strong></h3>
        <ul>
          <li>Badge Boost is disabled. Your Pokemon do not become more powerful depending on your badge count</li>
          <li>All EVs are set to 0</li>
        </ul>
        <h3 className="info-subheading"><strong>Item Preservation</strong></h3>
        <ul>
          <li>Non-berry held items are returned at the end of the battle if they're removed by effects like Knock Off or Fling</li>
        </ul>
      </section>

      <section id="ai-logic" className="info-section">
        <h2 className="info-question">AI Logic</h2>
        <hr />
        <p className="info-answer">
          All enemy Pokémon have Serious nature (neutral) with 31 IVs and 0 EVs in every stat.<br />
          <br />
          The AI can only heal each Pokémon a maximum of once per battle.<br />
          <br />
          <strong>The enemy AI is 50% likely to switch if...</strong>
        </p>
        <ul>
          <li>Their primary attacking type has been lowered to -3 or greater</li>
          <li>They're Leech Seeded and have an attacking stat lowered to -1 or greater</li>
          <li>They're Drowsy from Yawn</li>
        </ul>
        <p className="info-answer">
          <strong>The enemy AI is 100% likely to switch if...</strong>
        </p>
        <ul>
          <li>It's their Pokémon's final turn of Perish Song</li>
          <li>Their Pokémon has Truant and you've shown a Protect-like move</li>
          <li>Your Pokémon has Wonder Guard, their Pokémon can't hit it, and they have a different Pokémon which can hit it</li>
        </ul>
        <p className="info-answer">
          <strong>The enemy AI is 50% likely to use Self Destruct or Explosion if...</strong>
        </p>
        <ul>
          <li>The exploding Pokemon has been on the field for at least five turns</li>
          <li>Your Pokemon can be affected by Explosion (it isn't a ghost-type)</li>
        </ul>
        <p className="info-answer">
          <strong>The enemy AI will use an HP-healing item if ALL of the following are true. Its Pokémon...</strong>
        </p>
        <ul>
          <li>Hasn't already been healed (only one heal per Pokémon)</li>
          <li>Can't move first and KO yours this turn</li>
          <li>Can't be KO'd this turn after healing</li>
          <li>At least one of the following is true. Its Pokémon...
            <ul>
              <li>Is below 25% of its maximum HP, OR</li>
              <li>Has missing HP that exceeds the heal amount of the item, OR</li>
              <li>Can faint this turn and has missing HP equal to more than double the damage dealt by your best attack, OR</li>
              <li>Can faint this turn and is the final Pokémon remaining</li>
            </ul>
          </li>
        </ul>
        <p className="info-answer">
          <strong>The enemy AI will use a Full Heal if ALL of the following are true. Its Pokémon...</strong>
        </p>
        <ul>
          <li>Has a status condition</li>
          <li>Can't move first and KO yours this turn</li>
        </ul>
      </section>

      <section id="key-binds" className="info-section">
        <h2 className="info-question">Input Tips</h2>
        <hr />
        <ul>
          <li>Holding "B" on your Gameboy while riding Flygon urges him to move at 1.5x speed</li>
          <li>Pressing "L" while riding Flygon instantly opens the Fly map</li>
          <li>Pressing "Select" while viewing the overworld map instantly snaps the cursor to Slateport City</li>
          <li>Pressing "Select" while in the party menu uses the Rare Candy on the hovered Pokémon</li>
          <li>Holding "L" while in the party menu prevents Pokemon from evolving (useful for delaying evolutions)</li>
        </ul>
      </section>

      <section id="ability-reworks" className="info-section">
        <h2 className="info-question">Reworked Abilities</h2>
        <hr />
        <p className="info-answer">
          Abilities which would otherwise be useless have been reworked for Blitz. These include...
        </p>
        <ul className="info-answer">
          <li><strong>Anticipation:</strong> Raises the user's Evasiveness by 1 stage when the opposing Pokémon has a super-effective move.</li>
          <li><strong>Ball Fetch:</strong> Finds a held Sitrus Berry at the end of a boss battle.</li>
          <li><strong>Forecast:</strong> Sets weather on entry based on the first move in the Pokémon's learnset (sun for fire, rain for water, hail for ice).</li>
          <li><strong>Frisk:</strong> Steals the opponent's held item on switch in.</li>
          <li><strong>Gluttony:</strong> Consuming a berry causes the pokemon to ransack the bag, eating 2-3 additional Oran Berries.</li>
          <li><strong>Grassy Pelt:</strong> Boosts 1.5x defense in Sun, not in Grassy Terrain.</li>
          <li><strong>Honey Gather:</strong> Finds a held Sitrus Berry at the end of a boss battle.</li>
          <li><strong>Pickup:</strong> Finds a held Sitrus Berry at the end of a boss battle.</li>
          <li><strong>Run Away:</strong> Forces the user to switch out when HP drops below 1/4.</li>
          <li><strong>Seed Sower:</strong> Sets Leech Seed when an opposing attack makes contact.</li>
          <li><strong>Surge Surfer:</strong> Boosts 2x speed in Rain, not in Electric Terrain.</li>
        </ul>
      </section>
    </main>
    <Footer />
  </>
);

export default Info;