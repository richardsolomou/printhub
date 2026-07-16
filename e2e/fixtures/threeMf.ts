import { strToU8, zipSync } from 'fflate'

type Point = [number, number, number]

export function boxThreeMf(width: number, depth: number, height: number) {
  const points: Point[] = [
    [0, 0, 0],
    [width, 0, 0],
    [width, depth, 0],
    [0, depth, 0],
    [0, 0, height],
    [width, 0, height],
    [width, depth, height],
    [0, depth, height],
  ]
  const faces = [
    [0, 2, 1],
    [0, 3, 2],
    [4, 5, 6],
    [4, 6, 7],
    [0, 1, 5],
    [0, 5, 4],
    [1, 2, 6],
    [1, 6, 5],
    [2, 3, 7],
    [2, 7, 6],
    [3, 0, 4],
    [3, 4, 7],
  ]
  const model = `<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources><object id="1" type="model"><mesh><vertices>
${points.map(([x, y, z]) => `    <vertex x="${x}" y="${y}" z="${z}"/>`).join('\n')}
  </vertices><triangles>
${faces.map(([v1, v2, v3]) => `    <triangle v1="${v1}" v2="${v2}" v3="${v3}"/>`).join('\n')}
  </triangles></mesh></object></resources><build><item objectid="1"/></build>
</model>`
  return Buffer.from(
    zipSync({
      '[Content_Types].xml': strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>',
      ),
      '_rels/.rels': strToU8(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rel0" Target="3D/model.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
      ),
      '3D/model.model': strToU8(model),
    }),
  )
}
