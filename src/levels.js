// レベル定義。
//
// レベル1から無限に続く。同じレベルなら、どの端末でも必ず同じ譜面が出る
// （レベル番号 -> シード -> 決定論的な生成、という一本道になっている）。
//
// レベルが上がるにつれて変わるもの:
//   盤面   4×4 から 1 マスずつ広がり、レベル26で 12×12 に到達（上限）
//   ブロック  テトロミノ -> 2個つなぎ -> 3個つなぎ。レベル46以降は全部3個つなぎ
//   色数   小さい盤面は3色。広がるにつれて6色まで増える
//
// 「1手で消えるブロック群」を逆順に積み上げる生成方式は変わらないので、
// どのレベルでも「必ず全消しできること」は構造的に保証されたままになる。

import { TETROMINOES, makeCompoundShape, rotationsOfShape } from './shapes.js';
import { makeRng, hashSeed } from './rng.js';

export const MIN_SIZE = 4;
export const MAX_SIZE = 12;

/** このレベルに達したら盤面が 1 マス広がる（4×4 から 12×12 まで 9 段階） */
const SIZE_UPS = [1, 3, 5, 7, 10, 13, 17, 21, 26];

/** 形状が最も複雑になる（＝全部3個つなぎになる）レベル */
export const MAX_COMPLEXITY_LEVEL = 46;

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** 数値でない・1未満のレベル指定はレベル1として扱う */
export function normalizeLevel(level) {
  const n = Math.floor(Number(level));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/** レベル -> 盤面サイズ */
export function boardSizeForLevel(level) {
  const lv = normalizeLevel(level);
  let size = MIN_SIZE - 1;
  for (const up of SIZE_UPS) if (lv >= up) size++;
  return Math.min(MAX_SIZE, size);
}

/**
 * レベル -> ブロックの複雑さの配合。
 *   single = テトロミノそのまま（4セル）
 *   double = テトロミノ2個つなぎ（8セル）
 *   triple = テトロミノ3個つなぎ（12セル）
 */
export function shapeMixForLevel(level) {
  const lv = normalizeLevel(level);
  const single = clamp01(1 - (lv - 12) / 12); // L12 まで 1.0、L24 で 0
  const triple = clamp01((lv - 26) / 20);     // L26 から出現、L46 で 1.0
  const double = clamp01(1 - single - triple);
  return { single, double, triple };
}

/** レベル -> 生成シード。この一本道が「どの端末でも同じ譜面」を担保する */
export function levelSeed(level) {
  return hashSeed(`slidepop/level/${normalizeLevel(level)}`);
}

/** レベルの各種パラメータ */
export function levelConfig(level) {
  const lv = normalizeLevel(level);
  const size = boardSizeForLevel(lv);
  const mix = shapeMixForLevel(lv);
  const area = size * size;

  // 1ブロックあたりの平均セル数（4 / 8 / 12 の加重平均）
  const avgPiece = 4 * (mix.single + 2 * mix.double + 3 * mix.triple);
  const maxPiece = 4 * (mix.triple > 0 ? 3 : mix.double > 0 ? 2 : 1);

  // 大きいブロックほど詰めにくい（同色非隣接の制約が効くので実際に頭打ちになる）。
  // 到達できない目標を掲げると生成が延々とリトライして遅くなるだけなので、
  // 実測できる上限に沿って下げる: 4セル=80% / 8セル=74% / 12セル=68%
  const fill = 0.80 - 0.06 * (avgPiece / 4 - 1);
  const targetCells = Math.round(area * fill);

  // 上級では「1手でまとめて消える数」を増やして橋渡しを難しくする
  const hard = clamp01((lv - MAX_COMPLEXITY_LEVEL) / 40);
  const bigPiece = clamp01((avgPiece - 4) / 8);
  const partnerWeights = [
    0.45 + 0.35 * bigPiece - 0.15 * hard,
    0.40 - 0.25 * bigPiece + 0.05 * hard,
    0.15 - 0.10 * bigPiece + 0.10 * hard,
  ].map((w) => Math.max(0, w));

  return {
    level: lv,
    size,
    mix,
    avgPiece,
    maxPiece,
    colors: Math.max(3, Math.min(6, 3 + Math.floor((size - 4) / 2))),
    targetCells,
    minCells: Math.max(2 * maxPiece, Math.round(area * 0.42)),
    acceptSlack: maxPiece + 2,
    /** 大きいブロックは 1 回の試行が重いので、リトライ回数を抑える */
    attempts: avgPiece >= 10 ? 9 : avgPiece >= 8 ? 14 : 24,
    maxSteps: Math.ceil(targetCells / (2 * avgPiece)) + 4,
    minPar: size <= 6 ? 1 : size <= 9 ? 3 : 4,
    partnerWeights,
    /** 1 クラスあたり何種類の連結ピースを用意するか */
    poolSize: 6,
  };
}

/**
 * レベルのブロック集合を作る。
 * 「素のテトロミノ」「2個つなぎ」「3個つなぎ」をそれぞれ 1 クラスとし、
 * 配合比を重みとして返す。生成器は 1 ステップごとにクラスを抽選して使う。
 */
export function buildLevelClasses(config) {
  const rng = makeRng((levelSeed(config.level) ^ 0x5bf03635) >>> 0);
  const classes = [];

  if (config.mix.single > 0.001) {
    classes.push({ kind: 'single', parts: 1, weight: config.mix.single, shapes: TETROMINOES });
  }

  for (const [kind, parts] of [['double', 2], ['triple', 3]]) {
    const weight = config.mix[kind];
    if (weight <= 0.001) continue;
    const shapes = [];
    const seen = new Set();
    for (let i = 0; i < config.poolSize * 6 && shapes.length < config.poolSize * 4; i++) {
      const shape = makeCompoundShape(rng, parts, config.size - 1);
      if (!shape) continue;
      for (const rot of rotationsOfShape(shape)) {
        const key = rot.cells.map(([x, y]) => `${x},${y}`).join(' ');
        if (seen.has(key)) continue;
        seen.add(key);
        shapes.push(rot);
      }
    }
    if (shapes.length > 0) classes.push({ kind, parts, weight, shapes });
  }

  // 万一どのクラスも作れなければテトロミノに落とす
  if (classes.length === 0) {
    classes.push({ kind: 'single', parts: 1, weight: 1, shapes: TETROMINOES });
  }
  return classes;
}

/** レベルの見出し文（実際に出てくる可能性が高いブロックだけを挙げる） */
export function levelFlavor(config) {
  const { mix } = config;
  const parts = [];
  if (mix.single >= 0.15) parts.push('テトロミノ');
  if (mix.double >= 0.15) parts.push('2個つなぎ');
  if (mix.triple >= 0.15) parts.push('3個つなぎ');
  if (parts.length === 0) parts.push(mix.triple >= mix.double ? '3個つなぎ' : '2個つなぎ');
  return parts.join('＋');
}
