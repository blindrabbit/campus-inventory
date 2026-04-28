const XLSX_REQUIRED_COLUMNS = ["patrimonio", "descricao"];
const XLSX_ROOM_COLUMNS = ["voce digita a sala", "setor"];

export const normalizeColumnName = (value) =>
  value
    ?.toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const detectDelimiter = (text) => {
  const firstNonEmptyLine = text
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0);

  if (!firstNonEmptyLine) {
    return ";";
  }

  const semicolonCount = (firstNonEmptyLine.match(/;/g) || []).length;
  const commaCount = (firstNonEmptyLine.match(/,/g) || []).length;

  if (semicolonCount === 0 && commaCount === 0) {
    return ";";
  }

  return semicolonCount >= commaCount ? ";" : ",";
};

const parseDelimitedText = (text, delimiter) => {
  const rows = [];
  let currentRow = [];
  let currentField = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          currentField += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        currentField += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === delimiter) {
      currentRow.push(currentField);
      currentField = "";
      continue;
    }

    if (char === "\n" || char === "\r") {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }

      currentRow.push(currentField);
      currentField = "";

      if (currentRow.some((value) => value.trim().length > 0)) {
        rows.push(currentRow);
      }

      currentRow = [];
      continue;
    }

    currentField += char;
  }

  currentRow.push(currentField);
  if (currentRow.some((value) => value.trim().length > 0)) {
    rows.push(currentRow);
  }

  return rows;
};

export const parseInventoryCsv = async (buffer) => {
  try {
    const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
    if (!text.trim()) {
      return { valid: false, error: "Arquivo CSV sem texto legível" };
    }

    const delimiter = detectDelimiter(text);
    const parsedRows = parseDelimitedText(text, delimiter);

    if (!parsedRows.length) {
      return { valid: false, error: "Arquivo CSV sem linhas de dados" };
    }

    const headers = parsedRows[0].map((header) => normalizeColumnName(header));
    const rows = parsedRows.slice(1).map((cells) => {
      const row = {};

      headers.forEach((header, index) => {
        if (!header) return;
        row[header] = cells[index] ?? null;
      });

      return row;
    });

    const nonEmptyRows = rows.filter((row) =>
      Object.values(row).some((value) => value !== null && value !== ""),
    );

    if (!nonEmptyRows.length) {
      return { valid: false, error: "Planilha CSV sem linhas de dados" };
    }

    const missingColumns = XLSX_REQUIRED_COLUMNS.filter(
      (column) => !headers.includes(column),
    );
    if (missingColumns.length > 0) {
      return {
        valid: false,
        error: `Colunas obrigatórias ausentes: ${missingColumns.join(", ")}`,
      };
    }

    const hasRoomColumn = XLSX_ROOM_COLUMNS.some((column) =>
      headers.includes(column),
    );
    if (!hasRoomColumn) {
      return {
        valid: false,
        error:
          "Planilha deve conter ao menos uma coluna de local (você digita a sala ou setor)",
      };
    }

    return {
      valid: true,
      sourceFormat: "CSV",
      rowCount: nonEmptyRows.length,
      headers,
      rows: nonEmptyRows,
    };
  } catch {
    return { valid: false, error: "Arquivo CSV inválido ou corrompido" };
  }
};
