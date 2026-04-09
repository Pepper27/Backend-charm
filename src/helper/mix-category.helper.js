const Category = require("../models/category.model");
const categoryHelper = require("./category.helper");
const mixCategorySlugs = require("../config/mix-category-slugs");

const TTL_MS = 5 * 60 * 1000;

const cache = {
  expiresAt: 0,
  braceletRoot: null,
  braceletRootSubtreeIds: null,
  braceletTypes: null, // Map<typeCode, { id, subtreeIds:Set<string> }>
  charmRoot: null,
  charmRootSubtreeIds: null,
  clip: null, // { id, subtreeIds:Set<string> }
};

const now = () => Date.now();

const loadCategoryBySlug = async (slug) => {
  return Category.findOne({ slug, deleted: false }).lean();
};

const loadFirstExistingBySlugs = async (slugs) => {
  for (const slug of slugs || []) {
    const cat = await loadCategoryBySlug(slug);
    if (cat?._id) return cat;
  }
  return null;
};

const unionStringSets = (sets) => {
  const out = new Set();
  for (const s of sets || []) {
    for (const v of s || []) out.add(String(v));
  }
  return out;
};

const toIdStringSet = (ids) => {
  const set = new Set();
  for (const id of ids || []) set.add(String(id));
  return set;
};

const refreshCache = async () => {
  const braceletRoot = await loadFirstExistingBySlugs(mixCategorySlugs.braceletRootSlugs);
  const charmRoot = await loadFirstExistingBySlugs(mixCategorySlugs.charmRootSlugs);

  // Clip can be a dedicated category (`clip`) or a VN dataset slug (`charm-chan`).
  const clipRoot = await loadFirstExistingBySlugs(mixCategorySlugs.clipSlugs);

  const braceletTypes = new Map();
  if (braceletRoot?._id) {
    const braceletSubtree = await categoryHelper.categoryChild(String(braceletRoot._id));
    cache.braceletRootSubtreeIds = toIdStringSet(braceletSubtree);

    // Preload known bracelet types and their dataset aliases.
    for (const [canonical, slugs] of Object.entries(mixCategorySlugs.braceletTypeAliases || {})) {
      let info = null;
      for (const slug of slugs || []) {
        const typeCat = await loadCategoryBySlug(slug);
        if (!typeCat?._id) continue;

        // Ensure it's somewhere under bracelet root.
        const parentChain = await categoryHelper.categoryParent(String(typeCat._id));
        if (!parentChain.map(String).includes(String(braceletRoot._id))) continue;

        const subtree = await categoryHelper.categoryChild(String(typeCat._id));
        info = { id: String(typeCat._id), subtreeIds: toIdStringSet(subtree) };

        // Map both canonical code and actual dataset slug.
        braceletTypes.set(String(canonical), info);
        braceletTypes.set(String(slug), info);
        break;
      }
    }
  }

  // Charm categories: prefer subtree from charm root, but the dataset may have
  // orphaned charm categories (parent points to missing id). Fallback to slug prefix.
  const charmSets = [];
  if (charmRoot?._id) {
    const charmSubtree = await categoryHelper.categoryChild(String(charmRoot._id));
    charmSets.push(toIdStringSet(charmSubtree));
  }
  const charmBySlugPrefix = await Category.find({
    deleted: false,
    slug: { $regex: "^charm-", $options: "i" },
  })
    .select("_id")
    .lean();
  charmSets.push(toIdStringSet(charmBySlugPrefix.map((c) => c._id)));
  cache.charmRootSubtreeIds = unionStringSets(charmSets);

  let clipInfo = null;
  if (clipRoot?._id) {
    const clipSets = [];
    const subtree = await categoryHelper.categoryChild(String(clipRoot._id));
    clipSets.push(toIdStringSet(subtree));

    // Also include any configured clip slugs directly (useful if category tree is broken).
    const clipSlugCats = await Category.find({
      deleted: false,
      slug: { $in: mixCategorySlugs.clipSlugs || [] },
    })
      .select("_id")
      .lean();
    clipSets.push(toIdStringSet(clipSlugCats.map((c) => c._id)));

    clipInfo = { id: String(clipRoot._id), subtreeIds: unionStringSets(clipSets) };
  }

  cache.braceletRoot = braceletRoot ? { id: String(braceletRoot._id) } : null;
  cache.charmRoot = charmRoot ? { id: String(charmRoot._id) } : null;
  cache.clip = clipInfo;
  cache.braceletTypes = braceletTypes;
  cache.expiresAt = now() + TTL_MS;
};

const ensureCache = async () => {
  if (cache.expiresAt > now() && cache.braceletTypes) return;
  await refreshCache();
};

const inferBraceletTypeCodeFromCategoryId = async (categoryId) => {
  await ensureCache();
  const id = String(categoryId || "");
  for (const [typeCode, info] of cache.braceletTypes.entries()) {
    if (info.subtreeIds.has(id)) return typeCode;
  }

  // Fallback: infer typeCode as the category directly under root `bracelet`.
  // This avoids coupling to a hardcoded list of known type slugs.
  if (!cache.braceletRoot?.id) return null;
  try {
    const parentChain = await categoryHelper.categoryParent(id);
    const rootIdx = parentChain.map(String).indexOf(String(cache.braceletRoot.id));
    if (rootIdx <= 0) return null;

    // categoryParent returns [self, parent, ..., root, ...]
    // The node just before root is the "type".
    const typeId = parentChain[rootIdx - 1];
    const typeCat = await Category.findOne({ _id: typeId, deleted: false }).select("slug").lean();
    return typeCat?.slug ? String(typeCat.slug) : null;
  } catch {
    return null;
  }
};

const isClipCategoryId = async (categoryId) => {
  await ensureCache();
  if (!cache.clip) return false;
  return cache.clip.subtreeIds.has(String(categoryId || ""));
};

const getBraceletTypeSubtreeIds = async (typeCode) => {
  await ensureCache();
  const key = String(typeCode || "");
  const info = cache.braceletTypes.get(key);
  if (info) return Array.from(info.subtreeIds);

  // Dynamically support additional bracelet type slugs under `bracelet`.
  if (!cache.braceletRoot?.id) return null;
  const typeCat = await loadCategoryBySlug(key);
  if (!typeCat?._id) return null;

  const parentChain = await categoryHelper.categoryParent(String(typeCat._id));
  if (!parentChain.map(String).includes(String(cache.braceletRoot.id))) return null;

  const subtree = await categoryHelper.categoryChild(String(typeCat._id));
  const dynamic = {
    id: String(typeCat._id),
    subtreeIds: toIdStringSet(subtree),
  };
  cache.braceletTypes.set(key, dynamic);
  return Array.from(dynamic.subtreeIds);
};

const getBraceletRootSubtreeIds = async () => {
  await ensureCache();
  return cache.braceletRootSubtreeIds ? Array.from(cache.braceletRootSubtreeIds) : null;
};

const getClipSubtreeIds = async () => {
  await ensureCache();
  return cache.clip ? Array.from(cache.clip.subtreeIds) : [];
};

const getCharmRootSubtreeIds = async () => {
  await ensureCache();
  return cache.charmRootSubtreeIds ? Array.from(cache.charmRootSubtreeIds) : null;
};

module.exports = {
  inferBraceletTypeCodeFromCategoryId,
  isClipCategoryId,
  getBraceletTypeSubtreeIds,
  getBraceletRootSubtreeIds,
  getClipSubtreeIds,
  getCharmRootSubtreeIds,
  _refreshCacheForDebug: refreshCache,
};
