/**
 * SQL Prettifier utility for formatting SQL queries for display.
 * This is a simple formatter that handles common SQL formatting needs.
 */

const MAJOR_KEYWORDS = [
  "SELECT",
  "FROM",
  "WHERE",
  "AND",
  "OR",
  "LEFT JOIN",
  "RIGHT JOIN",
  "INNER JOIN",
  "OUTER JOIN",
  "FULL JOIN",
  "CROSS JOIN",
  "JOIN",
  "ON",
  "GROUP BY",
  "HAVING",
  "ORDER BY",
  "LIMIT",
  "OFFSET",
  "UNION",
  "UNION ALL",
  "INTERSECT",
  "EXCEPT",
  "INSERT INTO",
  "VALUES",
  "UPDATE",
  "SET",
  "DELETE FROM",
  "CREATE TABLE",
  "ALTER TABLE",
  "DROP TABLE",
  "WITH",
  "AS",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "EXISTS",
  "NOT EXISTS",
  "IN",
  "NOT IN",
  "BETWEEN",
  "LIKE",
  "IS NULL",
  "IS NOT NULL",
];

const NEWLINE_BEFORE_KEYWORDS = [
  "SELECT",
  "FROM",
  "WHERE",
  "LEFT JOIN",
  "RIGHT JOIN",
  "INNER JOIN",
  "OUTER JOIN",
  "FULL JOIN",
  "CROSS JOIN",
  "JOIN",
  "GROUP BY",
  "HAVING",
  "ORDER BY",
  "LIMIT",
  "OFFSET",
  "UNION",
  "UNION ALL",
  "INTERSECT",
  "EXCEPT",
  "INSERT INTO",
  "VALUES",
  "UPDATE",
  "SET",
  "DELETE FROM",
  "WITH",
];

const INDENT_KEYWORDS = ["AND", "OR", "ON"];

/**
 * Formats a SQL query string for better readability.
 * Adds newlines before major clauses and indentation for sub-clauses.
 *
 * @param sql - The SQL query string to format
 * @returns The formatted SQL string
 */
export function prettifySql(sql: string): string {
  if (!sql || typeof sql !== "string") {
    return sql || "";
  }

  let formatted = sql.trim();

  formatted = formatted.replace(/\s+/g, " ");

  for (const keyword of NEWLINE_BEFORE_KEYWORDS) {
    const regex = new RegExp(`\\s+${escapeRegex(keyword)}\\s+`, "gi");
    formatted = formatted.replace(regex, `\n${keyword} `);
  }

  for (const keyword of INDENT_KEYWORDS) {
    const regex = new RegExp(`\\n${escapeRegex(keyword)}\\s+`, "gi");
    formatted = formatted.replace(regex, `\n  ${keyword} `);

    const regex2 = new RegExp(`\\s+${escapeRegex(keyword)}\\s+`, "gi");
    formatted = formatted.replace(regex2, `\n  ${keyword} `);
  }

  formatted = formatted.replace(/,\s*/g, ",\n  ");

  formatted = formatted.replace(/\(\s*/g, "(\n  ");
  formatted = formatted.replace(/\s*\)/g, "\n)");

  formatted = formatted.replace(/\n\s*\n/g, "\n");

  formatted = uppercaseKeywords(formatted);

  return formatted.trim();
}

/**
 * A simpler SQL formatter that only adds newlines before major keywords
 * without heavy reformatting of commas and parentheses.
 */
export function prettifySqlSimple(sql: string): string {
  if (!sql || typeof sql !== "string") {
    return sql || "";
  }

  let formatted = sql.trim();

  formatted = formatted.replace(/\s+/g, " ");

  for (const keyword of NEWLINE_BEFORE_KEYWORDS) {
    const regex = new RegExp(`\\s+${escapeRegex(keyword)}\\s+`, "gi");
    formatted = formatted.replace(regex, `\n${keyword} `);
  }

  for (const keyword of INDENT_KEYWORDS) {
    const regex = new RegExp(`\\s+${escapeRegex(keyword)}\\s+`, "gi");
    formatted = formatted.replace(regex, `\n  ${keyword} `);
  }

  formatted = uppercaseKeywords(formatted);

  return formatted.trim();
}

function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function uppercaseKeywords(sql: string): string {
  let result = sql;

  for (const keyword of MAJOR_KEYWORDS) {
    const regex = new RegExp(`\\b${escapeRegex(keyword)}\\b`, "gi");
    result = result.replace(regex, keyword);
  }

  return result;
}
