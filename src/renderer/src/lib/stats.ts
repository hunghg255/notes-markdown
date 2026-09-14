import readingTime from 'reading-time/lib/reading-time'

export interface DocStats {
  words: number
  characters: number
  paragraphs: number
  /** estimated reading time in minutes (reading-time, 200 wpm) */
  minutes: number
}

/** "< 1 min" / "3 min" / "1 h 12 min" */
export function formatReadingTime(minutes: number): string {
  if (minutes < 1) return '< 1 min'
  const m = Math.round(minutes)
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h ${m % 60} min`
}

export function computeStats(text: string): DocStats {
  const words = text.match(/\S+/g)?.length ?? 0
  const characters = text.length
  const paragraphs = text.split(/\n\s*\n/).filter((block) => block.trim().length > 0).length
  const minutes = readingTime(text).minutes
  return { words, characters, paragraphs, minutes }
}
