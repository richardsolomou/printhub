import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { normalizePrinterModel, type GeneratedPrinterPreset, type ManufacturerImage, type ManufacturerImageSource } from './printerCatalog'

type ShopifyProduct = {
  title: string
  handle: string
  product_type: string
  images?: { src: string }[]
}

const root = path.resolve(import.meta.dirname, '..')
const catalog = JSON.parse(readFileSync(path.join(root, 'printer-catalog/catalog.generated.json'), 'utf8')) as {
  presets: GeneratedPrinterPreset[]
}
const manifest = JSON.parse(readFileSync(path.join(root, 'printer-catalog/image-sources.json'), 'utf8')) as {
  sources: ManufacturerImageSource[]
}
const imagesRoot = path.join(root, 'public/printer-presets/manufacturer')
const outputPath = path.join(root, 'printer-catalog/manufacturer-images.json')
const checkedAt = new Date().toISOString().slice(0, 10)

rmSync(imagesRoot, { recursive: true, force: true })
mkdirSync(imagesRoot, { recursive: true })

const images: ManufacturerImage[] = []
for (const source of manifest.sources) images.push(...(await synchronizeSource(source)))
images.sort((first, second) => first.presetId.localeCompare(second.presetId))
writeFileSync(outputPath, `${JSON.stringify({ images }, null, 2)}\n`)
console.log(`Synchronized ${images.length} manufacturer printer images.`)

async function synchronizeSource(source: ManufacturerImageSource) {
  const response = await fetch(source.feedUrl)
  if (!response.ok) throw new Error(`${source.id} product feed returned ${response.status}`)
  const feed = (await response.json()) as { products?: ShopifyProduct[] }
  if (!feed.products) throw new Error(`${source.id} product feed has no products`)

  const products = feed.products
    .filter((product) => source.productTypes.includes(product.product_type) && product.images?.[0]?.src)
    .sort((first, second) => source.productTypes.indexOf(first.product_type) - source.productTypes.indexOf(second.product_type))
  const productsByModel = new Map<string, ShopifyProduct>()
  for (const product of products) {
    const normalizedTitle = normalizePrinterModel(product.title, source.brand)
    const model = source.titleAliases?.[normalizedTitle]
    const key = normalizePrinterModel(model ?? normalizedTitle)
    if (!productsByModel.has(key)) productsByModel.set(key, product)
  }

  const matched: ManufacturerImage[] = []
  for (const preset of catalog.presets.filter((candidate) => candidate.printType === 'resin' && candidate.brand === source.brand)) {
    const product = productsByModel.get(normalizePrinterModel(preset.model))
    const sourceUrl = product?.images?.[0]?.src
    if (!product || !sourceUrl) continue
    const extension = imageExtension(sourceUrl)
    const src = `/printer-presets/manufacturer/${preset.id}.${extension}`
    const imageResponse = await fetch(sourceUrl)
    if (!imageResponse.ok) throw new Error(`${source.id} image for ${preset.id} returned ${imageResponse.status}`)
    writeFileSync(path.join(root, 'public', src), Buffer.from(await imageResponse.arrayBuffer()))
    matched.push({
      presetId: preset.id,
      sourceId: source.id,
      productUrl: `${source.storefrontUrl}/products/${product.handle}`,
      sourceUrl,
      src,
      checkedAt,
    })
  }
  return matched
}

function imageExtension(url: string) {
  const extension = path.extname(new URL(url).pathname).slice(1).toLocaleLowerCase()
  if (['jpg', 'jpeg', 'png', 'webp'].includes(extension)) return extension
  throw new Error(`Unsupported manufacturer image extension: ${url}`)
}
