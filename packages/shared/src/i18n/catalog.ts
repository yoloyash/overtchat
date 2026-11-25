import type { en } from "./resources/en/index";

type Strings<T> = { [K in keyof T]: T[K] extends string ? string : Strings<T[K]> };

type PluralSuffix = "zero" | "one" | "two" | "few" | "many" | "other";

/**
 * A locale's strings: every English key except the plural forms, which each
 * language supplies for its own plural categories (`_one`, `_other`, …). The
 * catalog test checks those against `Intl.PluralRules`.
 */
type Localized<T> = {
  [K in keyof T as K extends `${string}_${PluralSuffix}` ? never : K]: T[K] extends string
    ? string
    : Localized<T[K]>;
} & { [K in `${string}_${PluralSuffix}`]?: string };

/** The shape `t()` is typed against. */
export type SourceCatalog = Strings<typeof en>;

/** The shape every non-English resource file must have. */
export type Translation = Localized<typeof en>;
