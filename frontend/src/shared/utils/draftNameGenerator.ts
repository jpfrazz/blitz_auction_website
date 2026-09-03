const ADJECTIVES = [
  "Rootin' Tootin'",
  "Smoking Hot",
  "Thought Provoking",
  "Long Awaited",
  "Highly Anticipated",
  "Awfully Peculiar",
  "Jaw Dropping",
  "Top Secret",
  "State of the Art",
  "Cutting Edge",
  "Fancy Schmancy",
  "Mystical",
  "Mysterious",
  "Incredible",
  "Breathtaking",
  "Sensational",
  "Electrifying",
  "Fiery",
  "Alluring",
  "All Too Convenient",
  "Spellbinding",
  "Damp",
  "Cute Little",
  "Celestial",
  "Shadowy",
  "Enigmatic",
  "Cosmic",
  "Mighty",
  "Phantasmal",
  "Beautiful",
  "Radiant",
  "Bodacious",
  "Clandestine",
  "Formidable",
  "Shrouded",
  "Everlasting",
  "Magnificent",
  "Dapper",
  "Enchanted",
  "Sublime",
  "Divine",
  "Ominous",
  "Fashionable",
  "Silly",
  "Ephemeral",
  "Fabled",
  "Irresistible",
  "Pretty Neat",
  "Infamous",
  "Exclusive",
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