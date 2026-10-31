import { categoryIconAssets } from "./category-icon-assets";

export function categoryIconXml(
  iconKey: string | undefined,
  instanceId: string
) {
  const xml = categoryIconAssets[iconKey ?? ""]?.xml;
  if (!xml) return null;
  // Scope source IDs/references per instance so repeated icons and different
  // gradients can coexist on native and web screens.
  const prefix = instanceId.replace(/[^a-zA-Z0-9_-]/g, "");
  return xml
    .replace(/\bid="([^"]+)"/g, (_, id: string) => `id="${prefix}-${id}"`)
    .replace(/url\(#([^)]+)\)/g, (_, id: string) => `url(#${prefix}-${id})`);
}
