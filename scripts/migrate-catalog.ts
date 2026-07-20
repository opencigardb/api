import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getDb } from "../src/db/index";
import { commitAndPushFile } from "../src/git/commit";
import { buildBrandResolver } from "../src/lib/brands";
import { deriveUlid } from "../src/lib/id";

/**
 * Migrates Manufacturer + Brand into git-backed catalog/ JSON, per RFC-0003
 * ("Git is the canonical source of catalog data"). Scoped to just these two
 * entities: cigar.schema.json requires product_line_id/vitola_id/blend_id,
 * none of which this dataset has real structure for, and product-line.md
 * explicitly bans inventing a placeholder Product Line — see
 * schemas/README.md. One Manufacturer per distinct derived brand string,
 * with exactly one Brand under it; this is a documented simplification
 * (see the `notes` field below), not silently invented certainty.
 */

const CATALOG_REPO = resolve(import.meta.dir, "../../catalog");
const MIGRATION_NOTE =
  "Auto-derived from a cigar-name prefix heuristic during the initial catalog migration (2026-07). " +
  "Manufacturer/brand distinction, legal name, and operational status are not yet independently " +
  "verified — see RFC-0003, OCP-0001.";

const COMBINING_MARKS = /[̀-ͯ]/g;

function slugify(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(COMBINING_MARKS, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "unknown"
  );
}

interface ManufacturerRecord {
  id: string;
  canonical_name: string;
  status: "UNKNOWN";
  notes: string;
}

interface BrandRecord {
  id: string;
  canonical_name: string;
  manufacturer_id: string;
  status: "UNKNOWN";
  notes: string;
}

async function main() {
  console.log("Reading cigar names from the ingested catalog cache...");
  const names = getDb()
    .query<{ name: string }, []>("SELECT name FROM cigars")
    .all()
    .map((r) => r.name);
  console.log(`${names.length} cigar names`);

  const resolveBrand = buildBrandResolver(names);
  const distinctBrands = new Set<string>();
  for (const name of names) {
    const brand = resolveBrand(name);
    if (brand) distinctBrands.add(brand);
  }
  console.log(`${distinctBrands.size} distinct brands derived`);

  const usedSlugs = new Map<string, string>(); // slug -> brand name that claimed it
  const writtenPaths: string[] = [];

  for (const brand of distinctBrands) {
    let slug = slugify(brand);
    const claimedBy = usedSlugs.get(slug);
    if (claimedBy && claimedBy !== brand) {
      const manufacturerId = deriveUlid(`manufacturer:${brand}`);
      slug = `${slug}-${manufacturerId.slice(0, 6).toLowerCase()}`;
    }
    usedSlugs.set(slug, brand);

    const manufacturerId = deriveUlid(`manufacturer:${brand}`);
    const brandId = deriveUlid(`brand:${brand}`);

    const manufacturer: ManufacturerRecord = {
      id: manufacturerId,
      canonical_name: brand,
      status: "UNKNOWN",
      notes: MIGRATION_NOTE,
    };
    const brandRecord: BrandRecord = {
      id: brandId,
      canonical_name: brand,
      manufacturer_id: manufacturerId,
      status: "UNKNOWN",
      notes: `Auto-derived; see sibling manufacturer.json notes.`,
    };

    const dir = resolve(CATALOG_REPO, "manufacturers", slug);
    await mkdir(resolve(dir, "brands"), { recursive: true });

    const manufacturerPath = resolve(dir, "manufacturer.json");
    const brandPath = resolve(dir, "brands", `${slug}.json`);
    await writeFile(manufacturerPath, `${JSON.stringify(manufacturer, null, 2)}\n`, "utf8");
    await writeFile(brandPath, `${JSON.stringify(brandRecord, null, 2)}\n`, "utf8");

    writtenPaths.push(
      `manufacturers/${slug}/manufacturer.json`,
      `manufacturers/${slug}/brands/${slug}.json`,
    );
  }

  console.log(`Wrote ${writtenPaths.length} files. Committing and pushing to catalog...`);
  await commitAndPushFile({
    repoPath: CATALOG_REPO,
    relativeFilePaths: writtenPaths,
    message: `catalog: migrate ${distinctBrands.size} manufacturers/brands from cigargeeks heuristic derivation`,
    authorName: "migration-script",
  });

  console.log("Done.");
}

main();
