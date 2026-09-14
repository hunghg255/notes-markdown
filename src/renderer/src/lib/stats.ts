export interface DocStats {
  words: number
  characters: number
  paragraphs: number
}

export function computeStats(text: string): DocStats {
  const words = text.match(/\S+/g)?.length ?? 0
  const characters = text.length
  const paragraphs = text.split(/\n\s*\n/).filter((block) => block.trim().length > 0).length
  return { words, characters, paragraphs }
}
