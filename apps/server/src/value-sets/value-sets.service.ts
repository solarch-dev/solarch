import { Injectable, NotFoundException } from "@nestjs/common";
import { VALUE_SETS, type ValueSet } from "./registry";

export interface ValueSetSummary {
  id: string;
  label: string;
  description: string;
  count: number;
}

@Injectable()
export class ValueSetsService {
  /** Tüm value-set'lerin özeti (id + label + count). */
  list(): { sets: ValueSetSummary[]; total: number } {
    const sets = Object.values(VALUE_SETS).map((v) => ({
      id: v.id,
      label: v.label,
      description: v.description,
      count: v.values.length,
    }));
    return { sets, total: sets.length };
  }

  /** Tek value-set tüm değerleriyle. */
  getById(id: string): ValueSet {
    const set = VALUE_SETS[id];
    if (!set) {
      throw new NotFoundException({
        code: "ERR_VALUE_SET_NOT_FOUND",
        message: `Value set '${id}' not found.`,
      });
    }
    return set;
  }
}
