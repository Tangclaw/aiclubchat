function bindParameters(parameters) {
  return parameters.map((value) => value === undefined ? null : value);
}

export function createDurableDatabase(storage, { onQuery } = {}) {
  const sql = storage.sql;
  const usage = { rowsRead: 0, rowsWritten: 0, queries: 0 };

  function consume(cursor, statement) {
    const rows = cursor.toArray();
    const sample = {
      statement,
      rowsRead: Number(cursor.rowsRead || 0),
      rowsWritten: Number(cursor.rowsWritten || 0),
    };
    usage.rowsRead += sample.rowsRead;
    usage.rowsWritten += sample.rowsWritten;
    usage.queries += 1;
    onQuery?.(sample);
    return rows;
  }

  return {
    isOpen: true,
    exec(statement) {
      const cursor = sql.exec(statement);
      consume(cursor, statement);
      return this;
    },
    prepare(statement) {
      return {
        all(...parameters) {
          return consume(sql.exec(statement, ...bindParameters(parameters)), statement);
        },
        get(...parameters) {
          return consume(sql.exec(statement, ...bindParameters(parameters)), statement)[0];
        },
        run(...parameters) {
          const cursor = sql.exec(statement, ...bindParameters(parameters));
          consume(cursor, statement);
          return {
            changes: cursor.rowsWritten,
            lastInsertRowid: 0,
          };
        },
      };
    },
    transaction(action) {
      return storage.transactionSync(action);
    },
    usage() {
      return { ...usage };
    },
    close() {},
  };
}
