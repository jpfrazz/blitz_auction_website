// hide-erased-species.js
// ----------------------------------------------------------------------------
// Post-load patch for Pluto's Comprehensive Pokédex.
//
// update_pokedex.py wholly removes Gmax / "-[Type]" / "-Totem" forme species
// from species.js, and the main list already iterates BattlePokedex so it shows
// them correctly as gone. The prebuilt BattleSearchIndex (search-index.js),
// however, is generated separately and still contains those entries. Without
// this patch, live search would surface erased species and produce broken pages.
//
// This wraps DexSearch.prototype.textSearch to drop any 'pokemon' result row
// whose id no longer exists in BattlePokedex. It only ever removes results, so
// it is safe with every search type (pokemon/move/ability/item filters too).
// ----------------------------------------------------------------------------

(function () {
    'use strict';
    if (!window.DexSearch || !window.DexSearch.prototype.textSearch) return;

    var originalTextSearch = window.DexSearch.prototype.textSearch;
    window.DexSearch.prototype.textSearch = function (query) {
        var results = originalTextSearch.apply(this, arguments);
        if (!results) return results;

        var kept = [];
        for (var i = 0; i < results.length; i++) {
            var row = results[i];
            if (row[0] === 'pokemon' && !(row[1] in window.BattlePokedex)) continue;
            kept.push(row);
        }
        return kept;
    };
})();