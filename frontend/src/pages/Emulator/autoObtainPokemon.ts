import React, { useEffect, useState } from 'react';
import { SPECIES_BY_ID } from '../../utils/speciesIdMap';
import { MAP_NAMES } from '../Auction/mapNames';
import { LIVE_WARP_EWRAM_BASE_OFFSET } from '../../utils/parseSaveFile';

// Mirrors struct AutoObtainRequest in the ROM (include/script_menu.h), which the
// game reads at 0x0203F100 (EWRAM base + 0x3f100).
const AUTO_OBTAIN_EWRAM_OFFSET = 0x3f100;
const AUTO_OBTAIN_MAGIC = 0xb17a;
const AUTO_OBTAIN_MAX_MONS = 12;
export const AUTO_OBTAIN_EGG_ID = 0xffff;

const SETTING_KEY = 'blitz_auto_obtain_pokemon';
const POLL_MS = 100;
const SCAN_MAX_BYTES = 32 * 1024 * 1024;

export function useAutoObtainSetting(): [boolean, (v: boolean) => void] {
  const [enabled, setEnabled] = useState<boolean>(() => readSetting());
  const update = (v: boolean) => {
    setEnabled(v);
    try {
      localStorage.setItem(SETTING_KEY, String(v));
    } catch { /* storage unavailable */ }
  };
  useEffect(() => {
    const onChange = () => setEnabled(readSetting());
    window.addEventListener('eb-settings-changed', onChange);
    return () => window.removeEventListener('eb-settings-changed', onChange);
  }, []);
  return [enabled, update];
}

const readSetting = (): boolean => {
  try {
    return localStorage.getItem(SETTING_KEY) === 'true';
  } catch {
    return false;
  }
};

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, '-')
    .replace(/^-+|-+$/g, '');

const DEX_BY_NAME = new Map<string, number>();
const DEX_BY_PREFIX = new Map<string, number>();
for (const id of Object.keys(SPECIES_BY_ID).map(Number).sort((a, b) => a - b)) {
  const info = SPECIES_BY_ID[id];
  if (info.name === 'Egg') continue;
  const key = norm(info.name);
  if (!DEX_BY_NAME.has(key)) DEX_BY_NAME.set(key, info.baseId);
  const base = key.split('-')[0];
  if (!DEX_BY_PREFIX.has(base)) DEX_BY_PREFIX.set(base, info.baseId);
}

interface DraftedMon {
  name: string;
  pokedex_id?: number;
  form?: string | null;
}

// National dex numbers (the ROM matches its notebook list on these), or AUTO_OBTAIN_EGG_ID for the Mystery Egg.
export function toAutoObtainDexNums(pokemon: DraftedMon[]): number[] {
  const out: number[] = [];
  for (const mon of pokemon) {
    const name = norm(mon.name);
    if (name === 'egg' || name === 'mystery egg') {
      out.push(AUTO_OBTAIN_EGG_ID);
      continue;
    }
    if (name === 'plusle and minun') {
      out.push(DEX_BY_NAME.get('plusle')!);
      continue;
    }
    const withForm = mon.form ? DEX_BY_NAME.get(norm(`${mon.name}-${mon.form}`)) : undefined;
    const dex = withForm ?? DEX_BY_NAME.get(name) ?? DEX_BY_PREFIX.get(name) ?? mon.pokedex_id;
    if (dex) out.push(dex);
  }
  return out.slice(0, AUTO_OBTAIN_MAX_MONS);
}

function findEwramBase(heap: Uint8Array): number | null {
  const endLimit = Math.min(heap.length - LIVE_WARP_EWRAM_BASE_OFFSET, SCAN_MAX_BYTES);
  const view = new DataView(heap.buffer, heap.byteOffset, heap.byteLength);

  for (let base = 0; base <= endLimit; base += 4) {
    const off = base + LIVE_WARP_EWRAM_BASE_OFFSET;
    // Fast byte check for LIVE_WARP_MAGIC (0xEA5A -> LE: 0x5a, 0xea)
    if (heap[off] !== 0x5a || heap[off + 1] !== 0xea) continue;
    // Check sequence > 0 (LiveWarp sequence counter at offset +12)
    if (view.getUint32(off + 12, true) === 0) continue;
    // Validate map coordinates against known map names to prevent false positives
    const mapGroup = view.getInt8(off + 2);
    const mapNum = view.getInt8(off + 3);
    if (mapGroup < 0 || mapNum < 0) continue;
    if (typeof MAP_NAMES[mapGroup]?.[mapNum] !== 'string') continue;

    return base;
  }
  return null;
}

// Writes the drafted team into the ROM's request buffer once EWRAM is active.
// The game consumes it when the starter is obtained and clears the magic word.
export function useAutoObtainInjector(
  enabled: boolean,
  dexNums: number[],
  sharedEwramBaseRef?: React.MutableRefObject<number | null>
) {
  const dexKey = dexNums.join(',');

  useEffect(() => {
    if (!enabled || dexNums.length === 0) {
      return;
    }

    let discoveredBase: number | null = sharedEwramBaseRef?.current ?? null;
    let hasWritten = false;

    const timer = setInterval(() => {
      const heap = window.EJS_emulator?.gameManager?.Module?.HEAPU8;
      if (!heap) return;

      if (discoveredBase === null) {
        if (sharedEwramBaseRef?.current != null) {
          discoveredBase = sharedEwramBaseRef.current;
        } else {
          discoveredBase = findEwramBase(heap);
          if (discoveredBase !== null && sharedEwramBaseRef) {
            sharedEwramBaseRef.current = discoveredBase;
          }
        }
        if (discoveredBase === null) return;
      }

      const off = discoveredBase + AUTO_OBTAIN_EWRAM_OFFSET;
      if (off < 0 || off + 4 + AUTO_OBTAIN_MAX_MONS * 2 > heap.length) return;

      const view = new DataView(heap.buffer, heap.byteOffset, heap.byteLength);
      const currentMagic = view.getUint16(off, true);

      // If we previously wrote magic and the game cleared it to 0, it has been consumed!
      if (hasWritten && currentMagic === 0) {
        clearInterval(timer);
        return;
      }

      // If the request isn't in memory yet, write it
      if (!hasWritten || currentMagic !== AUTO_OBTAIN_MAGIC) {
        for (let i = 0; i < AUTO_OBTAIN_MAX_MONS; i++) {
          view.setUint16(off + 4 + i * 2, dexNums[i] ?? 0, true);
        }
        view.setUint16(off + 2, dexNums.length, true);
        view.setUint16(off, AUTO_OBTAIN_MAGIC, true);
        hasWritten = true;
      }
    }, POLL_MS);

    return () => {
      clearInterval(timer);
    };
  }, [enabled, dexKey, sharedEwramBaseRef]);
}
