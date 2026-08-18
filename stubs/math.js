export function cosineSimilarity(a, b) {
    if (!a || !b || !Array.isArray(a) || !Array.isArray(b) || a.length === 0 || b.length === 0) {
        return 0;
    }
    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
        dotProduct += a[i] * b[i];
        magnitudeA += Math.pow(a[i], 2);
        magnitudeB += Math.pow(b[i], 2);
    }
    magnitudeA = Math.sqrt(magnitudeA);
    magnitudeB = Math.sqrt(magnitudeB);
    if (magnitudeA === 0 || magnitudeB === 0) return 0;
    return dotProduct / (magnitudeA * magnitudeB);
}
