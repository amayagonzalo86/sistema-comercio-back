/** Utilidades XML mínimas para los SOAP de ARCA (sin dependencias). */

export function escapeXml(value: string | number): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&');
}

/** Contenido del primer elemento con ese nombre local (ignora prefijos de namespace). */
export function tagValue(xml: string, name: string): string | null {
  const match = new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`).exec(xml);
  return match ? match[1].trim() : null;
}

/** Contenido de todos los elementos con ese nombre local. */
export function tagValues(xml: string, name: string): string[] {
  const regex = new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'g');
  const values: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) values.push(match[1].trim());
  return values;
}

/** Errores u observaciones con estructura <X><Code/><Msg/></X>. */
export function codeMessages(xml: string, container: string): Array<{ code: string; message: string }> {
  return tagValues(xml, container).map((block) => ({
    code: tagValue(block, 'Code') ?? '',
    message: unescapeXml(tagValue(block, 'Msg') ?? ''),
  }));
}
