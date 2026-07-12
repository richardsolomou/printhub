import * as THREE from 'three'
import { STLExporter, STLLoader } from 'three-stdlib'

export function parseStl(file: Uint8Array): Float32Array {
  const buffer =
    file.byteOffset === 0 && file.byteLength === file.buffer.byteLength
      ? (file.buffer as ArrayBuffer)
      : (file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer)
  const geometry = new STLLoader().parse(buffer)
  const position = geometry.getAttribute('position')
  if (!position || position.count === 0) throw new Error('empty STL')
  geometry.center()
  return new Float32Array(position.array)
}

export function boundingExtent(positions: Float32Array) {
  const box = new THREE.Box3().setFromBufferAttribute(new THREE.BufferAttribute(positions, 3))
  return box.getSize(new THREE.Vector3()).length()
}

export function exportBinaryStl(positions: Float32Array, indices: Uint32Array): Uint8Array {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  const mesh = new THREE.Mesh(geometry)
  mesh.updateMatrixWorld(true)
  const output = new STLExporter().parse(mesh, { binary: true })
  return new Uint8Array(output.buffer, output.byteOffset, output.byteLength)
}
