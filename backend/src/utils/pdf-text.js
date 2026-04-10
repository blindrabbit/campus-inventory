const MOJIBAKE_PATTERN = /(?:Ã[^A-Za-z0-9\s]|Â[^A-Za-z0-9\s]|â[^A-Za-z0-9\s])/;

const CP1252_UNICODE_TO_BYTE = new Map([
  ["€", 0x80],
  ["‚", 0x82],
  ["ƒ", 0x83],
  ["„", 0x84],
  ["…", 0x85],
  ["†", 0x86],
  ["‡", 0x87],
  ["ˆ", 0x88],
  ["‰", 0x89],
  ["Š", 0x8a],
  ["‹", 0x8b],
  ["Œ", 0x8c],
  ["Ž", 0x8e],
  ["‘", 0x91],
  ["’", 0x92],
  ["“", 0x93],
  ["”", 0x94],
  ["•", 0x95],
  ["–", 0x96],
  ["—", 0x97],
  ["˜", 0x98],
  ["™", 0x99],
  ["š", 0x9a],
  ["›", 0x9b],
  ["œ", 0x9c],
  ["ž", 0x9e],
  ["Ÿ", 0x9f],
]);

const countMojibakeArtifacts = (text) => {
  if (!text) return 0;

  const suspiciousSequences =
    text.match(/(?:Ã[^A-Za-z0-9\s]|Â[^A-Za-z0-9\s]|â[^A-Za-z0-9\s])/g)
      ?.length || 0;
  const replacementChars = text.match(/�/g)?.length || 0;

  return suspiciousSequences + replacementChars * 10;
};

const decodeAsWindows1252Utf8 = (text) => {
  const bytes = [];

  for (const char of text) {
    const mappedByte = CP1252_UNICODE_TO_BYTE.get(char);
    if (mappedByte !== undefined) {
      bytes.push(mappedByte);
      continue;
    }

    const codePoint = char.codePointAt(0);
    if (codePoint !== undefined && codePoint <= 0xff) {
      bytes.push(codePoint);
      continue;
    }

    return text;
  }

  const decoded = Buffer.from(bytes).toString("utf8");
  return decoded.includes("�") ? text : decoded;
};

export const repairMojibake = (value) => {
  const text = value?.toString() || "";
  if (!text || !MOJIBAKE_PATTERN.test(text)) return text;

  const candidates = new Set([text]);

  const latin1Decoded = Buffer.from(text, "latin1").toString("utf8");
  if (!latin1Decoded.includes("�")) {
    candidates.add(latin1Decoded);
  }

  const cp1252Decoded = decodeAsWindows1252Utf8(text);
  candidates.add(cp1252Decoded);

  const cp1252ThenLatin1 = Buffer.from(cp1252Decoded, "latin1").toString(
    "utf8",
  );
  if (!cp1252ThenLatin1.includes("�")) {
    candidates.add(cp1252ThenLatin1);
  }

  let best = text;
  let bestScore = countMojibakeArtifacts(text);

  for (const candidate of candidates) {
    const candidateScore = countMojibakeArtifacts(candidate);
    if (candidateScore < bestScore) {
      best = candidate;
      bestScore = candidateScore;
    }
  }

  return best;
};
