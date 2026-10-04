const ADJECTIVES = [
"All Too Convenient",
"Alluring",
"Awfully Peculiar",
"Beautiful",
"Bodacious",
"Breathtaking",
"Celestial",
"Clandestine",
"Cosmic",
"Cunning",
"Cute Little",
"Cutting Edge",
"Damp",
"Dapper",
"Divine",
"Electrifying",
"Enchanted",
"Enigmatic",
"Ephemeral",
"Everlasting",
"Exclusive",
"Fabled",
"Fancy Schmancy",
"Fashionable",
"Fiery",
"Formidable",
"Funky Fresh",
"Highly Anticipated",
"Incredible",
"Infamous",
"Irresistible",
"Jaw Dropping",
"Long Awaited",
"Magnificent",
"Mighty",
"Mysterious",
"Mystical",
"Ominous",
"Phantasmal",
"Pretty Neat",
"Radiant",
"Rootin' Tootin'",
"Sensational",
"Shadowy",
"Shrouded",
"Silly",
"Smoking Hot",
"Spellbinding",
"State of the Art",
"Sublime",
"Thought Provoking",
"Top Secret",
"Wiggly",
];

const NOUNS = ["Lobby", "Waiting Room", "Draft"];

function isValidPokemonName(name: string): boolean {
  if (name.length > 12) return false;
  const lower = name.toLowerCase();
  if (lower.includes('mega')) return false;
  if (lower.includes('gigantamax')) return false;
  return true;
}

export function generateRandomDraftName(pokemonNames: string[]): string {
  const validNames = pokemonNames.filter(isValidPokemonName);
  if (validNames.length === 0) {
    return "Pikachu's Mystical Lobby";
  }

  const randomPokemon =
    validNames[Math.floor(Math.random() * validNames.length)];
  const randomAdjective =
    ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const randomNoun = NOUNS[Math.floor(Math.random() * NOUNS.length)];

  return `${randomPokemon}'s ${randomAdjective} ${randomNoun}`;
}