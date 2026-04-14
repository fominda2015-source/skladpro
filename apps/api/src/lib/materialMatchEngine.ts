import type { Material, MaterialSynonym } from "@prisma/client";
import { jaccardTokens, normalizeMaterialName, tokenizeNormalized } from "./materialNormalize.js";

export type MaterialMatchType = "exact_name" | "sku" | "alias" | "fuzzy" | "none";

export type IncomingMaterialMatch = {
  matched: boolean;
  materialId?: string;
  confidence: number;
  matchType: MaterialMatchType;
  suggestedMaterialId?: string;
};

type MatRow = Pick<Material, "id" | "name" | "sku"> & { synonyms: Pick<MaterialSynonym, "value">[] };

export function matchIncomingMaterial(
  rawName: string,
  materials: MatRow[],
  opts?: { article?: string | null }
): IncomingMaterialMatch {
  const norm = normalizeMaterialName(rawName);
  const tokens = tokenizeNormalized(norm);
  if (!norm && !opts?.article?.trim()) {
    return { matched: false, confidence: 0, matchType: "none" };
  }

  const article = opts?.article?.trim().toLowerCase();
  if (article) {
    const bySku = materials.find((m) => m.sku?.trim().toLowerCase() === article);
    if (bySku) {
      return {
        matched: true,
        materialId: bySku.id,
        confidence: 1,
        matchType: "sku",
        suggestedMaterialId: bySku.id
      };
    }
  }

  let best: { id: string; score: number; type: MaterialMatchType } | null = null;

  for (const m of materials) {
    const mNorm = normalizeMaterialName(m.name);
    if (norm && mNorm === norm) {
      return {
        matched: true,
        materialId: m.id,
        confidence: 1,
        matchType: "exact_name",
        suggestedMaterialId: m.id
      };
    }
    for (const syn of m.synonyms) {
      const sNorm = normalizeMaterialName(syn.value);
      if (norm && sNorm === norm) {
        return {
          matched: true,
          materialId: m.id,
          confidence: 0.95,
          matchType: "alias",
          suggestedMaterialId: m.id
        };
      }
    }
    const mTokens = tokenizeNormalized(mNorm);
    const jac = jaccardTokens(tokens, mTokens);
    if (jac > 0 && (!best || jac > best.score)) {
      best = { id: m.id, score: jac * 0.82, type: "fuzzy" };
    }
  }

  const threshold = 0.88;
  if (best && best.score >= threshold) {
    return {
      matched: true,
      materialId: best.id,
      confidence: best.score,
      matchType: best.type,
      suggestedMaterialId: best.id
    };
  }

  if (best && best.score >= 0.35) {
    return {
      matched: false,
      confidence: best.score,
      matchType: "fuzzy",
      suggestedMaterialId: best.id
    };
  }

  return { matched: false, confidence: best?.score ?? 0, matchType: "none", suggestedMaterialId: best?.id };
}
