// Free barcode lookup via Open Products Facts, then Open Food Facts as a backstop.
// No API key, no per-use cost. One request per real scan.
async function fetchJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    clearTimeout(t);
    return null;
  }
}

export async function lookupBarcode(upc) {
  const bases = [
    'https://world.openproductsfacts.org/api/v2/product/',
    'https://world.openfoodfacts.org/api/v2/product/',
  ];
  const fields = '.json?fields=product_name,product_name_en,brands,quantity';
  for (const b of bases) {
    const data = await fetchJson(b + encodeURIComponent(upc) + fields);
    const p = data && data.product;
    if (p && (p.product_name || p.product_name_en || p.brands || p.quantity)) {
      const nm = (p.product_name_en || p.product_name || '').trim();
      const brand = (p.brands || '').split(',')[0].trim();
      return {
        found: true,
        name: [brand, nm].filter(Boolean).join(' ').trim(),
        size: (p.quantity || '').trim(),
      };
    }
  }
  return { found: false };
}
