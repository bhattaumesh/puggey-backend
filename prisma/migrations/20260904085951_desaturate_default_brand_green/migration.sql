-- Visual polish pass: the original default brand green (#3EA832) read as too
-- neon/bright. Desaturated a notch to #388E3C, same hue. Only tenants still on
-- the untouched original default are bumped -- anyone who picked their own
-- color (including the old default's exact value on purpose) keeps it as-is,
-- since there's no way to distinguish "never touched this" from "chose the
-- default color deliberately" -- treating them the same is the intended
-- behavior here, not a limitation.
ALTER TABLE "tenants" ALTER COLUMN "accentColorHex" SET DEFAULT '#388E3C';

UPDATE "tenants" SET "accentColorHex" = '#388E3C' WHERE "accentColorHex" = '#3EA832';
