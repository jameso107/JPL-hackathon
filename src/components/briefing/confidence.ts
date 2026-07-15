/** Plain-language confidence phrase for a posterior probability (lead with words). */
export function confidencePhrase(posterior: number): string {
  if (posterior >= 0.9) return 'very high confidence';
  if (posterior >= 0.75) return 'high confidence';
  if (posterior >= 0.5) return 'moderate confidence';
  if (posterior >= 0.3) return 'a leading candidate';
  return 'weakly favored';
}
