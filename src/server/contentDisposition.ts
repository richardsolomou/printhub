export function attachmentContentDisposition(fileName: string) {
  let clean = ''
  for (const character of fileName.normalize('NFC')) {
    const code = character.codePointAt(0)!
    if (code >= 32 && code !== 127) clean += character
  }
  const normalized = clean.trim() || 'model'
  const fallback = normalized.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  const encoded = encodeURIComponent(normalized).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}
