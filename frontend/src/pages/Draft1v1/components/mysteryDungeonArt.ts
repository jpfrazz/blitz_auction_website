import { Pokemon } from '../../../types';

const ROOT = 'https://raw.githubusercontent.com/PMDCollab/SpriteCollab/master';

interface PortraitNode {
  name: string;
  portrait_files: Record<string, boolean>;
  portrait_credit: { primary: string; secondary: string[] };
  subgroups: Record<string, PortraitNode>;
}

interface PortraitMetadata {
  tracker: Record<string, PortraitNode>;
  names: Map<string, string>;
}

export interface MysteryDungeonPortrait {
  url: string;
  credits: string[];
  source: string;
}

let metadataPromise: Promise<PortraitMetadata> | undefined;

export function loadPortraitMetadata(): Promise<PortraitMetadata> {
  if (!metadataPromise) {
    metadataPromise = Promise.all([
      fetch(`${ROOT}/tracker.json`).then((response) => {
        if (!response.ok) throw new Error('Portrait metadata unavailable');
        return response.json() as Promise<Record<string, PortraitNode>>;
      }),
      fetch(`${ROOT}/credit_names.txt`).then((response) => {
        if (!response.ok) throw new Error('Portrait credits unavailable');
        return response.text();
      }),
    ]).then(([tracker, text]) => {
      const names = new Map<string, string>();
      text.split(/\r?\n/).slice(1).forEach((line) => {
        const [name, id] = line.split('\t');
        if (id) names.set(id, name || id);
      });
      return { tracker, names };
    }).catch((error) => {
      metadataPromise = undefined;
      throw error;
    });
  }
  return metadataPromise;
}

export function getMysteryDungeonPortrait(pokemon: Pokemon, metadata: PortraitMetadata, banned = false): MysteryDungeonPortrait | null {
  const dexId = pokemon.pokedex_id ?? pokemon.id;
  if (!Number.isInteger(dexId) || dexId < 1) return null;
  const dex = String(dexId).padStart(4, '0');
  let node = metadata.tracker[dex];
  if (!node) return null;
  let path = dex;
  const form = (pokemon.form || '').trim().toLowerCase();
  if (form && form !== 'base' && form !== 'normal') {
    const match = Object.entries(node.subgroups || {}).find(([, subgroup]) => subgroup.name.toLowerCase() === form);
    if (!match) return null;
    path += `/${match[0]}`;
    node = match[1];
  }
  if (!node.portrait_files || !Object.prototype.hasOwnProperty.call(node.portrait_files, 'Normal')) return null;
  const expression = banned && Object.prototype.hasOwnProperty.call(node.portrait_files, 'Dizzy') ? 'Dizzy' : 'Normal';
  const authors = [node.portrait_credit?.primary, ...(node.portrait_credit?.secondary || [])].filter(Boolean);
  if (!authors.length) return null;
  return {
    url: `${ROOT}/portrait/${path}/${expression}.png`,
    credits: authors.map((author) => metadata.names.get(author) || author),
    source: `https://sprites.pmdcollab.org/#/${dex}`,
  };
}